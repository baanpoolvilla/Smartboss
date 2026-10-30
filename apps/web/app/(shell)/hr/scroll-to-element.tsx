"use client";

import { useEffect } from "react";

/** เลื่อนหน้าไปที่ element ตอนเปิดหน้า — ใช้กับลิงก์จากแจ้งเตือนที่ต้องพาไปถึงปุ่มที่ต้องกด */
export function ScrollToElement({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [id]);
  return null;
}
