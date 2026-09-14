import { NextResponse, type NextRequest } from "next/server";
import { getSession, hasPermission } from "@smartboss/auth";
import { HR_PERMS } from "@/modules/hr/permissions";
import { formatBuddhistYear } from "@/modules/hr/lib/labels";
import {
  buildDailyLines,
  buildSummaryLines,
  csvCell,
  THAI_MONTHS,
  toCsvFile,
} from "@/modules/hr/lib/attendance-export";
import {
  loadAttendanceReport,
  resolveAttendanceRange,
} from "@/modules/hr/lib/attendance-export-data";

export const runtime = "nodejs";

/**
 * CSV รายงานการเข้างาน — ทางเลือกสำรองของหน้ารายงาน (/hr/attendance/report)
 *
 *   ?view=daily   (ค่าเริ่มต้น) หนึ่งแถวต่อคนต่อวัน
 *   ?view=summary หนึ่งแถวต่อคน
 *
 * ข้อมูลและการจัดประเภทวันใช้ชุดเดียวกับหน้ารายงาน (attendance-export-data.ts)
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.orgId || !hasPermission(session, HR_PERMS.employeeManage)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") === "summary" ? "summary" : "daily";
  const range = resolveAttendanceRange({
    month: searchParams.get("month"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });
  if (range === null) return new NextResponse("ช่วงวันที่ไม่ถูกต้อง", { status: 400 });

  const data = await loadAttendanceReport(session.orgId, range.from, range.to);
  if (data === null) {
    return new NextResponse(
      "ดึงผลลงเวลาไม่ได้ — บัญชีนี้ไม่มีสิทธิ์อ่านผลลงเวลาของทุกคน หรือระบบบุคคลไม่ตอบสนอง",
      { status: 403 },
    );
  }

  const lines =
    view === "summary"
      ? buildSummaryLines(data.results, data.ctx)
      : buildDailyLines(data.results, data.ctx);
  if (data.results.length === 0) {
    lines.push(
      csvCell(
        "ไม่มีผลลงเวลาในช่วงนี้ — ผลคำนวณมีเฉพาะวันที่เคยถูกสั่งคำนวณแล้ว ลองเปิดหน้าการลงเวลาเพื่อสั่งคำนวณย้อนหลังก่อน",
      ),
    );
  }

  const [fy, fm] = range.month.split("-").map(Number);
  const prefix = view === "summary" ? "สรุปการเข้างาน" : "การเข้างานรายวัน";
  const fileName = `${prefix}_${THAI_MONTHS[fm!]}_${formatBuddhistYear(fy!)}.csv`;

  return new NextResponse(toCsvFile(lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
