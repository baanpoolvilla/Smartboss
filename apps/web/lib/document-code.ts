import "server-only";
import { prisma } from "@smartboss/database";

/**
 * เลขที่เอกสารให้คนอ่าน — SM0001 / WO-2569-0001 / PO-2569-0001
 *
 * ทำไมต้องมี: `id` ของทุกตารางเป็น uuid (`a944483d-be10-43a4-…`) ซึ่งอ่านให้กัน
 * ฟังทางโทรศัพท์ไม่ได้ พนักงานต้องมีเลขสั้น ๆ ไว้อ้างถึงใบงานกัน
 *
 * ⚠ **ไม่ได้มาแทน id** — id ยังเป็น uuid เหมือนเดิม เพราะ `workforce.tenants.id`
 * ต้องเท่ากับ `core.organizations.id` เป๊ะ (การแยกข้อมูลระหว่างบริษัทพึ่งกติกานี้)
 * และเลขเรียงยังบอกใบ้จำนวนลูกค้า + เดาเลขถัดไปได้ ถ้าเอาไปใส่ URL
 *
 * ── ทำไมไม่ใช้ MAX(code) + 1 ──
 * สองคนกดสร้างพร้อมกันจะอ่านค่าเดิมทั้งคู่แล้วได้เลขซ้ำ ที่นี่จองเลขด้วย
 * **คำสั่งเดียว** ที่ Postgres รับประกันว่าอะตอมมิก — การอ่านกับการเพิ่มค่า
 * เกิดพร้อมกัน ไม่มีช่องให้แทรก
 */

export type DocType = "ORG" | "WO" | "PO";

/** ปี พ.ศ. ของตอนนี้ตามเวลาไทย — ใช้เป็นช่วงของการเดินเลข */
export function currentBuddhistYear(now = new Date()): string {
  const th = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return String(th.getFullYear() + 543);
}

/**
 * จองเลขถัดไป — ต้องเรียกใน transaction เดียวกับการสร้างเอกสารเสมอ
 *
 * ถ้าเรียกนอก transaction แล้วการสร้างเอกสารล้มทีหลัง เลขจะถูกกินไปเปล่า ๆ
 * เกิดช่องว่าง (WO-0001, WO-0003) ซึ่งดูเหมือนเอกสารหาย
 *
 * @param tx     prisma client ใน transaction
 * @param orgId  "" สำหรับเลขระดับแพลตฟอร์ม (รหัสบริษัท)
 * @param period "-" เมื่อไม่ต้องแยกตามปี
 */
async function reserveNumber(
  tx: PrismaTx,
  orgId: string,
  docType: DocType,
  period: string
): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
    VALUES (${orgId}, ${docType}, ${period}, 2)
    ON CONFLICT (org_id, doc_type, period)
      DO UPDATE SET next_value = core.document_counters.next_value + 1
    RETURNING next_value - 1 AS value
  `;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error("จองเลขที่เอกสารไม่สำเร็จ");
  return value;
}

/** client ภายใน transaction ของ Prisma */
type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** รหัสบริษัทถัดไป — SM0001 (เดินเลขรวมทั้งระบบ ไม่แยกปี) */
export async function nextOrganizationCode(tx: PrismaTx): Promise<string> {
  const n = await reserveNumber(tx, "", "ORG", "-");
  return `SM${pad(n, 4)}`;
}

/** เลขที่ใบงานซ่อมถัดไป — WO-2569-0001 (แยกตามบริษัทและปี พ.ศ.) */
export async function nextWorkOrderCode(tx: PrismaTx, orgId: string): Promise<string> {
  const year = currentBuddhistYear();
  const n = await reserveNumber(tx, orgId, "WO", year);
  return `WO-${year}-${pad(n, 4)}`;
}

/** เลขที่ใบสั่งซื้อถัดไป — PO-2569-0001 (แยกตามบริษัทและปี พ.ศ.) */
export async function nextPurchaseOrderCode(tx: PrismaTx, orgId: string): Promise<string> {
  const year = currentBuddhistYear();
  const n = await reserveNumber(tx, orgId, "PO", year);
  return `PO-${year}-${pad(n, 4)}`;
}
