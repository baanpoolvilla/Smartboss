"use client";

import { useEffect } from "react";
import { useMaintenanceNotifStore } from "./use-maintenance-notifications";

/**
 * มาร์คอ่านแจ้งเตือนที่ชี้มาที่หน้านี้โดยอัตโนมัติ ตอนเปิดหน้ารายละเอียดของ
 * เรื่องนั้นตรงๆ (เช่น เปิดใบงานที่แจ้งเตือน "ได้รับมอบหมายงานใหม่" พูดถึง) —
 * ไม่ต้องรอให้กดที่กระดิ่งก่อนแจ้งเตือนถึงจะหาย ("เปิดเข้ามาหน้าที่มีแจ้งเตือน
 * แล้ว แจ้งเตือนมันไม่หาย") วาง invisible เพิ่มเข้าไปในหน้ารายละเอียด (server
 * component) เฉยๆ ไม่ render อะไรเลย
 */
export function MarkReadOnView({ referenceId }: { referenceId: string }) {
  const markReadByReference = useMaintenanceNotifStore((s) => s.markReadByReference);

  useEffect(() => {
    void markReadByReference(referenceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceId]);

  return null;
}
