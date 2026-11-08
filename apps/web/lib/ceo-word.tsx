"use client";

import { useCeoTitle } from "@/lib/ceo-title-client";

/** คำว่า CEO (ชื่อเรียกของบริษัท) สำหรับวางในข้อความ JSX ที่ใช้ hook ตรง ๆ ไม่ได้ — ใช้ได้ทั้งใน server และ client component */
export function CeoWord() {
  return <>{useCeoTitle()}</>;
}
