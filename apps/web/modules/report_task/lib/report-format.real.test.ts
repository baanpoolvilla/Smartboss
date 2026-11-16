/**
 * ⚠ ไฟล์ทดสอบชั่วคราว (ไม่ commit) — รันตัวตรวจรูปแบบจริงกับรายงานจริงที่ query มาจากเครื่องจริง
 * ข้อมูล: D:/Smartboss/Claude outputs/daily-report-sample.json (ผลคำสั่ง SQL ที่ผู้ใช้รันบนเครื่องจริง 11/11/2569)
 */
import { existsSync, readFileSync } from "node:fs";
import { it } from "vitest";
import { checkReportFormat } from "@/modules/report_task/lib/report-format";

const FILE = "D:/Smartboss/Claude outputs/daily-report-sample.json";
const EXACT = [
  "วันนี้ส่งงานอะไร",
  "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน",
  "ปัญหาและความเสี่ยง",
  "วิธีแก้ไขและความรับผิดชอบ",
  "เรื่องที่ต้องการให้ Boss ตัดสินใจ",
];
/** ข้อความที่จะแนะนำให้วางในช่องตั้งค่าจริง — ชื่อเรียกอื่นจากรายงานจริง 4 วันล่าสุด */
const SUGGESTED = [
  "🏁Common Report🏁",
  "วันนี้ส่งงานอะไร | วันนี้ส่งงาน | วันนี้ทำงานอะไร | งานที่ดำเนินการวันนี้",
  "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน | งานที่ล่าช้า ผิดพลาด หรือไม่เป็นไปตามแผน | งานที่ล่าช้าหรือไม่เป็นไปตามแผน | งานที่ล่าช้า / ผิดแผน | งานล่าช้า/ผิดแผน | งานที่ล่าช้า / ยังไม่ปิดงาน",
  "ปัญหาและความเสี่ยง",
  "วิธีแก้ไขและความรับผิดชอบ",
  "เรื่องที่ต้องการให้ Boss ตัดสินใจ",
  "🏁Department Module🏁",
];

interface Row { room: string; at: string; round: string | null; not_report: boolean; text: string }

it.skipIf(!existsSync(FILE))("รายงานจริงจากเครื่องจริง", () => {
  const raw = readFileSync(FILE, "utf8");
  const rows = (JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)) as Row[]).filter((x) => !x.not_report && x.round === "Daily-report-Evening");
  let exact = 0, suggested = 0, cutOnly = 0;
  const lines: string[] = [];
  for (const r of rows) {
    const cut = (r.text ?? "").length >= 1500;
    const a = checkReportFormat(r.text, EXACT, true);
    const b = checkReportFormat(r.text, SUGGESTED, true);
    if (a.ok) exact += 1;
    if (b.ok) suggested += 1;
    // ข้อความถูก query ตัดที่ 1500 ตัว: ขาดแค่หัวข้อท้าย ๆ ติดกันจนจบ = ไม่ได้ขาดจริง
    const firstMissing = b.items.findIndex((i) => !i.found);
    const tailOnly = cut && !b.ok && firstMissing >= 0 && b.items.slice(firstMissing).every((i) => !i.found) && b.missingColor.length === 0;
    if (tailOnly) cutOnly += 1;
    const why = b.ok ? "ผ่าน" : `ไม่ผ่าน · ขาด [${b.missing.join(" | ")}]${b.missingColor.length ? ` · ไม่มีสี [${b.missingColor.join(" | ")}]` : ""}`;
    lines.push(`${r.at.slice(5, 16)} ตรงตัว:${a.ok ? "ผ่าน" : "ไม่"} · แนะนำ:${why}${cut ? " [ถูกตัด]" : ""}${tailOnly ? " ← ขาดเพราะถูกตัด" : ""}`);
  }
  console.log(lines.join("\n"));
  console.log(`\nรอบเย็น ${rows.length} ฉบับ · ชื่อตรงตัว ผ่าน ${exact} · ใช้ชุดที่แนะนำ ผ่าน ${suggested} (+ ${cutOnly} ฉบับที่ขาดเพราะ query ตัดข้อความ)`);
});
