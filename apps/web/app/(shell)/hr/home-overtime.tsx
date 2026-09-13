import {
  wfTry,
  type Employment,
  type LeaveRequest,
  type LeaveType,
  type Paged,
} from "@/modules/hr/lib/api";
import { EmptyState, NoPermission, Pill, SectionCard } from "@/modules/hr/components/ui";
import { HelpPopover } from "@/modules/hr/components/design-kit-client";
import { formatDate } from "@/modules/hr/lib/labels";
import { OvertimeCard, type OvertimeItem } from "./overtime-card";

/** ย้อนดู OT กี่วัน — ครอบหนึ่งรอบจ่ายรายเดือนพร้อมเผื่อ (ขอบเขตหน้าจอ ไม่ใช่กติกาจ่ายเงิน) */
const LOOKBACK_DAYS = 45;
const DAY_MS = 86_400_000;

const CATEGORY_LABEL: Record<string, string> = {
  WORKDAY: "ทำงานเกินเวลา",
  REST_DAY: "วันหยุด",
  PUBLIC_HOLIDAY: "วันนักขัตฤกษ์",
};

interface AttendanceResultRow {
  employment_id: string;
  work_date: string;
  actual_in_at: string | null;
  actual_out_at: string | null;
  ot_candidate_minutes: number;
  is_rest_day: boolean;
  is_holiday: boolean;
}

interface OvertimeRequestRow {
  id: string;
  employment_id: string;
  work_date: string;
  ot_category: string;
  actual_minutes: number;
  approved_minutes: number;
  status: string;
  decision_reason: string | null;
}

function hhmm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * เนื้อหาแท็บ "OT รออนุมัติ" — OT ที่ระบบตรวจพบจากเวลาสแกน (มาทำงานวันหยุด หรืออยู่ต่อ
 * หลังเลิกกะ) รอหัวหน้าอนุมัติ ใบลงเวลาดึงไปจ่ายเฉพาะที่อนุมัติแล้ว
 */
export async function renderOvertimeTab(): Promise<React.ReactNode> {
  // เวลาไทย — วันที่ยังไม่จบ นาที OT ยังเพิ่มได้ จึงไม่ให้ตัดสินจนกว่าจะพ้นวัน
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - LOOKBACK_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const [results, requests, employments, leaves, leaveTypes] = await Promise.all([
    wfTry<{ items: AttendanceResultRow[] }>(`/attendance-results?from=${from}&to=${today}`),
    wfTry<{ items: OvertimeRequestRow[] }>(`/overtime-requests?from=${from}&to=${today}`),
    wfTry<Paged<Employment>>("/employments"),
    wfTry<Paged<LeaveRequest>>(`/leave-requests?from=${from}&to=${today}&status=APPROVED`),
    wfTry<Paged<LeaveType>>("/leave-types"),
  ]);

  if (results === null || requests === null) return <NoPermission what="OT" />;

  const person = new Map((employments?.items ?? []).map((e) => [e.id, e]));

  // วันหยุดตามสิทธิ์ (ประเภทลาที่อนุมัติอัตโนมัติ) — ใช้ชื่อประเภทจริงเป็นป้าย เช่น "Day-Off"
  const dayOffTypeName = new Map(
    (leaveTypes?.items ?? []).filter((t) => t.auto_approve).map((t) => [t.id, t.name]),
  );
  const dayOffName = new Map<string, string>();
  for (const leave of leaves?.items ?? []) {
    const name = dayOffTypeName.get(leave.leave_type_id);
    if (name === undefined) continue;
    for (
      let t = Date.parse(`${leave.starts_on}T00:00:00Z`);
      t <= Date.parse(`${leave.ends_on}T00:00:00Z`);
      t += DAY_MS
    ) {
      dayOffName.set(`${leave.employment_id}|${new Date(t).toISOString().slice(0, 10)}`, name);
    }
  }

  const decided = requests.items.filter(
    (r) => r.status === "FINAL_APPROVED" || r.status === "REJECTED",
  );
  const decidedKeys = new Set(decided.map((r) => `${r.employment_id}|${r.work_date}`));

  const pending: OvertimeItem[] = results.items
    .filter(
      (r) =>
        r.ot_candidate_minutes > 0 &&
        r.work_date < today &&
        !decidedKeys.has(`${r.employment_id}|${r.work_date}`),
    )
    .sort((a, b) => b.work_date.localeCompare(a.work_date))
    .map((r) => {
      const key = `${r.employment_id}|${r.work_date}`;
      const employee = person.get(r.employment_id);
      return {
        employmentId: r.employment_id,
        name: employee?.full_name ?? "ไม่ทราบชื่อ",
        code: employee?.employee_code ?? "",
        workDate: r.work_date,
        dayLabel: r.is_holiday
          ? "วันนักขัตฤกษ์"
          : r.is_rest_day
            ? "วันหยุดตามกะ"
            : (dayOffName.get(key) ?? "ทำงานเกินเวลา"),
        inAt: r.actual_in_at,
        outAt: r.actual_out_at,
        detectedMinutes: r.ot_candidate_minutes,
      };
    });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-(--ink-soft)">
        OT ที่ระบบตรวจพบจากเวลาสแกน รอหัวหน้าอนุมัติ
        <HelpPopover label="OT มาจากไหน">
          ระบบนับ OT ให้เองเมื่อมาทำงานในวันหยุด (วันหยุดตามกะ วันนักขัตฤกษ์ หรือวันหยุดประจำเดือน)
          หรือทำงานเกินเวลากะ — <strong>เข้ารอบจ่ายเฉพาะรายการที่อนุมัติแล้ว</strong> ลดนาทีได้
          แต่เกินที่ตรวจพบไม่ได้ และอนุมัติ OT ของตัวเองไม่ได้ · วันนี้ยังไม่จบจึงยังไม่ขึ้นในรายการ
        </HelpPopover>
      </h2>

      <SectionCard title={`รออนุมัติ (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>ไม่มี OT ที่รออนุมัติ</EmptyState>
        ) : (
          <div className="space-y-3">
            {pending.map((item) => (
              <OvertimeCard key={`${item.employmentId}|${item.workDate}`} item={item} />
            ))}
          </div>
        )}
      </SectionCard>

      {decided.length > 0 && (
        <SectionCard title={`ตัดสินแล้ว · ${LOOKBACK_DAYS} วันล่าสุด (${decided.length})`}>
          <div className="flex flex-col divide-y divide-(--line)">
            {decided.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-(--ink)">
                    {person.get(r.employment_id)?.full_name ?? "ไม่ทราบชื่อ"}
                  </p>
                  <p className="text-xs text-(--ink-soft)">
                    {formatDate(r.work_date)} · {CATEGORY_LABEL[r.ot_category] ?? r.ot_category} ·
                    ตรวจพบ {hhmm(r.actual_minutes)} ชม.
                    {r.decision_reason ? ` · ${r.decision_reason}` : ""}
                  </p>
                </div>
                {r.status === "FINAL_APPROVED" ? (
                  <Pill tone="var(--tone-ok)">อนุมัติ {hhmm(r.approved_minutes)} ชม.</Pill>
                ) : (
                  <Pill tone="var(--tone-danger)">ไม่อนุมัติ</Pill>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
