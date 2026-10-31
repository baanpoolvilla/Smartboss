/**
 * สิทธิ์ของโมดูล "เบิกจ่าย & OT" — แคตตาล็อกอยู่ใต้โมดูล hr (manifest ใช้ requiresModule: "hr")
 * รหัสตรงกับ REQUESTS_PERMS ใน packages/database/defaults.ts และ migration 20261021120000_requests_module
 *
 * กติกาที่ผู้ใช้กำหนด (21/10/2569):
 *   - OT / ค่าช่างภายนอก: แอดมินลงให้ (เจ้าตัวลงเองไม่ได้) → HR อนุมัติ
 *   - เบิกล่วงหน้า: ผู้ดูแลบ้าน/HR ขอให้ → อนุมัติตามเส้นทางที่ตั้งไว้ (ค่าเริ่มต้น HR · เกิน ฿5,000 ต่อ CEO) · HR อนุมัติคำขอของตัวเองไม่ได้
 *   - เบิกค่าใช้จ่าย: เจ้าตัวยื่นเอง → HR อนุมัติและจ่าย · ใบที่ HR ยื่นเอง → CEO
 *   - CEO ไม่ต้องยื่นเบิกของตัวเอง
 * ติ๊กสิทธิ์อื่นของโมดูลแล้วได้ access ให้อัตโนมัติ (setRolePermissionsAction)
 */
export const REQ_PERMS = {
  /** เข้าโมดูล + ยื่นเบิกของตัวเอง + เห็นใบของตัวเอง */
  access: "requests.access",
  /** ลง OT / ค่าช่างภายนอก / ขอเบิกล่วงหน้าให้คนอื่น */
  fileOthers: "requests.file_others",
  /** อนุมัติระดับ HR (OT ค่าใช้จ่าย ค่าช่าง เบิกเงินไปก่อน) */
  approve: "requests.approve",
  /** อนุมัติระดับ CEO (ใบยอดเกินเกณฑ์ที่ตั้งไว้ + ใบที่ HR ยื่นเอง/เป็นผู้ได้เงิน) */
  approveCeo: "requests.approve_ceo",
  /** บันทึกจ่ายเงิน + ส่งเข้างวดเงินเดือน */
  pay: "requests.pay",
  /**
   * เลิกใช้ 31/10/2569 — คนถือเงินสดย่อยตั้งรายคนที่หน้าเงินสดย่อย (lib/holders.ts) แทน
   * รหัสนี้เหลือไว้เป็น "สิทธิ์เมนู" ที่ lib/nav.ts ใส่ให้เฉพาะคนในรายชื่อ ติ๊กที่บทบาทไม่มีผล
   */
  pettyCash: "requests.petty_cash",
  /**
   * เงินสดย่อยแยกจากสิทธิ์ใบเบิก (ผู้ใช้ 31/10/2569 "อยากให้ติ๊กได้มากกว่า") — เดิมผูกกับ อนุมัติ/จ่าย/ดูทุกใบ
   * migration 20261031120000_petty_cash_perms ให้บทบาทที่มีสิทธิ์เดิมไปก่อน ไม่มีใครเห็นน้อยลงตอนอัปเดต
   */
  /** เห็นเงินสดย่อย + ประวัติของทุกคน (ไม่ติ๊ก = เห็นแค่ของตัวเอง) */
  pettyView: "requests.petty_view",
  /** เติมเงินให้คนอื่น + อนุมัติคำขอเติม (คำขอของ HR ยังต้องมีสิทธิ์อนุมัติระดับ CEO ด้วย) */
  pettyTopup: "requests.petty_topup",
  /** ปรับยอด "นับเงินไม่ตรง" + ยกเลิกรายการ ของเงินสดย่อยคนอื่น */
  pettyAdjust: "requests.petty_adjust",
  /** เห็นทุกใบ + รายงาน */
  viewAll: "requests.view_all",
  /** ตั้งค่า + ทะเบียนช่าง/ร้านภายนอก */
  settings: "requests.settings",
} as const;

/** เห็นเมนู/หน้าเงินสดย่อย — คนถือเงิน หรือคนที่ได้สิทธิ์เงินสดย่อยข้อใดข้อหนึ่ง */
export const PETTY_PAGE_PERMS: string[] = [REQ_PERMS.pettyView, REQ_PERMS.pettyTopup, REQ_PERMS.pettyAdjust];

/**
 * ทะเบียนช่าง/ร้านภายนอก — คนถือเงินสดย่อย (รายชื่อ lib/holders.ts จ่ายช่างเองได้) + HR + CEO (ผู้ใช้ 31/10/2569)
 * เดิมผูกกับ "ลงให้คนอื่น" ⇒ ผู้ดูแลบ้าน/หัวหน้างานก็เห็น · ยื่นค่าช่างยังพิมพ์ชื่อช่างที่ยังไม่อยู่ในทะเบียนได้
 */
export const VENDOR_PERMS: string[] = [REQ_PERMS.approve, REQ_PERMS.approveCeo, REQ_PERMS.pay, REQ_PERMS.settings];

export const ALL_REQ_PERMS: string[] = Object.values(REQ_PERMS);

export const REQ_PERM_LABELS: Record<string, string> = {
  [REQ_PERMS.access]: "เบิกจ่าย & OT: ยื่นเบิกของตัวเอง",
  [REQ_PERMS.fileOthers]: "เบิกจ่าย & OT: ลง OT/ค่าช่าง/ขอเบิกให้คนอื่น",
  [REQ_PERMS.approve]: "เบิกจ่าย & OT: อนุมัติ (ระดับ HR)",
  [REQ_PERMS.approveCeo]: "เบิกจ่าย & OT: อนุมัติระดับ CEO (ใบยอดเกินเกณฑ์ / ใบของ HR)",
  [REQ_PERMS.pay]: "เบิกจ่าย & OT: บันทึกจ่ายเงิน",
  [REQ_PERMS.pettyCash]: "เงินสดย่อย: ถือเงิน (เลิกใช้ — ตั้งคนถือเงินที่หน้าเงินสดย่อย ติ๊กตรงนี้ไม่มีผล)",
  [REQ_PERMS.pettyView]: "เงินสดย่อย: เห็นของทุกคน",
  [REQ_PERMS.pettyTopup]: "เงินสดย่อย: เติมเงินให้ + อนุมัติคำขอเติม",
  [REQ_PERMS.pettyAdjust]: "เงินสดย่อย: ปรับยอด/ยกเลิกรายการของคนอื่น",
  [REQ_PERMS.viewAll]: "เบิกจ่าย & OT: ดูทุกใบ + รายงาน",
  [REQ_PERMS.settings]: "เบิกจ่าย & OT: ตั้งค่า + ทะเบียนช่างภายนอก",
};
