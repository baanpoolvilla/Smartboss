import { describe, expect, it } from "vitest";
import { checkReportFormat } from "@/modules/report_task/lib/report-format";
import { COMMON_REPORT_ROWS, rowsFromTopics, topicsFromRows } from "./round-topics-editor";

describe("ตั้งหัวข้อเป็นแถว ↔ ค่าที่เก็บ", () => {
  it("รอบเดิม (ชื่อเรียกอื่นแบบ |) เปิดมาแก้แล้วบันทึก ได้ค่าเดิม", () => {
    const old = ["🏁Common Report🏁", "วันนี้ส่งงานอะไร | วันนี้ส่งงาน", "ปัญหาและความเสี่ยง"];
    const rows = rowsFromTopics(old);
    expect(rows[0]).toMatchObject({ kind: "section", name: "Common Report" });
    expect(rows[1]).toMatchObject({ kind: "topic", name: "วันนี้ส่งงานอะไร", aliases: ["วันนี้ส่งงาน"], keywords: "" });
    expect(topicsFromRows(rows)).toEqual(old);
  });

  it("คำหลักเก็บเป็น ~ และอ่านกลับได้", () => {
    const saved = topicsFromRows([{ kind: "topic", name: "งานที่ล่าช้า", keywords: "ล่าช้า, ผิดแผน", aliases: [] }]);
    expect(saved).toEqual(["งานที่ล่าช้า | ~ล่าช้า | ~ผิดแผน"]);
    expect(rowsFromTopics(saved)[0]!.keywords).toBe("ล่าช้า, ผิดแผน");
  });

  it("แถวว่างไม่ถูกบันทึก · พิมพ์ | ~ 🏁 ในชื่อไม่ทำให้ค่าเพี้ยน", () => {
    expect(topicsFromRows([{ kind: "topic", name: "  ", keywords: "x", aliases: [] }])).toEqual([]);
    expect(topicsFromRows([{ kind: "topic", name: "ก|ข~🏁", keywords: "", aliases: [] }])).toEqual(["กข"]);
  });

  it("หัวข้อแรกแบบเลขข้อ + คำอื่น (เจอจริง 12–15 พ.ย.) นับเป็น วันนี้ส่งงานอะไร", () => {
    const topics = topicsFromRows(COMMON_REPORT_ROWS);
    for (const h of ["🟢 1.1 งานที่ดำเนินการวันนี้", "1.1 งานที่ส่งมอบวันนี้", "1.1 ผลงานที่ดำเนินการสำเร็จวันนี้"]) {
      expect(checkReportFormat(`${h}
ตรวจบ้าน 5 หลัง`, topics, false).missing).not.toContain("วันนี้ส่งงานอะไร");
    }
  });

  it("แบบสำเร็จรูป Common Report ผ่านรายงานที่เขียนชื่อใกล้เคียง", () => {
    const text = ["🏁 Common Report 🏁", "🟢 วันนี้ส่งงาน: ส่งแบบบ้าน", "🟡 งานล่าช้า / งานค้าง: รอช่าง", "🟢 ปัญหาและอุปสรรค: ไม่มี", "🟢 วิธีแก้ไข: โทรตามช่าง", "🟢 เรื่องที่ต้องการให้ Boss ตัดสินใจ: ไม่มี", "🏁 Department Module (Marketing) 🏁", "ยิงแอด 3 ตัว"].join("\n");
    expect(checkReportFormat(text, topicsFromRows(COMMON_REPORT_ROWS), true).ok).toBe(true);
  });
});
