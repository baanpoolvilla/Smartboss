import { NextResponse, type NextRequest } from "next/server";
import { getSession, hasPermission } from "@smartboss/auth";
import { ABSENCE_THRESHOLD_MINUTES, loadPerformanceSettings } from "@/lib/performance";
import { HR_PERMS } from "@/modules/hr/permissions";
import { formatBuddhistYear } from "@/modules/hr/lib/labels";
import {
  wfTry,
  type Employment,
  type LeaveRequest,
  type LeaveType,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  buildDailyLines,
  buildSummaryLines,
  csvCell,
  dayKey,
  toCsvFile,
  type ExportAttendanceResult,
  type ExportContext,
  type ExportOvertimeDecision,
} from "@/modules/hr/lib/attendance-export";

export const runtime = "nodejs";

interface OvertimeRequestRow extends ExportOvertimeDecision {
  employment_id: string;
  work_date: string;
}

const MONTH = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const THAI_MONTHS = [
  "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/**
 * CSV รายงานการเข้างาน — ทั้งบริษัท ช่วงวันที่ที่เลือก
 *
 *   ?view=daily   (ค่าเริ่มต้น) หนึ่งแถวต่อคนต่อวัน
 *   ?view=summary หนึ่งแถวต่อคน
 *
 * แยกเป็นสองไฟล์แทนที่จะต่อสรุปไว้ท้ายตารางรายวัน — ตารางสองชุดคอลัมน์ไม่ตรงกันใน
 * ชีตเดียวทำให้ Excel กรอง/เรียงข้อมูลไม่ได้ วิธีจัดประเภทวันอยู่ที่ attendance-export.ts
 *
 * อ่านจาก `attendance-results` (ผลคำนวณที่เงินเดือนใช้อ้างอิง) ไม่ใช่กระดานสด เพราะ
 * กระดานสดไม่มีแถวของคนที่ไม่มาเลย ⚠ ผลคำนวณมีเฉพาะวันที่เคยถูกสั่งคำนวณ
 * (หน้า /hr สั่งย้อนหลัง 30 วันทุกครั้งที่เปิด) เดือนที่เก่ากว่านั้นอาจได้แถวไม่ครบ
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.orgId || !hasPermission(session, HR_PERMS.employeeManage)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const view = searchParams.get("view") === "summary" ? "summary" : "daily";

  // รับได้สองแบบ: ?month=YYYY-MM (ปุ่มบนหน้าจอ) หรือ ?from=&to= (เรียกเอง)
  const monthParam = searchParams.get("month");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  let from: string;
  let to: string;
  if (fromParam && toParam && ISO_DATE.test(fromParam) && ISO_DATE.test(toParam)) {
    from = fromParam;
    to = toParam;
  } else {
    const month =
      monthParam && MONTH.test(monthParam)
        ? monthParam
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    from = `${month}-01`;
    to = `${month}-${String(lastDay).padStart(2, "0")}`;
  }
  if (to < from) return new NextResponse("ช่วงวันที่ไม่ถูกต้อง", { status: 400 });

  const [employments, results, leaves, leaveTypes, overtime, settings] = await Promise.all([
    wfTry<Paged<Employment>>("/employments"),
    wfTry<{ items: ExportAttendanceResult[] }>(`/attendance-results?from=${from}&to=${to}`),
    // ผลลงเวลาบอกได้แค่ "ลาหรือไม่" ต้องดึงใบจริงมาถึงจะแยกวันหยุดตามสิทธิ์ออกจากลาป่วยได้
    // ⚠ API คืนสูงสุด 500 ใบ — ใบที่เกินจะตกไปใช้ป้าย "ลา" (หยาบกว่า ไม่ผิด)
    wfTry<Paged<LeaveRequest>>(`/leave-requests?from=${from}&to=${to}&status=APPROVED`),
    wfTry<Paged<LeaveType>>("/leave-types"),
    wfTry<{ items: OvertimeRequestRow[] }>(`/overtime-requests?from=${from}&to=${to}`),
    loadPerformanceSettings(session.orgId),
  ]);

  // wfTry กลืน 403 เป็น null — ไฟล์เปล่าจะดูเหมือน "ไม่มีใครมาทำงาน" ซึ่งอันตรายกว่าบอกตรง ๆ
  if (results === null) {
    return new NextResponse(
      "ดึงผลลงเวลาไม่ได้ — บัญชีนี้ไม่มีสิทธิ์อ่านผลลงเวลาของทุกคน หรือระบบบุคคลไม่ตอบสนอง",
      { status: 403 },
    );
  }

  const leaveTypeById = new Map((leaveTypes?.items ?? []).map((t) => [t.id, t]));
  const leaveByDay = new Map<string, { name: string; dayOff: boolean }>();
  for (const leave of leaves?.items ?? []) {
    const type = leaveTypeById.get(leave.leave_type_id);
    if (type === undefined) continue;
    const end = Date.parse(`${leave.ends_on}T00:00:00Z`);
    for (let t = Date.parse(`${leave.starts_on}T00:00:00Z`); t <= end; t += 86_400_000) {
      leaveByDay.set(dayKey(leave.employment_id, new Date(t).toISOString().slice(0, 10)), {
        name: type.name,
        dayOff: type.auto_approve,
      });
    }
  }

  const decisionByDay = new Map<string, ExportOvertimeDecision>();
  for (const row of overtime?.items ?? []) {
    if (row.status === "FINAL_APPROVED" || row.status === "REJECTED") {
      decisionByDay.set(dayKey(row.employment_id, row.work_date), row);
    }
  }

  const people = new Map(
    (employments?.items ?? []).map((e) => [
      e.id,
      { code: e.employee_code, name: e.full_name || e.display_name, timeZone: e.time_zone || "Asia/Bangkok" },
    ]),
  );

  const ctx: ExportContext = {
    rules: {
      absenceThresholdMinutes: ABSENCE_THRESHOLD_MINUTES,
      missingPunchCountsAsAbsent: settings.missingPunchCountsAsAbsent,
    },
    personOf: (id) => people.get(id) ?? { code: "", name: "ไม่ทราบชื่อ", timeZone: "Asia/Bangkok" },
    leaveOf: (key) => leaveByDay.get(key),
    overtimeOf: overtime === null ? null : (key) => decisionByDay.get(key),
  };

  const lines =
    view === "summary" ? buildSummaryLines(results.items, ctx) : buildDailyLines(results.items, ctx);
  if (results.items.length === 0) {
    lines.push(
      csvCell(
        "ไม่มีผลลงเวลาในช่วงนี้ — ผลคำนวณมีเฉพาะวันที่เคยถูกสั่งคำนวณแล้ว ลองเปิดหน้าการลงเวลาเพื่อสั่งคำนวณย้อนหลังก่อน",
      ),
    );
  }

  const [fy, fm] = from.split("-").map(Number);
  const prefix = view === "summary" ? "สรุปการเข้างาน" : "การเข้างานรายวัน";
  const fileName = `${prefix}_${THAI_MONTHS[fm!]}_${formatBuddhistYear(fy!)}.csv`;

  return new NextResponse(toCsvFile(lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
