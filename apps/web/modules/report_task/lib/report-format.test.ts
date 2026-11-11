import { describe, expect, it } from "vitest";
import { checkReportFormat, formatProblem, formatTemplate, normalizeTopics } from "@/modules/report_task/lib/report-format";

const TOPICS = [
  "วันนี้ส่งงานอะไร",
  "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน",
  "ปัญหาและความเสี่ยง",
  "วิธีแก้ไขและความรับผิดชอบ",
  "เรื่องที่ต้องการให้ Boss ตัดสินใจ",
];

// รูปแบบที่ CEO ประกาศใช้จริง (มีธง เส้นจุด และเว้นวรรคหน้าหัวข้อ)
const REAL = `   🏁Common Report 🏁
🟢วันนี้ส่งงานอะไร
ปิดใบแจ้งซ่อม 4 ใบ
.............................................
🟡งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน
ปั๊มน้ำบ้าน C2 รออะไหล่
.............................................
🔴ปัญหาและความเสี่ยง
หลังคาบ้าน A1 รั่ว
.............................................
🟢วิธีแก้ไขและความรับผิดชอบ
นัดช่างพรุ่งนี้ 9:00
.............................................
🟡เรื่องที่ต้องการให้ Boss ตัดสินใจ
A 3,500 / B 12,000 แนะนำ A
   🏁Department Module🏁
ตรวจสระ 3 หลัง`;

describe("checkReportFormat", () => {
  it("รายงานตามรูปแบบจริง ผ่าน และอ่านสีได้ถูก", () => {
    const r = checkReportFormat(REAL, TOPICS, true);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.color)).toEqual(["green", "yellow", "red", "green", "yellow"]);
  });

  it("ไม่มีหัวข้อเลย = ขาดครบทุกข้อ", () => {
    const r = checkReportFormat("วันนี้ล้างแอร์ครบ 5 ตัวครับ\nปั๊มยังไม่ได้เปลี่ยน", TOPICS, true);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(TOPICS);
  });

  it("ขาดบางหัวข้อ บอกชื่อหัวข้อที่ขาด", () => {
    const text = REAL.replace("🔴ปัญหาและความเสี่ยง\nหลังคาบ้าน A1 รั่ว\n", "");
    const r = checkReportFormat(text, TOPICS, true);
    expect(r.missing).toEqual(["ปัญหาและความเสี่ยง"]);
    expect(formatProblem(r)).toContain("ปัญหาและความเสี่ยง");
  });

  it("มีหัวข้อแต่ไม่ใส่สี: ไม่ผ่านเมื่อบังคับสี ผ่านเมื่อไม่บังคับ", () => {
    const text = REAL.replace("🟢วันนี้ส่งงานอะไร", "วันนี้ส่งงานอะไร");
    expect(checkReportFormat(text, TOPICS, true).missingColor).toEqual(["วันนี้ส่งงานอะไร"]);
    expect(checkReportFormat(text, TOPICS, false).ok).toBe(true);
  });

  it("มีหัวข้อแต่ไม่มีรายละเอียดข้างใต้ (มีแค่เส้นจุด) = ไม่ผ่าน", () => {
    const text = REAL.replace("ปิดใบแจ้งซ่อม 4 ใบ\n", "");
    const r = checkReportFormat(text, TOPICS, true);
    expect(r.empty).toEqual(["วันนี้ส่งงานอะไร"]);
    expect(r.ok).toBe(false);
  });

  it("\"ไม่มี\" นับเป็นรายละเอียด", () => {
    const text = REAL.replace("ปั๊มน้ำบ้าน C2 รออะไหล่", "ไม่มี");
    expect(checkReportFormat(text, TOPICS, true).ok).toBe(true);
  });

  it("ทนกับเลขข้อ ตัวหนา ขีดนำหน้า เนื้อหาบนบรรทัดเดียวกัน และเว้นวรรคต่างกัน", () => {
    const text = [
      "**1.1 — 🟢 วันนี้ส่งงานอะไร**: ปิดงาน 4 ใบ",
      "- 2) 🟡 งานที่ล่าช้า  ผิดพลาด ไม่เป็นไปตามแผน",
      "ไม่มี",
      "🔴 ปัญหาและความเสี่ยง — หลังคารั่ว",
      "ข้อ 4 🟢วิธีแก้ไขและความรับผิดชอบ",
      "นัดช่างแล้ว",
      "5. 🟡 เรื่องที่ต้องการให้ boss ตัดสินใจ",
      "เลือก A",
    ].join("\n");
    const r = checkReportFormat(text, TOPICS, true);
    expect(r.missing).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("หัวข้อที่ทำตัวใหญ่ ใส่สีตัวอักษร/ไฮไลต์ หรือเป็นเช็กลิสต์ ยังจับได้", () => {
    const text = [
      "{{s:lg}}🟢วันนี้ส่งงานอะไร{{/s}}",
      "ปิดงาน 4 ใบ",
      "{{c:orange}}🟡งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน{{/c}}",
      "ไม่มี",
      "{{h:yellow}}{{s:xl}}🔴ปัญหาและความเสี่ยง{{/s}}{{/h}}",
      "หลังคารั่ว",
      "☐ 🟢วิธีแก้ไขและความรับผิดชอบ",
      "นัดช่างแล้ว @[ต้น (ช่าง)](user:3f2a)",
      "• 🟡 เรื่องที่ต้องการให้ Boss ตัดสินใจ",
      "{{c:red}}เลือก A{{/c}}",
    ].join("\n");
    const r = checkReportFormat(text, TOPICS, true);
    expect(r.missing).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.color)).toEqual(["green", "yellow", "red", "green", "yellow"]);
  });

  it("เปลี่ยนคำหัวข้อเอง = นับว่าขาด (ต้องใช้ชื่อหัวข้อตามที่ตั้ง)", () => {
    const r = checkReportFormat("🟢งานวันนี้\nปิดงาน 4 ใบ", ["วันนี้ส่งงานอะไร"], true);
    expect(r.missing).toEqual(["วันนี้ส่งงานอะไร"]);
  });

  it("หัวข้อสั้นไม่แย่งบรรทัดของหัวข้อยาวที่ขึ้นต้นเหมือนกัน", () => {
    const r = checkReportFormat("🔴ปัญหาและความเสี่ยง\nหลังคารั่ว\n🟢ปัญหา\nไม่มี", ["ปัญหา", "ปัญหาและความเสี่ยง"], true);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.color)).toEqual(["green", "red"]);
  });

  it("ประโยคในเนื้อหาที่มีคำของหัวข้ออยู่กลางบรรทัด ไม่นับเป็นหัวข้อ", () => {
    const r = checkReportFormat("🟢วันนี้ส่งงานอะไร\nลูกค้าถามเรื่องปัญหาและความเสี่ยงของสระ", ["วันนี้ส่งงานอะไร", "ปัญหาและความเสี่ยง"], true);
    expect(r.missing).toEqual(["ปัญหาและความเสี่ยง"]);
  });

  it("รอบที่ไม่ตั้งหัวข้อ ผ่านเสมอ", () => {
    expect(checkReportFormat("อะไรก็ได้", [], true).ok).toBe(true);
  });

  it("ใช้กับรูปแบบของแผนกอื่นได้ (ไม่ผูกกับ 5 ข้อ)", () => {
    const r = checkReportFormat("🟢BLUF - งานต่อเนื่อง\n-ตรวจปิดใบงาน\n🟡ประจำโซน\nT1 A1", ["BLUF - งานต่อเนื่อง", "ประจำโซน"], true);
    expect(r.ok).toBe(true);
  });
});

describe("normalizeTopics / formatTemplate", () => {
  it("ล้างบรรทัดว่าง ของซ้ำ อีโมจิสี และเลขข้อ", () => {
    expect(normalizeTopics("1. วันนี้ส่งงานอะไร\n\n🟢 ปัญหาและความเสี่ยง\nวันนี้ ส่งงานอะไร\n")).toEqual(["วันนี้ส่งงานอะไร", "ปัญหาและความเสี่ยง"]);
  });

  it("ฟอร์มเปล่าที่ระบบใส่ให้ เติมเนื้อหาแล้วผ่านการตรวจ", () => {
    const tpl = formatTemplate(TOPICS, true);
    expect(checkReportFormat(tpl, TOPICS, true).missing).toEqual([]);
    expect(checkReportFormat(tpl, TOPICS, true).ok).toBe(false); // ยังไม่มีรายละเอียด
    const filled = tpl.split("\n").map((l) => (l === "" ? "ไม่มี" : l)).join("\n");
    expect(checkReportFormat(filled, TOPICS, true).ok).toBe(true);
  });
});
