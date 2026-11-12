import { describe, expect, it } from "vitest";
import { splitReportTopics } from "@/modules/report_task/lib/report-format";

const TOPICS = [
  "🏁Common Report🏁",
  "วันนี้ส่งงานอะไร | วันนี้ส่งงาน",
  "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน",
  "ปัญหาและความเสี่ยง",
  "เรื่องที่ต้องการให้ Boss ตัดสินใจ",
  "🏁Department Module🏁",
];

const REPORT = `Daily report 10/11/69
🏁Common Report🏁
🟢 วันนี้ส่งงาน: ปิดใบแจ้งซ่อม 4 ใบ
ล้างแอร์ครบ 6 ตัว
.............................
🟡 งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน
ปั๊มน้ำบ้าน C2 รออะไหล่
🔴 1. ปัญหาและความเสี่ยง
หลังคาบ้าน A1 รั่ว
🟢เรื่องที่ต้องการให้ Boss ตัดสินใจ
- ไม่มี
🏁Department Module🏁
ตรวจสระ 3 หลัง`;

describe("splitReportTopics", () => {
  const blocks = splitReportTopics(REPORT, TOPICS);
  const of = (t: string) => blocks.find((b) => b.topic === t);

  it("แยกครบทุกหัวข้อ ใช้ชื่อหลักตามที่ตั้ง (แม้คนพิมพ์ชื่อเรียกอื่น)", () => {
    expect(blocks.map((b) => b.topic)).toEqual([
      "🏁Common Report🏁", "วันนี้ส่งงานอะไร", "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน", "ปัญหาและความเสี่ยง", "เรื่องที่ต้องการให้ Boss ตัดสินใจ", "🏁Department Module🏁",
    ]);
  });
  it("อ่านสีจากบรรทัดหัวข้อ", () => {
    expect(of("วันนี้ส่งงานอะไร")?.color).toBe("green");
    expect(of("งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน")?.color).toBe("yellow");
    expect(of("ปัญหาและความเสี่ยง")?.color).toBe("red");
  });
  it("เนื้อหา = ข้อความต่อท้ายหัวข้อ + บรรทัดถัดไปจนถึงหัวข้อถัดไป ไม่รวมเส้นจุด", () => {
    expect(of("วันนี้ส่งงานอะไร")?.content).toBe("ปิดใบแจ้งซ่อม 4 ใบ\nล้างแอร์ครบ 6 ตัว");
    expect(of("ปัญหาและความเสี่ยง")?.content).toBe("หลังคาบ้าน A1 รั่ว");
    expect(of("🏁Department Module🏁")?.content).toBe("ตรวจสระ 3 หลัง");
  });
  it("หัวส่วน 🏁 ไม่มีสี และหัวข้อที่ไม่มีในรายงานไม่ถูกใส่มา", () => {
    expect(of("🏁Common Report🏁")?.section).toBe(true);
    expect(splitReportTopics("สวัสดีครับ", TOPICS)).toEqual([]);
  });
});
