/** ข้อมูลตั้งต้นของฟอร์มสร้างใบงาน ส่งจากรีพอตผ่าน sessionStorage */
export const WORK_ORDER_PREFILL_KEY = "sb-work-order-prefill";

export interface WorkOrderPrefill {
  title: string;
  description: string;
  images: { url: string; name: string; mime?: string }[];
  source: { label: string; link: string };
}

/** ช่องรายละเอียดของใบงานรับได้ 2000 ตัวอักษร เกินแล้วบันทึกไม่ผ่าน (createSchema ใน actions.ts) */
export const WORK_ORDER_DESCRIPTION_MAX = 2000;
export const WORK_ORDER_TITLE_MAX = 200;

/** รับเฉพาะลิงก์ไปหน้ารีพอตในแอป — ค่านี้มาจากฟอร์ม ผู้ใช้แก้ได้ และจะถูกแสดงเป็นลิงก์ให้คนอื่นกด */
export function isWorkOrderSourceLink(link: string): boolean {
  return link.startsWith("/chat-report/report-feed?");
}
