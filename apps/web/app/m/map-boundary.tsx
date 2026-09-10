"use client";

import { Component, type ReactNode } from "react";

/**
 * กันไม่ให้แผนที่ล้มทั้งแอป
 *
 * แผนที่เป็นของ "มีก็ดี" — สิ่งที่ขาดไม่ได้คือปุ่มลงเวลา ถ้า Leaflet พังใน
 * เว็บวิวรุ่นไหนสักรุ่น (เจอมาแล้วว่าเว็บวิวของ LINE บน iOS ไม่เหมือน Chrome
 * บนคอม) พนักงานต้องยังลงเวลาได้อยู่ ไม่ใช่เปิดแอปแล้วจอเด้งทั้งหน้า
 *
 * ต้องเป็น class component — React ยังไม่มี hook สำหรับ error boundary
 */
export class MapBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  override state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : "แผนที่ทำงานผิดพลาด" };
  }

  override componentDidCatch(error: unknown): void {
    console.error("checkin map crashed", error);
  }

  override render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <div className="rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-xs text-(--ink-soft)">
          แสดงแผนที่ไม่ได้บนเครื่องนี้ — ยังลงเวลาได้ตามปกติ
          <span className="mt-1 block break-words opacity-70">{this.state.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
