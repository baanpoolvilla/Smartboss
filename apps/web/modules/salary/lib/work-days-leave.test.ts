import { describe, expect, it } from "vitest";
import { workDayParts } from "@/modules/salary/components/work-days";

// สลิป/สรุปวันทำงาน: ลาแยกประเภท (ผู้ใช้ 10/11/2569) · รอบเก่าที่ไม่มีข้อมูลแยกยังเป็น "ลา" ก้อนเดียว
describe("workDayParts — วันลาแยกประเภท", () => {
  it("มีข้อมูลแยก → ขึ้นทีละประเภท ไม่มีช่อง 'ลา' รวม", () => {
    const parts = workDayParts({ workedDays: 20, leaveDays: 5, offDays: 2, leaveByType: { ลาป่วย: 1, ลาพักร้อน: 2 }, lateCount: 0 });
    const labels = parts.map((p) => p.label);
    expect(labels).toContain("ลาป่วย");
    expect(labels).toContain("ลาพักร้อน");
    expect(labels).not.toContain("ลา");
    expect(parts.find((p) => p.label === "ลาพักร้อน")?.value).toBe("2 วัน");
  });
  it("รอบเก่า (ไม่มี leaveByType) → 'ลา' ก้อนเดียวเหมือนเดิม", () => {
    const parts = workDayParts({ workedDays: 20, leaveDays: 5, offDays: 2, lateCount: 0 });
    expect(parts.find((p) => p.label === "ลา")?.value).toBe("3 วัน");
  });
});
