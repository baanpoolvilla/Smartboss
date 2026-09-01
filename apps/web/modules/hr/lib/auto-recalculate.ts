import "server-only";
import { wfFetch, wfTry, type Employment, type Paged } from "./api";

/**
 * คำนวณผลลงเวลาให้ทุกคนอัตโนมัติก่อนอ่านสรุป — ผู้ใช้ไม่ควรต้องรู้จักคำว่า
 * "สั่งคำนวณ" เลยถึงจะเห็นตัวเลขที่ถูกต้อง เรามีเวลาสแกนกับตารางกะอยู่แล้ว
 * ไม่มีเหตุผลให้คนต้องกดปุ่มเองก่อนทุกครั้ง
 *
 * ทำไมยังต้องมีขั้น "คำนวณ" อยู่เบื้องหลัง (ไม่ใช่คิดสด ๆ ตรง ๆ): ผลลงเวลา
 * ต้อง "นิ่ง" เก็บเป็นประวัติได้ (ใช้อ้างอิงตอนจ่ายเงินเดือน) จะคิดสดใหม่ทุกครั้ง
 * ที่มีคนเปิดหน้าไม่ได้ — แต่การ "สั่ง" ให้มันคิดใหม่ ไม่จำเป็นต้องรอให้คนกดปุ่ม
 * เอง จึงย้ายมาทำที่นี่แทน โดยยังเก็บปุ่ม "คำนวณใหม่" ไว้ให้กดเองได้เผื่อ
 * แก้กะ/อนุมัติลาย้อนหลังแล้วอยากให้ผลเก่าอัปเดตทันทีโดยไม่ต้องรอเปิดหน้าใหม่
 *
 * ล้มเหลวแบบเงียบ ๆ ได้ (คนเดียวพังไม่ควรทำให้คนอื่นคำนวณไม่ได้ไปด้วย) —
 * สาเหตุที่คำนวณไม่ได้ (เช่นยังไม่ผูกกะ) มีหน้า "สาเหตุที่ทำให้ผลลงเวลายังไม่ออก"
 * คอยบอกอยู่แล้ว ไม่ต้องโยน error ซ้ำที่นี่
 */
export async function autoRecalculateAttendance(from: string, to: string): Promise<void> {
  const employments = await wfTry<Paged<Pick<Employment, "id" | "terminated_on">>>(
    "/employments",
  );
  if (employments === null) return; // ไม่มีสิทธิ์อ่าน — ปล่อยผ่าน หน้าเดิมซ่อนส่วนที่เกี่ยวข้องเอง

  const active = employments.items.filter((e) => e.terminated_on === null);
  await Promise.all(
    active.map((e) =>
      wfFetch("/attendance-results:recalculate", {
        method: "POST",
        body: { employment_id: e.id, from, to },
      }).catch(() => null),
    ),
  );
}
