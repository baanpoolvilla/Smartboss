import { NextResponse, type NextRequest } from "next/server";
import { getSession, hasPermission } from "@smartboss/auth";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfTry, type Employment, type Paged } from "@/modules/hr/lib/api";

export const runtime = "nodejs";

/** ผลคำนวณผลลงเวลารายวันของคนหนึ่งคน — โครงเดียวกับ toStoredResultView ฝั่ง workforce */
interface AttendanceResult {
  employment_id: string;
  work_date: string;
  actual_in_at: string | null;
  actual_out_at: string | null;
  late_minutes: number;
  absence_minutes: number;
  early_out_minutes: number;
  worked_minutes: number;
  ot_candidate_minutes: number;
  is_rest_day: boolean;
  is_holiday: boolean;
  is_on_leave: boolean;
}

const MONTH = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const THAI_MONTHS = [
  "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * เวลาตอกบัตรตามเขตเวลาของพนักงานคนนั้น ไม่ใช่ของเครื่องที่รันหรือ UTC
 *
 * ค่าที่เก็บเป็น timestamptz ⇒ `.slice(11,16)` บน ISO string จะได้เวลา UTC
 * ซึ่งเช้ากว่าเวลาไทย 7 ชั่วโมง — คนเข้างาน 08:00 จะกลายเป็น 01:00 ในไฟล์
 * ที่ส่งให้ฝ่ายบุคคล · เขตเวลาเก็บรายคนอยู่แล้วที่ employments.time_zone
 */
function timeIn(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

/** 495 → "8:15" — ชั่วโมง:นาที อ่านง่ายกว่านาทีดิบเวลาเอาไปดูรวมทั้งเดือน */
function hhmm(minutes: number): string {
  if (minutes <= 0) return "";
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * สถานะของวันนั้นแบบคำเดียวจบ
 *
 * เรียงตามลำดับที่ "กลบ" กัน: ลา/วันหยุดมาก่อนเสมอ เพราะวันที่ไม่ต้องมาทำงาน
 * ไม่ควรถูกอ่านว่าขาดงานหรือมาสาย แม้ตัวเลขนาทีจะเป็นศูนย์เหมือนกัน
 */
function statusLabel(r: AttendanceResult): string {
  if (r.is_on_leave) return "ลา";
  if (r.is_holiday) return "วันหยุดนักขัตฤกษ์";
  if (r.is_rest_day) return "วันหยุด";
  if (r.actual_in_at === null) return r.absence_minutes > 0 ? "ขาดงาน" : "ไม่มีกะ";
  if (r.late_minutes > 0) return "มาสาย";
  return "ปกติ";
}

/** วันที่ทำงานจริง — ใช้นับ "วันทำงาน" ในสรุปรายคน */
function isWorkingDay(r: AttendanceResult): boolean {
  return r.actual_in_at !== null || r.worked_minutes > 0;
}

/**
 * CSV รายงานการเข้างานของพนักงาน — ทั้งบริษัท ช่วงวันที่ที่เลือก
 *
 * อ่านจาก `attendance-results` (ผลคำนวณที่เงินเดือนใช้อ้างอิง) ไม่ใช่กระดานสด
 * `time-event-board` เพราะกระดานสดมีแค่คนที่สแกนแล้วของวันเดียว — คนที่ขาดงาน
 * ทั้งวันจะไม่มีแถวเลย ซึ่งเป็นแถวที่สำคัญที่สุดของรายงานแบบนี้
 *
 * ⚠ ผลคำนวณมีเฉพาะวันที่เคยถูกสั่งคำนวณแล้ว (หน้า /hr สั่งย้อนหลัง 30 วันทุกครั้ง
 * ที่เปิด) ⇒ เดือนที่เก่ากว่านั้นอาจได้แถวไม่ครบ ต้องกดคำนวณก่อน
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.orgId || !hasPermission(session, HR_PERMS.employeeManage)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const now = new Date();

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

  const [employments, results] = await Promise.all([
    wfTry<Paged<Employment>>("/employments"),
    wfTry<{ items: AttendanceResult[] }>(
      `/attendance-results?from=${from}&to=${to}`
    ),
  ]);

  /*
   * wfTry กลืน 403 เป็น null — ถ้าปล่อยผ่านจะได้ไฟล์เปล่าที่ดูเหมือน "เดือนนี้
   * ไม่มีใครมาทำงาน" ซึ่งอันตรายกว่าการบอกไปตรง ๆ ว่าไม่มีสิทธิ์
   */
  if (results === null) {
    return new NextResponse(
      "ดึงผลลงเวลาไม่ได้ — บัญชีนี้ไม่มีสิทธิ์อ่านผลลงเวลาของทุกคน หรือระบบบุคคลไม่ตอบสนอง",
      { status: 403 }
    );
  }

  const people = new Map(
    (employments?.items ?? []).map((e) => [
      e.id,
      {
        code: e.employee_code,
        name: e.full_name || e.display_name,
        timeZone: e.time_zone || "Asia/Bangkok",
      },
    ])
  );
  const personOf = (id: string) =>
    people.get(id) ?? { code: "", name: "ไม่ทราบชื่อ", timeZone: "Asia/Bangkok" };

  // เรียงตามคน แล้วค่อยตามวัน — อ่านทีละคนได้ต่อเนื่อง ไม่ต้องไล่หาข้ามเดือน
  const rows = [...results.items].sort((a, b) => {
    const pa = personOf(a.employment_id);
    const pb = personOf(b.employment_id);
    return (
      pa.code.localeCompare(pb.code, "th") ||
      pa.name.localeCompare(pb.name, "th") ||
      a.work_date.localeCompare(b.work_date)
    );
  });

  const lines: string[] = [];
  lines.push(`รายงานการเข้างานของพนักงาน,${from} ถึง ${to}`);
  lines.push("");
  lines.push(
    [
      "รหัสพนักงาน", "ชื่อ", "วันที่", "วัน", "เข้างาน", "ออกงาน",
      "สาย (นาที)", "ออกก่อน (นาที)", "ขาดงาน (นาที)", "ชั่วโมงทำงาน",
      "OT (นาที)", "สถานะ",
    ].join(",")
  );

  for (const r of rows) {
    const p = personOf(r.employment_id);
    const d = new Date(`${r.work_date}T00:00:00Z`);
    lines.push(
      [
        csvCell(p.code),
        csvCell(p.name),
        csvCell(r.work_date),
        csvCell(DOW[d.getUTCDay()] ?? ""),
        csvCell(timeIn(r.actual_in_at, p.timeZone)),
        csvCell(timeIn(r.actual_out_at, p.timeZone)),
        r.late_minutes || "",
        r.early_out_minutes || "",
        r.absence_minutes || "",
        csvCell(hhmm(r.worked_minutes)),
        r.ot_candidate_minutes || "",
        csvCell(statusLabel(r)),
      ].join(",")
    );
  }

  // ── สรุปรายคน — ตัวเลขที่ฝ่ายบุคคลเอาไปใช้ต่อจริง ──
  const byPerson = new Map<string, AttendanceResult[]>();
  for (const r of rows) {
    if (!byPerson.has(r.employment_id)) byPerson.set(r.employment_id, []);
    byPerson.get(r.employment_id)!.push(r);
  }

  lines.push("");
  lines.push("สรุปรายคน");
  lines.push(
    [
      "รหัสพนักงาน", "ชื่อ", "วันทำงาน", "มาสาย (ครั้ง)", "รวมสาย (นาที)",
      "ขาดงาน (วัน)", "รวมขาดงาน (นาที)", "ลา (วัน)", "วันหยุด (วัน)",
      "รวมชั่วโมงทำงาน", "รวม OT (นาที)",
    ].join(",")
  );

  for (const [id, items] of byPerson) {
    const p = personOf(id);
    const lateDays = items.filter((r) => r.late_minutes > 0).length;
    const absentDays = items.filter(
      (r) => !r.is_on_leave && !r.is_holiday && !r.is_rest_day && r.absence_minutes > 0
    ).length;
    const sum = (pick: (r: AttendanceResult) => number) =>
      items.reduce((s, r) => s + pick(r), 0);
    lines.push(
      [
        csvCell(p.code),
        csvCell(p.name),
        String(items.filter(isWorkingDay).length),
        String(lateDays),
        String(sum((r) => r.late_minutes)),
        String(absentDays),
        String(sum((r) => r.absence_minutes)),
        String(items.filter((r) => r.is_on_leave).length),
        String(items.filter((r) => r.is_rest_day || r.is_holiday).length),
        csvCell(hhmm(sum((r) => r.worked_minutes))),
        String(sum((r) => r.ot_candidate_minutes)),
      ].join(",")
    );
  }

  if (rows.length === 0) {
    lines.push("");
    lines.push(
      csvCell(
        "ไม่มีผลลงเวลาในช่วงนี้ — ผลคำนวณมีเฉพาะวันที่เคยถูกสั่งคำนวณแล้ว ลองเปิดหน้าการลงเวลาเพื่อสั่งคำนวณย้อนหลังก่อน"
      )
    );
  }

  // BOM ให้ Excel อ่านภาษาไทยถูก (แบบเดียวกับ export ของโมดูลซ่อมบำรุง)
  const csv = "﻿" + lines.join("\r\n");
  const [fy, fm] = from.split("-").map(Number);
  const fileName = `การเข้างาน_${THAI_MONTHS[fm!]}_${fy! + 543}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
