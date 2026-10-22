import "server-only";

import type { Tx } from "./db";

/**
 * ชื่อรายการปรับเพิ่ม/ปรับลดเริ่มต้นของบริษัท — ชุดเดียวกับที่ FlowAccount มีให้เลือก (PDF จากผู้ใช้ 22/10/2569)
 * + รายการที่ระบบเราใช้บ่อย · สร้างให้ครั้งแรกที่เปิดหน้าจัดการ บริษัทแก้/ปิด/เพิ่มเองได้ในตั้งค่า
 * ธงภาษี/ประกันสังคมเป็นค่าตั้งต้นที่พบบ่อย ให้นักบัญชีของบริษัทตรวจ (ค่ารักษาพยาบาลบางกรณียกเว้นภาษี ฯลฯ)
 */
export const DEFAULT_ITEMS: { name: string; kind: "earning" | "deduction"; taxable: boolean; ssoBase: boolean }[] = [
  { name: "ค่าตำแหน่ง", kind: "earning", taxable: true, ssoBase: true },
  { name: "เบี้ยขยัน", kind: "earning", taxable: true, ssoBase: true },
  { name: "คอมมิชชั่น", kind: "earning", taxable: true, ssoBase: true },
  { name: "โบนัส", kind: "earning", taxable: true, ssoBase: false },
  { name: "เงินเพิ่มพิเศษ", kind: "earning", taxable: true, ssoBase: false },
  { name: "ค่าเบี้ยเลี้ยง/ค่าครองชีพ", kind: "earning", taxable: true, ssoBase: true },
  { name: "ค่าเดินทาง", kind: "earning", taxable: true, ssoBase: false },
  { name: "ค่าโทรศัพท์", kind: "earning", taxable: true, ssoBase: false },
  { name: "ค่ารักษาพยาบาล", kind: "earning", taxable: false, ssoBase: false },
  { name: "ค่าที่พักอาศัย", kind: "earning", taxable: true, ssoBase: false },
  { name: "ค่าตอบแทนกรรมการ", kind: "earning", taxable: true, ssoBase: false },
  { name: "สวัสดิการอื่น", kind: "earning", taxable: true, ssoBase: false },
  { name: "ปรับปรุงงวดก่อน (จ่ายขาด)", kind: "earning", taxable: true, ssoBase: false },
  { name: "หัก กยศ.", kind: "deduction", taxable: false, ssoBase: false },
  { name: "หักค่าเสียหาย", kind: "deduction", taxable: false, ssoBase: false },
  { name: "ผ่อนของ/เงินกู้บริษัท", kind: "deduction", taxable: false, ssoBase: false },
  { name: "ปรับปรุงงวดก่อน (จ่ายเกิน)", kind: "deduction", taxable: false, ssoBase: false },
  { name: "หักอื่นๆ", kind: "deduction", taxable: false, ssoBase: false },
];

export async function ensureDefaultItems(tx: Tx, orgId: string): Promise<void> {
  const count = await tx.salaryItem.count({ where: { orgId } });
  if (count > 0) return;
  await tx.salaryItem.createMany({ data: DEFAULT_ITEMS.map((it, i) => ({ orgId, ...it, sort: i })) });
}
