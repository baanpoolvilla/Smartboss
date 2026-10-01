import "server-only";
import { after } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@smartboss/auth";
import { wfFetch, wfTry, type Employment, type Paged } from "./api";

/**
 * คำนวณผลลงเวลาให้ทุกคนอัตโนมัติก่อนอ่านสรุป — ผู้ใช้ไม่ควรต้องรู้จักคำว่า
 * "สั่งคำนวณ" เลยถึงจะเห็นตัวเลขที่ถูกต้อง เรามีเวลาสแกนกับตารางกะอยู่แล้ว
 * ไม่มีเหตุผลให้คนต้องกดปุ่มเองก่อนทุกครั้ง
 *
 * ทำไมยังต้องมีขั้น "คำนวณ" อยู่เบื้องหลัง (ไม่ใช่คิดสด ๆ ตรง ๆ): ผลลงเวลา
 * ต้อง "นิ่ง" เก็บเป็นประวัติได้ (ใช้อ้างอิงตอนจ่ายเงินเดือน) จะคิดสดใหม่ทุกครั้ง
 * ที่มีคนเปิดหน้าไม่ได้
 *
 * ⚠ ราคาของงานนี้สูงกว่าที่หน้าตาโค้ดบอกมาก — ฝั่ง workforce API
 * `recalculateRange` วนคำนวณ **ทีละวัน** ในทรานแซกชันเดียว (30 วัน ≈ 270 query
 * เรียงกัน ถือ connection ค้างไว้ตลอด) ถ้ายิงพร้อมกันทุกคนแบบไม่จำกัด
 * พนักงาน 14 คนจะกิน pool ของ workforce API (max 10) จนหมดทันที แล้วทุก
 * request อื่นที่ต้องผ่าน API เดียวกัน (ทุกหน้าในโมดูล HR) ต้องรอคิว —
 * อาการคือ "เปิดหน้าไหนในบุคคลก็หน่วงไปหมด" ไม่ใช่แค่หน้าที่สั่งคำนวณ
 *
 * จึงคุมไว้สองชั้น:
 *   1. throttle รายบริษัท — ภายใน TTL ถ้าช่วงวันที่ขอครอบอยู่ในรอบก่อนแล้ว ข้าม
 *   2. จำกัดจำนวนที่ยิงพร้อมกัน — ไม่ให้กิน pool ของ API จนหน้าอื่นรอ
 *
 * ล้มเหลวแบบเงียบ ๆ ได้ (คนเดียวพังไม่ควรทำให้คนอื่นคำนวณไม่ได้ไปด้วย) —
 * สาเหตุที่คำนวณไม่ได้ (เช่นยังไม่ผูกกะ) มีหน้า "สาเหตุที่ทำให้ผลลงเวลายังไม่ออก"
 * คอยบอกอยู่แล้ว ไม่ต้องโยน error ซ้ำที่นี่
 */

/** ยิงคำนวณพร้อมกันได้กี่คน — ต่ำกว่า pool ของ workforce API (10) ไว้เผื่อหน้าอื่น */
// ทีละคน — เป็นงานเบื้องหลังล้วน ๆ ช้าลงหน่อยไม่มีใครรอ แต่ยิงพร้อมกันหลายคนแย่ง
// เครื่อง 2 คอร์กับหน้าที่ผู้ใช้กดอยู่
const MAX_PARALLEL = 1;

/** ภายในกี่มิลลิวินาทีถือว่า "เพิ่งคำนวณไปแล้ว" ไม่ต้องทำซ้ำ */
const THROTTLE_MS = 5 * 60_000;

interface LastRun {
  at: number;
  from: string;
  to: string;
}

/**
 * รอบล่าสุดของแต่ละบริษัท — เก็บในหน่วยความจำพอ ไม่ต้องลง DB
 * เป็นแค่ตัวกันงานซ้ำ ไม่ใช่ข้อมูลที่หายไม่ได้ (รีสตาร์ตแล้วคำนวณเกินหนึ่งรอบ
 * ไม่มีผลเสีย เพราะการคำนวณซ้ำได้ผลเท่าเดิมอยู่แล้ว) — `next start` เป็น
 * โปรเซสเดียว Map นี้จึงเห็นตรงกันทั้งเซิร์ฟเวอร์ และมีขนาดเท่าจำนวนบริษัท
 */
const lastRunByOrg = new Map<string, LastRun>();

/** true = รอบก่อนเพิ่งทำไป และครอบช่วงที่ขอมาแล้ว */
function coveredByRecentRun(orgId: string, from: string, to: string): boolean {
  const prev = lastRunByOrg.get(orgId);
  if (prev === undefined) return false;
  if (Date.now() - prev.at > THROTTLE_MS) return false;
  // เทียบสตริง ISO date ตรง ๆ ได้ เพราะรูปแบบ YYYY-MM-DD เรียงตามลำดับเวลาอยู่แล้ว
  return prev.from <= from && prev.to >= to;
}

/** ทำงานทีละ `limit` ตัว — กัน pool ของ workforce API ไม่ให้ถูกกินจนหมด */
async function runWithLimit<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<unknown>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await task(items[index]!);
    }
  });
  await Promise.all(workers);
}

export async function autoRecalculateAttendance(from: string, to: string): Promise<void> {
  const session = await getSession();
  const orgId = session?.orgId;
  // ไม่มี org (platform user) ก็ไม่มีผลลงเวลาให้คำนวณอยู่แล้ว
  if (!orgId) return;

  if (coveredByRecentRun(orgId, from, to)) return;

  // จองคิวก่อนเริ่มจริง ไม่ใช่หลังเสร็จ — งานนี้ใช้เวลาหลายวินาที ถ้ารอจนจบ
  // ค่อยบันทึก คนที่เปิดหน้าระหว่างนั้นจะยิงซ้ำซ้อนกันอีกหลายรอบ
  lastRunByOrg.set(orgId, { at: Date.now(), from, to });

  // รันหลังส่งหน้าให้ผู้ใช้แล้ว (after) — เดิมเริ่มพร้อมกับตอนหน้ากำลังโหลด แล้วแย่ง
  // workforce API/ฐานข้อมูลกับคำขอของหน้าเอง เข้าโมดูลบุคคลครั้งแรก (รอบที่ต้องคำนวณ)
  // เลยช้า 2.6–3.3 วิ ส่วนกดต่อในหน้าเดิม 0.2–0.6 วิ — token อ่านไว้ก่อน เพราะใน
  // after() ของ Server Component อ่าน cookies() ไม่ได้แล้ว
  const token = (await cookies()).get("sb_access")?.value;
  after(async () => {
    try {
      const employments = await wfTry<Paged<Pick<Employment, "id" | "terminated_on">>>("/employments", token);
      if (employments === null) {
        lastRunByOrg.delete(orgId); // ไม่มีสิทธิ์อ่าน — ให้คนที่มีสิทธิ์เปิดแล้วได้คำนวณ
        return;
      }
      const active = employments.items.filter((e) => e.terminated_on === null);
      await runWithLimit(active, MAX_PARALLEL, (e) =>
        wfFetch("/attendance-results:recalculate", {
          method: "POST",
          body: { employment_id: e.id, from, to },
          token,
        }).catch(() => null),
      );
    } catch {
      lastRunByOrg.delete(orgId);
    }
  });
}

/**
 * ล้างคิว throttle ของบริษัทหนึ่ง — เรียกหลังจากมีการแก้ข้อมูลที่ทำให้ผลเดิม
 * ใช้ไม่ได้ (แก้กะ อนุมัติลาย้อนหลัง กดปุ่มคำนวณใหม่เอง) เพื่อให้รอบถัดไป
 * คำนวณจริงแทนที่จะถูกข้ามเพราะ "เพิ่งทำไป"
 */
export function invalidateAttendanceThrottle(orgId: string): void {
  lastRunByOrg.delete(orgId);
}
