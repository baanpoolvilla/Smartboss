import type { User } from "@/modules/report_task/types";

/**
 * โหลดรายชื่อพนักงาน (/api/report-task/store/employees) ครั้งเดียวต่อแท็บ แล้วใช้ร่วมกัน 60 วินาที
 *
 * เดิมนอกโมดูลงาน ทุกครั้งที่เปลี่ยนหน้า แถบบนของหน้าใหม่ mount ปุ่มแจ้งบัค + ตัวนับแจ้งเตือน ซึ่งต่างคน
 * ต่างยิงขอรายชื่อเอง (+ ไทล์หน้าแรกอีกตัว) ⇒ เปลี่ยนหน้าครั้งเดียวขอ 2–3 รอบ · prod 18/11/2569 วัด 51 ครั้งใน
 * 2 นาที และชนช่วงที่เซิร์ฟเวอร์หน่วงมากที่สุด (ผู้ใช้ "ย้ายหน้าหน่วง ต้องรอโหลดข้อมูล")
 *
 * ข้อมูลเดียวกันทุกอย่าง แค่ไม่ขอซ้ำ — รายชื่อเปลี่ยนนาน ๆ ครั้ง และหน้าโมดูลงานยัง sync รายชื่อเองเหมือนเดิม
 * (StoreHydrator) · พังแล้วไม่จำ รอบหน้าลองใหม่
 */
const TTL_MS = 60_000;
let cached: { at: number; value: Promise<User[]> } | null = null;

export function fetchEmployeeDirectory(): Promise<User[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = fetch("/api/report-task/store/employees").then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<User[]>;
  });
  const entry = { at: Date.now(), value };
  cached = entry;
  value.catch(() => {
    if (cached === entry) cached = null;
  });
  return value;
}
