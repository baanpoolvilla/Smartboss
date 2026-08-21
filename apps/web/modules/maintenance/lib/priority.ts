/**
 * ความเร่งด่วนของใบงาน — นิยามที่เดียว ใช้ทั้งบอร์ดและหน้ารายละเอียด
 *
 * ลำดับใน PRIORITY_ORDER ไม่ใช่แค่รายการเฉย ๆ — มันคือลำดับที่การ์ดจะเรียงบน
 * บอร์ดจริง ๆ แก้ลำดับที่นี่ที่เดียวแล้วทุกหน้าเรียงตามกันหมด
 *
 * สีไม่ได้อยู่ในนี้โดยตั้งใจ: บอร์ดใช้ Material palette (ให้เหมือน ChangYai เดิม)
 * ส่วนหน้ารายละเอียดใช้ Tailwind palette — คนละชุด แต่ label กับลำดับต้องตรงกัน
 */
export const PRIORITY_ORDER = ["urgent", "high", "medium", "low"] as const;

export const PRIORITY_LABEL: Record<string, string> = {
  urgent: "เร่งด่วน",
  high: "สูง",
  medium: "ปานกลาง",
  low: "ต่ำ",
};

export function priorityLabel(p: string): string {
  return PRIORITY_LABEL[p] ?? PRIORITY_LABEL.medium!;
}

/** คีย์ของกลุ่ม "งานอัตโนมัติจาก PM" — ไม่ใช่ระดับความเร่งด่วน จึงไม่อยู่ใน PRIORITY_ORDER */
export const AUTO_GROUP_KEY = "auto";

export interface PriorityGroup<T> {
  key: string;
  label: string;
  orders: T[];
}

/**
 * แบ่งใบงานออกเป็นกลุ่มตามความเร่งด่วน เรียงด่วนสุดขึ้นก่อน
 *
 * ⚠ งานอัตโนมัติจาก PM แยกเป็นกลุ่มท้ายสุดโดยตั้งใจ ไม่ปนกับ "ปานกลาง"
 * เพราะ cron ใส่ priority = medium ให้ทุกใบโดยไม่มีใครประเมิน (ดู data/cron.ts)
 * ถ้าเอาไปปนกัน คนอ่านบอร์ดจะเข้าใจว่ามีคนจัดระดับให้แล้ว ทั้งที่ไม่มี
 *
 * ลำดับภายในกลุ่มคงตามลำดับที่รับเข้ามา (ใหม่ก่อนเก่า) — ใช้ filter ไม่ใช่ sort
 * ก็เพื่อการนี้ ไม่ต้องพึ่งว่า sort จะ stable หรือไม่
 *
 * กลุ่มที่ว่างถูกตัดทิ้ง — หัวข้อ "เร่งด่วน 0" ไม่ได้บอกอะไรนอกจากกินที่
 */
export function groupByPriority<T extends { priority: string; autoCreated: boolean }>(
  list: T[]
): PriorityGroup<T>[] {
  const manual = list.filter((w) => !w.autoCreated);
  const auto = list.filter((w) => w.autoCreated);

  const groups: PriorityGroup<T>[] = PRIORITY_ORDER.map((key) => ({
    key,
    label: priorityLabel(key),
    orders: manual.filter((w) => w.priority === key),
  }));

  // ค่า priority ที่ไม่รู้จัก (ข้อมูลเก่า/ที่ import เข้ามา) ต้องไม่หายไปเงียบ ๆ
  const known = new Set<string>(PRIORITY_ORDER);
  const unknown = manual.filter((w) => !known.has(w.priority));
  if (unknown.length > 0) groups[groups.length - 1]!.orders.push(...unknown);

  if (auto.length > 0) {
    groups.push({ key: AUTO_GROUP_KEY, label: "อัตโนมัติจาก PM", orders: auto });
  }
  return groups.filter((g) => g.orders.length > 0);
}
