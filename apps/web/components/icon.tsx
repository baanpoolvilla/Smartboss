import { createElement } from "react";

import { iconByName } from "@/lib/icons";

/**
 * แสดงไอคอนจาก "ชื่อ" ที่เก็บใน manifest
 *
 * ใช้ createElement แทนการผูกตัวแปรตัวใหญ่แล้วเขียนเป็นแท็ก JSX เพราะกฎ
 * react-hooks/static-components ห้ามแพตเทิร์นนั้น (ปกติแปลว่ามีการสร้าง
 * คอมโพเนนต์ใหม่ทุกรอบ state จะรีเซ็ต) กรณีของเราปลอดภัยอยู่แล้วเพราะ
 * iconByName() คืนอ้างอิงเดิมจากตารางค้นหา — createElement ให้ผลเหมือนกันทุกอย่าง
 * แต่ไม่ต้องปิดกฎทิ้งไว้
 */
export function Icon({
  name,
  className,
  style,
}: {
  /** ชื่อไอคอนจาก lucide-react ที่ลงทะเบียนไว้ใน lib/icons.ts */
  name?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return createElement(iconByName(name), { className, style });
}
