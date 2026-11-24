import { describe, expect, it } from "vitest";
import { tidyThaiMarks } from "./tidy-thai";

describe("tidyThaiMarks — วรรณยุกต์/สระซ้อนผิดปกติ", () => {
  it("ไม้โทซ้ำหลายสิบตัว → เหลือตัวเดียว", () => {
    expect(tidyThaiMarks("P'เซี" + "้".repeat(40) + "ย-Kanitha")).toBe("P'เซี้ย-Kanitha");
  });
  it("ข้อความปกติไม่เปลี่ยน", () => {
    for (const s of ["กี้", "น้ำ", "ที่นี่", "สวัสดีค่ะ", "ก๊วยเตี๋ยว", "P'เซี้ย-Kanitha", "Thunchanok-Nam", ""]) {
      expect(tidyThaiMarks(s)).toBe(s);
    }
  });
  it("ไม้โทนำหน้าข้อความ 29 ตัว (ไม่มีตัวอักษรรองรับ) → ตัดออกหมด", () => {
    expect(tidyThaiMarks("้".repeat(29) + " @Thunchanok-Nam รบกวนกดอนุมัติ")).toBe(" @Thunchanok-Nam รบกวนกดอนุมัติ");
    expect(tidyThaiMarks("ทดสอบ\n" + "้".repeat(5) + "บรรทัดสอง")).toBe("ทดสอบ\nบรรทัดสอง");
  });
  it("เครื่องหมายต่างกันเกิน 2 ตัวติดกัน → เก็บ 2 ตัวแรก", () => {
    expect(tidyThaiMarks("กี้่๊")).toBe("กี้");
  });
});
