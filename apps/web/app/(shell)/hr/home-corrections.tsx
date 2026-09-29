import {
  wfFetch,
  wfTry,
  type AttendanceCorrection,
  type Employment,
  type Paged,
} from "@/modules/hr/lib/api";
import { EmptyState, SectionCard } from "@/modules/hr/components/ui";
import { HelpPopover } from "@/modules/hr/components/design-kit-client";
import { CorrectionCard } from "./attendance/corrections/correction-forms";
import { NewCorrectionButton } from "./attendance/corrections/new-correction-button";
import type { AttendanceIssue } from "./attendance/corrections/correction-forms";

interface ResultRow {
  employment_id: string;
  work_date: string;
  actual_in_at: string | null;
  actual_out_at: string | null;
  late_minutes: number;
  absence_minutes: number;
  is_on_leave: boolean;
  is_holiday: boolean;
  is_rest_day: boolean;
}

const ISSUE_DAYS = 31;

/**
 * วันที่มีปัญหาของแต่ละคน (สาย / ขาด / ไม่มีเวลาเข้า / ไม่มีเวลาออก) ย้อน 31 วัน — ให้ฟอร์มขอแก้เวลา
 * กดเลือกได้เลย ไม่ต้องไปเปิดดูทีละวันแล้วมานั่งกรอกวันที่เอง (และกรอกปีผิดเป็น พ.ศ.)
 * ข้ามวันลา/วันหยุด และวันที่มีคำขอรออยู่หรืออนุมัติแล้ว
 */
function issuesByEmployment(results: ResultRow[], corrections: AttendanceCorrection[], today: string) {
  const requested = new Set(
    corrections
      .filter((c) => c.status === "PENDING" || c.status === "APPROVED")
      .map((c) => `${c.employment_id}:${c.work_date.slice(0, 10)}`)
  );
  const out: Record<string, AttendanceIssue[]> = {};
  for (const r of results) {
    const day = r.work_date.slice(0, 10);
    if (r.is_on_leave || r.is_holiday || r.is_rest_day) continue;
    if (requested.has(`${r.employment_id}:${day}`)) continue;
    let issue: AttendanceIssue | null = null;
    if (!r.actual_in_at && !r.actual_out_at) {
      if (day < today && Number(r.absence_minutes) > 0) issue = { day, kind: "absent", intent: "CLOCK_IN", label: "ขาดงาน / ไม่มีสแกน" };
    } else if (!r.actual_in_at) {
      issue = { day, kind: "no_in", intent: "CLOCK_IN", label: "ไม่มีเวลาเข้า" };
    } else if (Number(r.late_minutes) > 0) {
      issue = { day, kind: "late", intent: "CLOCK_IN", label: `สาย ${r.late_minutes} นาที`, actualIn: r.actual_in_at };
    } else if (!r.actual_out_at && day < today) {
      issue = { day, kind: "no_out", intent: "CLOCK_OUT", label: "ไม่มีเวลาออก" };
    }
    if (!issue) continue;
    (out[r.employment_id] ??= []).push(issue);
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.day.localeCompare(a.day));
  return out;
}

/** เนื้อหาแท็บ "คำขอแก้เวลา" ของหน้าหลัก — เดิมคือหน้า /hr/attendance/corrections */
export async function renderCorrectionsTab(): Promise<React.ReactNode> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - ISSUE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [corrections, employments, results] = await Promise.all([
    // ไม่กรอง status — คิวต้องเห็นทั้งที่รอคนที่ 1/2 พร้อมกัน และเก็บ
    // ประวัติที่อนุมัติ/ปฏิเสธแล้วไว้ตรวจสอบย้อนหลังในหน้าเดียว
    wfFetch<{ items: AttendanceCorrection[] }>("/attendance-correction-requests"),
    wfFetch<Paged<Employment>>("/employments"),
    // ไม่มีสิทธิ์อ่านผลลงเวลาของทุกคน = ไม่มีปุ่มลัด ฟอร์มยังกรอกเองได้ตามปกติ
    wfTry<{ items: ResultRow[] }>(`/attendance-results?from=${from}&to=${today}`),
  ]);
  const issues = issuesByEmployment(results?.items ?? [], corrections.items, today);

  const activeEmployees = employments.items.filter((e) => e.terminated_on === null);
  const pending = corrections.items.filter((c) => c.status === "PENDING");
  const decided = corrections.items.filter((c) => c.status !== "PENDING");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-(--ink-soft)">
          ตรวจสอบและอนุมัติเวลาที่พนักงานขอแก้ไข
          <HelpPopover label="ใครอนุมัติได้บ้าง">
            การแก้เวลาลงงานกระทบเงินเดือนโดยตรง — <strong>ผู้อนุมัติต้องไม่ใช่คนที่ขอ</strong>{" "}
            เสมอ · จำนวนผู้อนุมัติที่ต้องมีตั้งได้ที่ ตั้งค่า → การลงเวลา (ค่าเริ่มต้น 1 คน
            อนุมัติแล้วมีผลทันที) ถ้าตั้งไว้ 2 คน คนที่ 2 ต้องต่างจากคนแรก และอนุมัติคนแรก
            ยังไม่มีผลจนกว่าจะครบ · ปฏิเสธได้ตลอดจนกว่าจะอนุมัติครบ
          </HelpPopover>
        </h2>
        <NewCorrectionButton employees={activeEmployees} issues={issues} />
      </div>

      <SectionCard title={`รอดำเนินการ (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>ไม่มีคำขอที่รออนุมัติ</EmptyState>
        ) : (
          <div className="space-y-3">
            {pending.map((correction) => (
              <CorrectionCard key={correction.id} correction={correction} />
            ))}
          </div>
        )}
      </SectionCard>

      {decided.length > 0 && (
        <SectionCard title={`ประวัติ (${decided.length})`}>
          <div className="space-y-3">
            {decided.map((correction) => (
              <CorrectionCard key={correction.id} correction={correction} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
