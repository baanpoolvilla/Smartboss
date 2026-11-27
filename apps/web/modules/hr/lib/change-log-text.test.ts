import { describe, expect, it } from "vitest";
import { describeWorkforce, diffDetails, fieldValue, thaiDay } from "./change-log-text";

const none = { leaveType: null };

describe("Log การบันทึกระบบบุคคล — แปลงรหัสเป็นภาษาไทย", () => {
  it("แก้เงินเดือน: ประโยคบอกเดิม→ใหม่ + แถวรายละเอียดเฉพาะที่เปลี่ยน", () => {
    const d = describeWorkforce(
      "compensation.rate.update",
      { amount: "2000.0000", pay_basis: "MONTHLY", effective_from: "2026-11-26", employment_id: "x" },
      { amount: "20000.0000", pay_basis: "MONTHLY", effective_from: "2026-11-26", employment_id: "x" },
      {},
      none,
    );
    expect(d.category).toBe("pay");
    expect(d.text).toBe("แก้เงินเดือน/ค่าจ้าง ฿2,000 → ฿20,000");
    expect(d.details).toEqual([{ label: "จำนวนเงิน", before: "฿2,000", after: "฿20,000" }]);
  });

  it("อนุมัติ/ไม่อนุมัติใบลา ใส่ชื่อประเภทลา", () => {
    expect(describeWorkforce("leave.request.decide", { status: "SUBMITTED" }, { status: "APPROVED" }, {}, { leaveType: "ลาป่วย" }).text).toBe('อนุมัติใบลา "ลาป่วย"');
    expect(describeWorkforce("leave.request.decide", { status: "SUBMITTED" }, { status: "REJECTED" }, {}, { leaveType: null }).text).toBe("ไม่อนุมัติใบลา");
  });

  it("ยื่นลา: วันที่ไทย + ระยะเวลา", () => {
    const d = describeWorkforce("leave.request.submit", null, { starts_on: "2026-11-25", total_minutes: 480 }, {}, { leaveType: "ลาพักร้อน" });
    expect(d.category).toBe("leave");
    expect(d.text).toBe('ยื่นลา "ลาพักร้อน" 25 พ.ย. 2569 (1 วัน)');
  });

  it("ตั้งค่าประเภทลา อยู่หมวดตั้งค่า ช่องแปลไทย ค่า true/false เป็นใช่/ไม่", () => {
    const d = describeWorkforce("leave.type.holiday_accrual", { accrues_from_holidays: false }, { accrues_from_holidays: true }, {}, { leaveType: "วันหยุดชดเชย" });
    expect(d.category).toBe("settings");
    expect(d.text).toBe('ตั้งการได้วันหยุดชดเชย "วันหยุดชดเชย"');
    expect(d.details).toEqual([{ label: "ได้วันหยุดชดเชยเมื่อทำงานวันหยุด", before: "ไม่", after: "ใช่" }]);
  });

  it("รหัสภายใน (_id) ไม่ขึ้น · เลขบัตรขึ้นแค่ว่าซ่อน", () => {
    const rows = diffDetails(null, { first_name: "ภีม", employment_id: "abc", national_id_present: "[REDACTED]:x" });
    expect(rows).toEqual([
      { label: "ชื่อ", before: null, after: "ภีม" },
      { label: "เลขบัตรประชาชน", before: null, after: "ซ่อนไว้" },
    ]);
  });

  it("พ้นสภาพ: บอกวันที่ และสถานะเดิม→ใหม่", () => {
    const d = describeWorkforce("people.employment.terminate", { status: "ACTIVE", terminated_on: null }, { status: "TERMINATED", terminated_on: "2026-11-10" }, {}, none);
    expect(d.category).toBe("people");
    expect(d.text).toBe("ตั้งพ้นสภาพพนักงาน วันที่ 10 พ.ย. 2569");
    expect(d.details).toContainEqual({ label: "สถานะ", before: "ทำงานอยู่", after: "พ้นสภาพ" });
  });

  it("ถ่ายรูปลงเวลา = หมวดลงเวลาปกติ (ซ่อนไว้ตั้งแต่แรก)", () => {
    expect(describeWorkforce("attendance.photo-checkin.commit", null, null, { decision: "ACCEPTED" }, none).category).toBe("checkin");
  });

  it("รหัสที่ยังไม่มีคำแปล ยังขึ้นได้ ไม่พัง", () => {
    const d = describeWorkforce("something.new", null, { foo: 1 }, {}, none);
    expect(d.text).toBe("something.new");
    expect(d.details).toEqual([{ label: "foo", before: null, after: "1" }]);
  });

  it("ค่าเล็ก ๆ", () => {
    expect(thaiDay("2026-01-05")).toBe("5 ม.ค. 2569");
    expect(fieldValue("minutes", 600)).toBe("1 วัน 2 ชม.");
    expect(fieldValue("minutes", 90)).toBe("1.5 ชม.");
    expect(fieldValue("status", "PENDING")).toBe("รออนุมัติ");
  });
});
