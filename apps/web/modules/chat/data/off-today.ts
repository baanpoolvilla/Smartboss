import "server-only";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import type { ChatOffToday } from "../types";

/**
 * ใครหยุดวันนี้ (ตามเวลาไทย) และหยุดแบบไหน — ใบลา/วันหยุดที่อนุมัติแล้วและครอบคลุมวันนี้ ของระบบบุคคล
 * ใช้ขึ้นป้ายปฏิทินเล็ก ๆ บนรูปโปรไฟล์ในแชท จะได้รู้ก่อนทักว่าวันนี้เขาไม่อยู่
 *
 * หยุดเหมือนกันแต่คนละแบบ (นิยามจากเจ้าของระบบ):
 *   - "off"     = วันหยุดประจำ (Day-Off): ประเภทที่ระบบอนุมัติให้อัตโนมัติ เกณฑ์เดียวกับปฏิทินของรายงาน
 *   - "leave"   = วันลา: ป่วย กิจ พักร้อน ไม่รับค่าจ้าง — ประเภทอื่นทั้งหมดที่ต้องมีคนอนุมัติ
 *   - "holiday" = วันหยุดของเดือนนั้นที่ HR ตั้งไว้ในปฏิทินวันหยุด (holidayToday ด้านล่าง — หยุดทั้งบริษัท)
 *                 หรือใบที่ประเภทชื่อ Holiday ตรง ๆ (กรณี HR ให้เลือกวันใช้สิทธิ์เป็นรายคน)
 * ไม่นับประเภทที่ยังต้องทำงาน (requires_reports เช่น WFH) — วันนั้นเขายังทำงานอยู่
 * ผูกคนด้วยเส้นเดียวกับปฏิทินของรายงาน: employment → person → principal.subject (= userId ของ SmartBoss)
 * อ่านไม่ได้ (ยังไม่เปิดระบบบุคคล ฯลฯ) = ไม่มีใครขึ้นป้าย ไม่ทำให้แชทพัง
 */
const HOLIDAY_NAME = /holiday|ฮอลิเดย์|นักขัตฤกษ์/i;
const RANK: Record<ChatOffToday["kind"], number> = { off: 0, holiday: 1, leave: 2 };

/** วันนี้เป็นวันหยุดในปฏิทินวันหยุดของบริษัทไหม (HR ตั้งรายเดือนที่ บุคคล → ตั้งค่า → วันหยุด) — คืนชื่อวันหยุด */
export async function holidayToday(orgId: string): Promise<string | null> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  try {
    const rows = await withWorkforceTenant(orgId, (tx) =>
      tx.$queryRaw<{ name: string | null }[]>`
        SELECT hd.name FROM workforce.holiday_dates hd WHERE hd.holiday_date = ${today}::date LIMIT 1
      `
    );
    return rows.length > 0 ? (rows[0]!.name ?? "").trim() || "วันหยุด" : null;
  } catch (err) {
    console.error("[chat] holiday-today lookup failed", err);
    return null;
  }
}

export async function offTodayByUser(orgId: string): Promise<Record<string, ChatOffToday>> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  try {
    const rows = await withWorkforceTenant(orgId, (tx) =>
      tx.$queryRaw<{ user_id: string | null; type_name: string | null; auto_approve: boolean | null }[]>`
        SELECT p.subject AS user_id, lt.name AS type_name, lt.auto_approve
        FROM workforce.leave_requests lr
        JOIN workforce.employments e ON e.id = lr.employment_id
        JOIN workforce.principals  p ON p.person_id = e.person_id
        LEFT JOIN workforce.leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.status = 'APPROVED'
          AND lr.starts_on <= ${today}::date
          AND lr.ends_on   >= ${today}::date
          AND COALESCE(lt.requires_reports, false) = false
        LIMIT 2000
      `
    );
    const out: Record<string, ChatOffToday> = {};
    for (const r of rows) {
      if (!r.user_id) continue;
      const name = (r.type_name ?? "").trim() || "หยุด";
      const kind: ChatOffToday["kind"] = HOLIDAY_NAME.test(name) ? "holiday" : r.auto_approve ? "off" : "leave";
      const prev = out[r.user_id];
      // วันเดียวมีหลายใบ (ไม่ควรเกิด) → เอาแบบที่ "หยุดเต็มตัว" กว่า
      if (!prev || RANK[kind] < RANK[prev.kind]) out[r.user_id] = { kind, name };
    }
    return out;
  } catch (err) {
    console.error("[chat] off-today lookup failed", err);
    return {};
  }
}
