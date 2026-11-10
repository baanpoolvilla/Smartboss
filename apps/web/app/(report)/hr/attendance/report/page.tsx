import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPermission, requireOrg } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  buildPersonReports,
  dayOfWeek,
  formatClock,
  formatThaiDate,
  hhmm,
  THAI_MONTHS,
  type PersonReport,
  type PersonSummary,
  type StatusTag,
  type TagTone,
} from "@/modules/hr/lib/attendance-export";
import {
  currentPayPeriod,
  currentThaiMonth,
  loadAttendanceReport,
  loadPayCutoffDay,
  payPeriodRange,
  resolveAttendanceRange,
} from "@/modules/hr/lib/attendance-export-data";
import { PrintButton } from "./print-button";
import { DetailsBehaviour } from "./details-behaviour";
import { LeavePill } from "./leave-pill";
import { LeaveTypeTotals, type LeaveTypeGroup } from "./leave-type-totals";

export const dynamic = "force-dynamic";
export const metadata = { title: "รายงานการเข้างาน · Smartboss" };

/**
 * รายงานการเข้างานประจำเดือน — จัดหน้าเหมือนเอกสาร พิมพ์/บันทึก PDF ได้
 *
 * อยู่นอกกลุ่ม (shell) โดยตั้งใจ ให้ไม่มีแถบเมนูของแอปติดมาตอนพิมพ์ ตรวจสิทธิ์เองที่นี่
 * (สิทธิ์เดียวกับไฟล์ CSV เดิม) · ตัวเลขทั้งหมดมาจาก attendance-export.ts ตัวเดียวกับ CSV
 */

const TONE: Record<TagTone, string> = {
  ok: "var(--tone-ok)",
  warn: "var(--tone-warn)",
  danger: "var(--tone-danger)",
  info: "var(--tone-info)",
  muted: "var(--tone-muted)",
};

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${THAI_MONTHS[m!]} ${y! + 543}`;
}

function Tag({ tag }: { tag: StatusTag }) {
  const color = TONE[tag.tone];
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {tag.label}
    </span>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: TagTone }) {
  return (
    <div className="border-l-2 border-(--line) pl-3">
      <p className="text-[11px] text-(--ink-soft)">{label}</p>
      <p
        className="text-lg font-semibold tabular-nums text-(--ink)"
        style={tone ? { color: TONE[tone] } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

/** ตัวเลขสรุป 0 แสดงเป็น "—" ให้ช่องที่มีปัญหาเด่นขึ้นมาเอง */
function count(n: number): string {
  return n > 0 ? String(n) : "—";
}

function sumSummaries(reports: readonly PersonReport[]): PersonSummary {
  const total: PersonSummary = {
    workedDays: 0, lateCount: 0, lateMinutes: 0, earlyOutCount: 0, absentDays: 0,
    missingPunchCount: 0, leaveDays: 0, leaveByType: {}, dayOffDays: 0, offDays: 0, workedMinutes: 0,
    otPendingMinutes: 0, otApprovedMinutes: 0,
  };
  for (const { summary } of reports) {
    for (const key of Object.keys(total) as (keyof PersonSummary)[]) {
      if (key === "leaveByType") continue;
      total[key] += summary[key];
    }
    for (const [name, d] of Object.entries(summary.leaveByType)) total.leaveByType[name] = (total.leaveByType[name] ?? 0) + d;
  }
  return total;
}

/** ประเภทลา → ใครลา วันไหน (ป้ายด้านบนกดดูได้) · เรียงตามจำนวนวันมากไปน้อย */
function leaveGroups(reports: readonly PersonReport[]): LeaveTypeGroup[] {
  const map = new Map<string, LeaveTypeGroup>();
  for (const r of reports) {
    for (const d of r.days) {
      if (d.kind !== "leave") continue;
      const name = d.leaveName ?? "ลา (ไม่ระบุประเภท)";
      let g = map.get(name);
      if (!g) map.set(name, (g = { name, days: 0, people: [] }));
      g.days += 1;
      let p = g.people.find((x) => x.employmentId === r.employmentId);
      if (!p) g.people.push((p = { employmentId: r.employmentId, name: r.person.name, code: r.person.code, dates: [] }));
      p.dates.push(formatThaiDate(d.result.work_date));
    }
  }
  return [...map.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "th"));
}

function sortedLeave(s: PersonSummary): [string, number][] {
  return Object.entries(s.leaveByType).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th"));
}

const th = "border-b border-(--ink) px-2 py-1.5 text-left text-[11px] font-semibold text-(--ink-soft)";
const td = "border-b border-(--line) px-2 py-1.5 align-top";

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; employment?: string; range?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, HR_PERMS.employeeManage)) redirect("/hr");

  const sp = await searchParams;
  // รอบเงินเดือน (เช่น 26 ต.ค. – 25 พ.ย.) เมื่อบริษัทตั้งวันตัดรอบไว้ · ?range=month = ทั้งเดือนปฏิทินแบบเดิม
  const cutoff = await loadPayCutoffDay(session.orgId);
  const usePay = cutoff !== null && sp.range !== "month";
  const thisMonth = usePay ? currentPayPeriod(cutoff) : currentThaiMonth();
  const wanted = sp.month && /^\d{4}-\d{2}$/.test(sp.month) && sp.month <= thisMonth ? sp.month : thisMonth;
  const range = usePay ? payPeriodRange(wanted, cutoff) : resolveAttendanceRange({ month: wanted })!;
  const data = await loadAttendanceReport(session.orgId, range.from, range.to);

  const allReports = data ? buildPersonReports(data.results, data.ctx) : [];
  const reports = sp.employment
    ? allReports.filter((r) => r.employmentId === sp.employment)
    : allReports;
  const total = sumSummaries(reports);
  const generatedAt = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date());

  const hrefFor = (month: string, pay: boolean) =>
    `/hr/attendance/report?month=${month}${pay || cutoff === null ? "" : "&range=month"}${sp.employment ? `&employment=${sp.employment}` : ""}`;
  const monthHref = (month: string) => hrefFor(month, usePay);
  const calendarRange = resolveAttendanceRange({ month: range.month })!;
  const payRange = cutoff !== null ? payPeriodRange(range.month, cutoff) : null;
  const next = shiftMonth(range.month, 1);

  return (
    <div data-app="hr" className="min-h-screen bg-(--bg-soft) text-(--ink) print:bg-white">
      <DetailsBehaviour />
      <style>{`
        @page { size: A4; margin: 12mm; }
        details[data-day-table] > summary { list-style: none; }
        details[data-day-table] > summary::-webkit-details-marker { display: none; }
        @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      `}</style>

      <div className="border-b border-(--line) bg-(--bg) print:hidden">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/hr" className="text-sm text-(--ink-soft) hover:text-(--ink)">
            ← กลับระบบบุคคล
          </Link>
          {payRange ? (
            <div className="flex overflow-hidden rounded-md border border-(--line) text-xs" role="group" aria-label="ช่วงวันที่" data-testid="range-toggle">
              <Link
                href={hrefFor(range.month, true)}
                aria-current={usePay ? "true" : undefined}
                className={`px-3 py-2 ${usePay ? "bg-(--brand-navy,#1b2537) font-semibold text-white" : "hover:bg-(--bg-soft)"}`}
              >
                รอบเงินเดือน {formatThaiDate(payRange.from).slice(0, 5)} – {formatThaiDate(payRange.to).slice(0, 5)}
              </Link>
              <Link
                href={hrefFor(range.month, false)}
                aria-current={usePay ? undefined : "true"}
                className={`border-l border-(--line) px-3 py-2 ${usePay ? "hover:bg-(--bg-soft)" : "bg-(--brand-navy,#1b2537) font-semibold text-white"}`}
              >
                ทั้งเดือน {formatThaiDate(calendarRange.from).slice(0, 5)} – {formatThaiDate(calendarRange.to).slice(0, 5)}
              </Link>
            </div>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Link href={monthHref(shiftMonth(range.month, -1))}>
              <Button type="button" variant="outline" size="sm" aria-label="เดือนก่อน">◀</Button>
            </Link>
            <span className="min-w-28 text-center text-sm font-medium">{monthLabel(range.month)}</span>
            {next <= thisMonth ? (
              <Link href={monthHref(next)}>
                <Button type="button" variant="outline" size="sm" aria-label="เดือนถัดไป">▶</Button>
              </Link>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled aria-label="เดือนถัดไป">▶</Button>
            )}
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="month" value={range.month} />
              {cutoff !== null && !usePay ? <input type="hidden" name="range" value="month" /> : null}
              <select
                name="employment"
                defaultValue={sp.employment ?? ""}
                aria-label="เลือกพนักงาน"
                className="h-9 rounded-md border border-(--line) bg-(--bg) px-2 text-sm"
              >
                <option value="">ทุกคน</option>
                {allReports.map((r) => (
                  <option key={r.employmentId} value={r.employmentId}>
                    {r.person.code} · {r.person.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="sm">แสดง</Button>
            </form>
            <PrintButton />
          </div>
        </div>
      </div>

      <main className="mx-auto my-6 max-w-[210mm] bg-(--bg) px-6 py-8 shadow-(--shadow-card) sm:px-10 print:m-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-(--ink) pb-4">
          <div>
            <p className="text-xs font-medium text-(--ink-soft)">{data?.companyName ?? "Smartboss"}</p>
            <h1 className="mt-1 text-2xl font-bold">รายงานการเข้างาน</h1>
            <p className="mt-0.5 text-sm text-(--ink-soft)">
              {usePay ? "รอบเงินเดือน" : "ประจำเดือน"} {monthLabel(range.month)} · {formatThaiDate(range.from)} – {formatThaiDate(range.to)}
            </p>
          </div>
          <p className="text-xs text-(--ink-soft)">ออกรายงาน {generatedAt}</p>
        </header>

        {data === null ? (
          <p className="mt-8 text-sm text-(--tone-danger)">
            ดึงผลลงเวลาไม่ได้ — บัญชีนี้ไม่มีสิทธิ์อ่านผลลงเวลาของทุกคน หรือระบบบุคคลไม่ตอบสนอง
          </p>
        ) : reports.length === 0 ? (
          <p className="mt-8 text-sm text-(--ink-soft)">
            ไม่มีผลลงเวลาในเดือนนี้ — ผลคำนวณมีเฉพาะวันที่เคยถูกสั่งคำนวณแล้ว
            เปิดหน้าการลงเวลาเพื่อสั่งคำนวณย้อนหลัง 30 วันก่อน
          </p>
        ) : (
          <>
            <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Figure label="พนักงาน" value={`${reports.length} คน`} />
              <Figure label="มาสาย" value={`${total.lateCount} ครั้ง`} tone={total.lateCount ? "warn" : undefined} />
              <Figure label="ขาดงาน" value={`${total.absentDays} วัน`} tone={total.absentDays ? "danger" : undefined} />
              <Figure label="ลืมสแกน" value={`${total.missingPunchCount} ครั้ง`} tone={total.missingPunchCount ? "warn" : undefined} />
              <Figure label="OT อนุมัติแล้ว" value={hhmm(total.otApprovedMinutes) || "0:00"} />
              <Figure label="OT รออนุมัติ" value={hhmm(total.otPendingMinutes) || "0:00"} tone={total.otPendingMinutes ? "info" : undefined} />
            </section>

            {/* วันลาแยกประเภท (ผู้ใช้ 10/11/2569 "ลาให้แสดงแยกประเภทกันชัดเจน") — เดิมรวมเป็น "ลา" ตัวเดียว */}
            <section className="mt-4" data-testid="leave-type-totals">
              <h2 className="mb-2 text-sm font-semibold">วันลาแยกประเภท ({usePay ? "ทั้งรอบ" : "ทั้งเดือน"})</h2>
              <p className="-mt-1 mb-2 text-[11px] text-(--ink-soft) print:hidden">กดที่ประเภทเพื่อดูว่าใครลา วันไหน</p>
              <LeaveTypeTotals groups={leaveGroups(reports)} />
            </section>

            <section className="mt-8">
              <h2 className="mb-2 text-sm font-semibold">สรุปรายคน</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs tabular-nums">
                  <thead>
                    <tr>
                      <th className={th}>พนักงาน</th>
                      <th className={`${th} text-right`}>มาทำงาน</th>
                      <th className={`${th} text-right`}>สาย</th>
                      <th className={`${th} text-right`}>ขาดงาน</th>
                      <th className={`${th} text-right`}>ลืมสแกน</th>
                      <th className={th}>ลา (แยกประเภท)</th>
                      <th className={`${th} text-right`}>วันหยุดตามสิทธิ์</th>
                      <th className={`${th} text-right`}>ชม.ทำงาน</th>
                      <th className={`${th} text-right`}>OT อนุมัติ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map(({ employmentId, person, summary: s }) => (
                      <tr key={employmentId}>
                        <td className={`${td} whitespace-nowrap`}>
                          <a href={`#emp-${employmentId}`} className="font-medium hover:underline print:no-underline">
                            {person.name}
                          </a>
                          <span className="ml-1.5 font-mono text-[10px] text-(--ink-soft)">{person.code}</span>
                        </td>
                        <td className={`${td} text-right`}>{count(s.workedDays)}</td>
                        <td className={`${td} text-right`} style={s.lateCount ? { color: TONE.warn } : undefined}>
                          {s.lateCount ? `${s.lateCount} (${s.lateMinutes} น.)` : "—"}
                        </td>
                        <td className={`${td} text-right font-medium`} style={s.absentDays ? { color: TONE.danger } : undefined}>
                          {count(s.absentDays)}
                        </td>
                        <td className={`${td} text-right`} style={s.missingPunchCount ? { color: TONE.warn } : undefined}>
                          {count(s.missingPunchCount)}
                        </td>
                        <td className={td} data-testid="leave-by-type">
                          {s.leaveDays ? (
                            <span className="flex flex-wrap gap-1">
                              {sortedLeave(s).map(([name, d]) => (
                                <LeavePill key={name} name={name} n={d} />
                              ))}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`${td} text-right`}>{count(s.dayOffDays)}</td>
                        <td className={`${td} text-right`}>{hhmm(s.workedMinutes) || "—"}</td>
                        <td className={`${td} text-right`}>{hhmm(s.otApprovedMinutes) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-(--ink-soft)">
                ขาดงาน = ขาดเกิน 4 ชั่วโมง (นิยามเดียวกับระบบคะแนน) · ลืมสแกนเข้าหรือออกไม่นับเป็นขาดงาน
                ตามการตั้งค่าบริษัท · ตัวเลขมาจากผลคำนวณผลลงเวลา ไม่ใช่การสแกนดิบ
              </p>
            </section>

            <div className="mt-10 flex flex-wrap items-baseline gap-2 print:hidden">
              <h2 className="text-sm font-semibold">รายวันของแต่ละคน</h2>
              <p className="text-[11px] text-(--ink-soft)">กดชื่อเพื่อกางดู · ตอนพิมพ์ PDF กางทุกคนเหมือนเดิม</p>
            </div>

            {reports.map(({ employmentId, person, days, summary: s }) => (
              <section key={employmentId} id={`emp-${employmentId}`} className="mt-3 scroll-mt-4 print:mt-0 print:break-before-page">
                {/* พับไว้ก่อนให้หน้าไม่ยาว (ผู้ใช้ 10/11/2569) · ดูคนเดียว = กางเลย · พิมพ์ = กางทุกคน (details-behaviour) */}
                <details
                  data-day-table
                  open={reports.length === 1 || undefined}
                  className="group rounded-md border border-(--line) print:rounded-none print:border-0"
                >
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2.5 hover:bg-(--bg-soft) group-open:border-b group-open:border-(--ink) print:cursor-auto print:px-0 print:pb-2 print:pt-0 print:hover:bg-transparent">
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <span aria-hidden className="w-3 text-xs text-(--ink-soft) print:hidden">
                      <span className="group-open:hidden">▸</span>
                      <span className="hidden group-open:inline">▾</span>
                    </span>
                    {person.name}
                    <span className="font-mono text-xs font-normal text-(--ink-soft)">{person.code}</span>
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-(--ink-soft)">
                    <span>
                      มาทำงาน {s.workedDays} วัน · สาย {s.lateCount} ครั้ง · ขาดงาน {s.absentDays} วัน ·
                      ลืมสแกน {s.missingPunchCount} ครั้ง · ชม.ทำงาน {hhmm(s.workedMinutes) || "0:00"}
                    </span>
                    {sortedLeave(s).map(([name, d]) => (
                      <LeavePill key={name} name={name} n={d} />
                    ))}
                    <span className="ml-2 font-medium text-(--brand-navy,#1b2537) print:hidden">
                      <span className="group-open:hidden">ดูรายวัน</span>
                      <span className="hidden group-open:inline">พับ</span>
                    </span>
                  </div>
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs tabular-nums">
                    <thead>
                      <tr>
                        <th className={th}>วันที่</th>
                        <th className={th}>สถานะ</th>
                        <th className={`${th} text-right`}>เข้า</th>
                        <th className={`${th} text-right`}>ออก</th>
                        <th className={`${th} text-right`}>ชม.ทำงาน</th>
                        <th className={`${th} text-right`}>สาย (น.)</th>
                        <th className={`${th} text-right`}>OT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.result.work_date} className="break-inside-avoid">
                          <td className={`${td} whitespace-nowrap`}>
                            {formatThaiDate(d.result.work_date)}
                            <span className="ml-1 text-(--ink-soft)">{dayOfWeek(d.result.work_date)}</span>
                          </td>
                          <td className={td}>
                            <div className="flex flex-wrap gap-1">
                              {d.tags.map((tag) =>
                                d.kind === "leave" && tag.label === (d.leaveName ?? tag.label) ? (
                                  <LeavePill key={tag.label} name={tag.label} />
                                ) : (
                                  <Tag key={tag.label} tag={tag} />
                                ),
                              )}
                            </div>
                          </td>
                          <td className={`${td} text-right`}>{formatClock(d.result.actual_in_at, person.timeZone) || "—"}</td>
                          <td className={`${td} text-right`}>{formatClock(d.result.actual_out_at, person.timeZone) || "—"}</td>
                          <td className={`${td} text-right`}>{hhmm(d.result.worked_minutes) || "—"}</td>
                          <td className={`${td} text-right`}>{d.late > 0 ? d.late : "—"}</td>
                          <td className={`${td} text-right`}>
                            {d.otApprovedMinutes !== null
                              ? hhmm(d.otApprovedMinutes) || "0:00"
                              : hhmm(d.otMinutes) || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </details>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
