import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@smartboss/database", () => ({ prisma: {} }));
vi.mock("@/lib/performance", () => ({ loadPerformanceSettings: vi.fn() }));
vi.mock("@/modules/report_task/lib/db/org-store", () => ({ readStore: vi.fn() }));
vi.mock("@/modules/report_task/lib/db/store-cached-read", () => ({ readStoreCached: vi.fn() }));
vi.mock("@/modules/report_task/lib/db/workforce-calendar", () => ({ withWorkforceTenant: vi.fn() }));

import { crossedClockBoundary } from "./report-sweep-inputs";

const at = (d: string) => new Date(d).getTime(); // เวลาเครื่อง

describe("crossedClockBoundary — เลยเวลาปิดรอบ/ปิดรับ/เที่ยงคืนตั้งแต่รอบที่แล้วไหม", () => {
  it("เลย 18:00 ไปแล้ว → ต้องรัน", () => {
    expect(crossedClockBoundary(["18:00"], at("2026-11-08T17:58:00"), at("2026-11-08T18:00:30"))).toBe(true);
  });
  it("ยังไม่ถึง → ไม่ต้อง", () => {
    expect(crossedClockBoundary(["18:00"], at("2026-11-08T17:55:00"), at("2026-11-08T17:59:30"))).toBe(false);
  });
  it("รอบที่แล้วรันหลัง 18:00 แล้ว → ไม่นับซ้ำ", () => {
    expect(crossedClockBoundary(["18:00"], at("2026-11-08T18:00:20"), at("2026-11-08T18:04:00"))).toBe(false);
  });
  it("ขึ้นวันใหม่ (00:00) นับเสมอแม้ไม่มีเวลาของห้อง", () => {
    expect(crossedClockBoundary([], at("2026-11-08T23:58:00"), at("2026-11-09T00:01:00"))).toBe(true);
  });
  it("เวลาแปลก ๆ ในตั้งค่าห้องไม่ทำให้พัง", () => {
    expect(crossedClockBoundary(["99:99", "ab:cd"], at("2026-11-08T10:00:00"), at("2026-11-08T10:03:00"))).toBe(false);
  });
});
