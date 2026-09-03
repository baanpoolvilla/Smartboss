import Link from "next/link";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfTry,
  type AttendanceException,
  type AttendanceSummary,
  type Employment,
  type Paged,
  type RawTimeEvent,
  type RecurringPattern,
  type TimeEvent,
} from "@/modules/hr/lib/api";
import { AttendanceTimeline } from "@/modules/hr/components/attendance-timeline";
import {
  DataTable,
  EmptyState,
  NoPermission,
  Pill,
  SectionCard,
  StatCard,
  Td,
} from "@/modules/hr/components/ui";
import { formatMinutes } from "@/modules/hr/lib/labels";
import { autoRecalculateAttendance } from "@/modules/hr/lib/auto-recalculate";
import { RecalculateForm } from "./recalculate-form";
import { AutoRefresh } from "./auto-refresh";

/**
 * เครื่องคำนวณบอกสาเหตุไว้ครบอยู่แล้ว แต่ไม่เคยมีหน้าจอไหนแสดง —
 * ผู้ใช้จึงเห็นแค่ 0 ทุกช่องโดยไม่มีทางรู้ว่าต้องไปทำอะไรต่อ
 */
const EXCEPTION_INFO: Record<string, { label: string; fix: string }> = {
  NO_SHIFT_ASSIGNED: {
    label: "ยังไม่ได้ผูกกะ",
    // ผูกกะรายคนอยู่ในหน้าของพนักงานคนนั้น ไม่ใช่หน้าตั้งค่ารวม — ชี้ผิดที่
    // แปลว่าคนอ่านเดินไปแล้วผูกไม่ได้ ต้องเด้งกลับมาหาอีกทอด
    fix: "สแกนแล้วแต่ระบบไม่รู้ว่าวันนั้นควรเข้ากี่โมง — ไปที่ พนักงาน → เลือกคน → “ผูกกะ” เลือกกะของคนนั้น แล้วสั่งคำนวณใหม่",
  },
  POLICY_NOT_FOUND: {
    label: "ยังไม่มีนโยบายการทำงาน",
    fix: "สร้างนโยบายที่หน้า “ตั้งค่า HR” แล้วผูกเข้ากับกะ",
  },
  MISSING_IN: { label: "ไม่มีเวลาเข้า", fix: "ลืมสแกนตอนเข้า — แก้ที่คำขอปรับผลลงเวลา" },
  MISSING_OUT: { label: "ไม่มีเวลาออก", fix: "ลืมสแกนตอนออก — แก้ที่คำขอปรับผลลงเวลา" },
  DUPLICATE_PUNCH: { label: "สแกนซ้ำ", fix: "ระบบตัดให้แล้ว ไม่ต้องทำอะไร" },
  EXCESSIVE_WORK_DURATION: {
    label: "ทำงานยาวผิดปกติ",
    fix: "อาจลืมสแกนออกแล้วมาสแกนวันถัดไป — ตรวจก่อนอนุมัติ",
  },
  UNAPPROVED_OT: { label: "OT ยังไม่ได้อนุมัติ", fix: "รออนุมัติก่อนจึงจะนับเป็น OT" },
  BREAK_VIOLATION: { label: "พักไม่ตรงตามกำหนด", fix: "ตรวจช่วงพักของกะนั้น" },
  INACTIVE_EMPLOYMENT: {
    label: "ยังไม่เริ่มงาน / พ้นสภาพแล้ว",
    fix: "วันที่คำนวณอยู่นอกช่วงสัญญาจ้าง — ตรวจวันเริ่มงานที่หน้าพนักงาน",
  },
  PENDING_EVIDENCE_REVIEW: { label: "รอตรวจหลักฐาน", fix: "รอผู้ดูแลตรวจ" },
};

function rangeForDays(days: number): { from: string; to: string } {
  const today = new Date();
  const past = new Date(today.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(past), to: iso(today) };
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;

  return (
    <HrPage
      title="การลงเวลา"
      // เปิดให้ทุกคนที่เข้าโมดูลได้ — พนักงานต้องเห็นว่าใครมาถึงกี่โมง
      // ส่วนสรุปผล/สั่งคำนวณยังต้องมีสิทธิ์ ซ่อนเป็นส่วน ๆ ข้างล่าง
      permission={HR_PERMS.access}
      load={async () => {
        const preset = rangeForDays(days);
        const from = sp.from ?? preset.from;
        const to = sp.to ?? preset.to;

        const today = new Date().toISOString().slice(0, 10);

        // สั่งคำนวณแบบไม่รอผล — ปุ่ม "สั่งคำนวณ" ข้างล่างยังอยู่ไว้กดเองได้เวลา
        // แก้กะ/อนุมัติลาย้อนหลังแล้วอยากให้ผลอัปเดตทันที แต่กรณีปกติไม่ต้องรอ
        // ใครกดก่อนถึงจะเห็นตัวเลข (ดูเหตุผลเต็มที่ auto-recalculate.ts)
        //
        // ⚠ ห้าม await ตรงนี้ — งานนี้ยิงคำนวณทีละคนจนครบทุกคน ใช้เวลาหลาย
        // วินาที การรอให้จบก่อนเรนเดอร์ทำให้หน้านี้ค้างทุกครั้งที่เปิด
        void autoRecalculateAttendance(from, to);

        const [summary, employments, exceptions, board, timeline, raw, shifts, todayAssignments] =
          await Promise.all([
            wfTry<AttendanceSummary>(`/attendance-summary?from=${from}&to=${to}`),
            wfTry<Paged<Employment>>("/employments"),
            wfTry<{ items: AttendanceException[] }>(
              `/attendance-exceptions?from=${from}&to=${to}&status=OPEN`,
            ),
            // ทุกคนเรียกได้ — ชื่อ + เวลา + สถานะสาย/ปกติ
            wfTry<{
              items: {
                employment_id: string;
                display_name: string;
                employee_code: string;
                first_scan_at: string;
                last_scan_at: string;
                scan_count: number;
                scheduled_start_minutes: number | null;
                status: "ON_TIME" | "LATE" | "REST_DAY" | "NO_SHIFT";
                late_minutes: number;
              }[];
            }>(`/time-event-board?date=${today}`),
            // การตอกบัตรทีละครั้งของวันนี้ — ข้อมูลของ Timeline ด้านบนสุด
            wfTry<{ items: TimeEvent[] }>(`/time-events?date=${today}`),
            // รายละเอียดสำหรับผู้ดูแล (คะแนน/slot/แถวที่จับคู่ไม่ได้)
            wfTry<{ items: RawTimeEvent[] }>(
              `/raw-time-events?from=${from}&to=${to}&limit=300`,
            ),
            // ใช้บอกว่ากะวันนี้เป็นวันหยุดไหม (rest_day) และเข้ากี่โมง — ต้องมีสำหรับคนที่ยังไม่สแกน
            wfTry<Paged<{ id: string; rest_day: boolean; start_minutes: number }>>("/shifts"),
            // ตารางที่ประกาศไว้แล้วของวันนี้ (ทุกคน) — ชนะตารางประจำสัปดาห์เสมอ
            wfTry<{ items: { employment_id: string; shift_id: string | null }[] }>(
              `/shift-assignments?from=${today}&to=${today}`,
            ),
          ]);

        /*
         * ไม่บล็อกทั้งหน้าเมื่ออ่านสรุปไม่ได้ — พนักงานทั่วไปไม่มี
         * attendance.read.all แต่ต้องเห็นกระดานว่าใครมาถึงแล้วบ้าง
         * ตัวชี้ขาดว่าเข้าหน้านี้ได้ไหมคือกระดาน ซึ่งทุกคนเรียกได้
         */
        if (board === null && summary === null) {
          return <NoPermission what="การลงเวลา" />;
        }

        const nameOf = (employmentId: string) =>
          (employments?.items ?? []).find((e) => e.id === employmentId)?.full_name ??
          employmentId.slice(0, 8);

        const canSeeResults = summary !== null;
        const t = summary?.totals;

        const arrivals = board?.items ?? [];
        const clock = (iso: string) =>
          new Date(iso).toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Bangkok",
          });
        /** 480 → "08:00" — เวลาเข้างานตามกะเก็บเป็นนาทีจากเที่ยงคืน */
        const fromMinutes = (m: number) =>
          `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        const lateCount = arrivals.filter((a) => a.status === "LATE").length;

        const activePeople = (employments?.items ?? [])
          .filter((e) => e.terminated_on === null)
          .map((e) => ({ id: e.id, label: `${e.employee_code} · ${e.full_name}` }));

        /*
         * "การลงเวลาวันนี้" เดิมอ่านจากกระดานสด (/time-event-board) ที่มีแถวเฉพาะ
         * คนที่สแกนแล้ว — คนที่ควรมาทำงานแต่ไม่มาสแกนเลยจะไม่ปรากฏในตารางนี้เลย
         * ทั้งที่เป็นเคสสำคัญที่สุด (ขาดงาน) ผสมคนที่ยังไม่สแกนเข้าไปด้วย โดยหา
         * กะของวันนี้จากตารางที่ประกาศแล้ว (roster) ก่อน — ถ้าไม่มีค่อยย้อนไปดู
         * ตารางประจำสัปดาห์ (recurring pattern) ทีละคน (roster ชนะ pattern เสมอ
         * ตรงกับที่ resolveShiftId ฝั่ง API ใช้)
         */
        const scannedIds = new Set(arrivals.map((a) => a.employment_id));
        const restShiftIds = new Set(
          (shifts?.items ?? []).filter((sh) => sh.rest_day).map((sh) => sh.id),
        );
        const startMinutesByShift = new Map(
          (shifts?.items ?? []).map((sh) => [sh.id, sh.start_minutes]),
        );
        const todayAssignmentByEmployment = new Map(
          (todayAssignments?.items ?? []).map((a) => [a.employment_id, a.shift_id]),
        );
        const missingPeople = (employments?.items ?? []).filter(
          (e) => e.terminated_on === null && !scannedIds.has(e.id),
        );

        const DOW_FIELDS = [
          "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
        ] as const;
        const todayDowField = DOW_FIELDS[new Date(`${today}T00:00:00Z`).getUTCDay()]!;

        const needsPatternLookup = missingPeople.filter(
          (e) => !todayAssignmentByEmployment.has(e.id),
        );
        const patterns = await Promise.all(
          needsPatternLookup.map((e) =>
            wfTry<{ items: RecurringPattern[] }>(
              `/recurring-work-patterns?employment_id=${e.id}`,
            ),
          ),
        );
        const patternByEmployment = new Map(
          needsPatternLookup.map((e, i) => [e.id, patterns[i]]),
        );

        const missingRows = missingPeople.map((e) => {
          let shiftId: string | null;
          if (todayAssignmentByEmployment.has(e.id)) {
            shiftId = todayAssignmentByEmployment.get(e.id) ?? null;
          } else {
            const open = patternByEmployment
              .get(e.id)
              ?.items.find((p) => p.effective_to === null);
            shiftId = open ? open[todayDowField].id : null;
          }
          const status: "ABSENT" | "REST_DAY" | "NO_SHIFT" =
            shiftId === null
              ? "NO_SHIFT"
              : restShiftIds.has(shiftId)
                ? "REST_DAY"
                : "ABSENT";
          return {
            employment_id: e.id,
            display_name: e.full_name,
            employee_code: e.employee_code,
            status,
            scheduled_start_minutes: shiftId === null ? null : (startMinutesByShift.get(shiftId) ?? null),
          };
        });
        const absentCount = missingRows.filter((m) => m.status === "ABSENT").length;

        // จัดกลุ่มตามสาเหตุ — 31 วัน x 2 คน ที่ติดเรื่องเดียวกันคือปัญหาเดียว
        // ไม่ใช่ 62 ปัญหา แสดงเรียงรายวันจะกลบสาระจนหาไม่เจอว่าต้องแก้อะไร
        const openExceptions = exceptions?.items ?? [];
        const grouped = new Map<
          string,
          { code: string; count: number; blocking: boolean; people: Set<string> }
        >();
        for (const ex of openExceptions) {
          const bucket = grouped.get(ex.code) ?? {
            code: ex.code,
            count: 0,
            blocking: false,
            people: new Set<string>(),
          };
          bucket.count += 1;
          bucket.blocking = bucket.blocking || ex.blocking;
          bucket.people.add(ex.employment_id);
          grouped.set(ex.code, bucket);
        }
        const issues = [...grouped.values()].sort(
          (a, b) => Number(b.blocking) - Number(a.blocking) || b.count - a.count,
        );

        return (
          <>
            {/*
              Timeline — เห็นทุกครั้งที่มีคนตอกบัตร ไม่ใช่แค่ครั้งแรก/ครั้งสุดท้าย
              ของแต่ละคนแบบตารางเดิม ซึ่งทำให้การตอกระหว่างวัน (พัก/ออกไปไซต์งาน
              แล้วกลับ) หายไปหมด และไม่มีทางรู้ว่าแต่ละครั้งลงผ่านช่องทางไหน
            */}
            <SectionCard
              title={`การลงเวลาวันนี้ · ${activePeople.length} คน`}
              description={[
                `ลงเวลาแล้ว ${arrivals.length} คน`,
                `${timeline?.items.length ?? 0} ครั้ง`,
                lateCount > 0 ? `มาสาย ${lateCount} คน` : null,
                absentCount > 0 ? `ขาดงาน ${absentCount} คน` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              className="mb-4"
            >
              {activePeople.length === 0 ? (
                <EmptyState>ยังไม่มีพนักงานในระบบ</EmptyState>
              ) : (
                <AttendanceTimeline events={timeline?.items ?? []} />
              )}
              <p className="mt-3 text-xs text-(--ink-soft)">
                อ่านจากการสแกนสด ๆ ไม่ต้องรอสั่งคำนวณ — ตัวเลขสรุปรายเดือนและ OT
                ยังต้องกดคำนวณตามเดิม · ไอคอนขวามือบอกช่องทางที่ใช้ลงเวลา
                (เครื่องสแกนนิ้ว / แอปมือถือ / เว็บ / เจ้าหน้าที่บันทึกให้)
              </p>
            </SectionCard>

            {/*
              คนที่ยังไม่ตอกเลยวันนี้ — ไม่มี event ให้แสดงใน Timeline โดยธรรมชาติ
              แต่เป็นเคสที่ควรเห็นชัดที่สุด จึงแยกเป็นส่วนของตัวเองแทนที่จะหายไป
            */}
            {missingRows.length > 0 && (
              <SectionCard
                title={`ยังไม่ลงเวลาวันนี้ · ${missingRows.length} คน`}
                description="คนที่ควรเข้ากะวันนี้แต่ยังไม่มีการสแกนเลย"
                className="mb-4"
              >
                <DataTable head={["พนักงาน", "เข้างาน", "สแกนล่าสุด", "ตามกะ", "สถานะ"]}>
                  {missingRows.map((m) => (
                    <tr key={m.employment_id} className="hover:bg-(--bg-soft)">
                      <Td>
                        <span className="font-medium">{m.display_name}</span>
                        <span className="ml-2 font-mono text-xs text-(--ink-soft)">
                          {m.employee_code}
                        </span>
                      </Td>
                      <Td className="font-mono text-(--ink-soft)">—</Td>
                      <Td className="font-mono text-(--ink-soft)">—</Td>
                      <Td className="font-mono text-(--ink-soft)">
                        {m.scheduled_start_minutes === null
                          ? "—"
                          : fromMinutes(m.scheduled_start_minutes)}
                      </Td>
                      <Td>
                        {m.status === "REST_DAY" ? (
                          <Pill tone="var(--tone-info)">วันหยุด</Pill>
                        ) : m.status === "ABSENT" ? (
                          <Pill tone="var(--danger)">ขาดงาน</Pill>
                        ) : (
                          <Link
                            href={`/hr/employees/${m.employment_id}`}
                            className="hover:underline"
                            title="ไปผูกกะของคนนี้"
                          >
                            <Pill tone="var(--tone-muted)">ยังไม่ผูกกะ →</Pill>
                          </Link>
                        )}
                      </Td>
                    </tr>
                  ))}
                </DataTable>
                <p className="mt-3 text-xs text-(--ink-soft)">
                  &ldquo;ยังไม่ผูกกะ&rdquo; แปลว่าระบบไม่รู้ว่าคนนั้นควรเข้ากี่โมง จึงบอกไม่ได้ว่า
                  สายหรือไม่ — กดที่ป้ายนั้นเพื่อไปตั้งตารางกะของเขา ·
                  &ldquo;ขาดงาน&rdquo; คือคนที่ควรเข้ากะวันนี้แต่ยังไม่มีการสแกนเลยตลอดวัน
                </p>
              </SectionCard>
            )}

            {canSeeResults && (
              <RecalculateForm people={activePeople} from={from} to={to} />
            )}

            {issues.length > 0 && (
              <SectionCard
                title="สิ่งที่ทำให้ผลลงเวลายังไม่ออก"
                description="ระบบคำนวณแล้วแต่ติดเรื่องพวกนี้ — แก้แล้วสั่งคำนวณใหม่อีกครั้ง"
                className="mb-4"
              >
                <DataTable head={["สาเหตุ", "จำนวนวัน", "พนักงาน", "ต้องทำอะไร"]}>
                  {issues.map((issue) => {
                    const info = EXCEPTION_INFO[issue.code];
                    return (
                      <tr key={issue.code} className="hover:bg-(--bg-soft)">
                        <Td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">
                              {info?.label ?? issue.code}
                            </span>
                            {issue.blocking && (
                              <Pill tone="var(--danger)">คำนวณต่อไม่ได้</Pill>
                            )}
                          </div>
                          {info === undefined && (
                            <span className="font-mono text-xs text-(--ink-soft)">
                              {issue.code}
                            </span>
                          )}
                        </Td>
                        <Td align="right">{issue.count}</Td>
                        <Td align="right">{issue.people.size}</Td>
                        <Td className="text-(--ink-soft)">{info?.fix ?? "—"}</Td>
                      </tr>
                    );
                  })}
                </DataTable>
              </SectionCard>
            )}

            {summary !== null && t !== undefined && (
              <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-(--ink-soft)">ช่วงเวลา:</span>
              {[7, 30, 90].map((d) => (
                <Link
                  key={d}
                  href={`/hr/attendance?days=${d}`}
                  className="rounded-full border px-3 py-1 text-xs transition-colors"
                  style={
                    d === days && !sp.from
                      ? {
                          color: "var(--app-strong)",
                          borderColor: "var(--app)",
                          backgroundColor: "var(--app-soft)",
                        }
                      : { color: "var(--ink-soft)", borderColor: "var(--line)" }
                  }
                >
                  {d} วัน
                </Link>
              ))}
              <span className="ml-1 text-xs text-(--ink-soft)">
                {summary.from} → {summary.to}
              </span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="พนักงาน" value={t.employees} tone="var(--app)" />
              <StatCard
                label="ชั่วโมงทำงาน"
                value={formatMinutes(t.worked_minutes)}
                hint={`${t.worked_days} วัน`}
                tone="var(--tone-ok)"
              />
              <StatCard
                label="มาสาย"
                value={`${t.late_days} วัน`}
                hint={formatMinutes(t.late_minutes)}
                tone="var(--tone-warn)"
              />
              <StatCard
                label="ขาดงาน"
                value={`${t.absent_days} วัน`}
                hint={formatMinutes(t.absence_minutes)}
                tone="var(--tone-danger)"
              />
              <StatCard
                label="ล่วงเวลา"
                value={formatMinutes(t.ot_minutes)}
                tone="var(--tone-info)"
              />
            </div>

            {summary.employees.length === 0 ? (
              <EmptyState>
                ไม่มีผลลงเวลาในช่วงนี้ — ถ้าเพิ่งติดตั้งเครื่องสแกน
                ต้องผูกลายนิ้วมือกับพนักงานก่อน
              </EmptyState>
            ) : (
              <DataTable
                head={[
                  "พนักงาน",
                  "วันทำงาน",
                  "ชั่วโมงทำงาน",
                  "มาสาย",
                  "ออกก่อน",
                  "ขาด",
                  "OT",
                ]}
              >
                {summary.employees.map((row) => (
                  <tr key={row.employment_id} className="hover:bg-(--bg-soft)">
                    <Td>
                      <Link
                        href={`/hr/employees/${row.employment_id}`}
                        className="font-medium hover:underline"
                      >
                        {nameOf(row.employment_id)}
                      </Link>
                    </Td>
                    <Td align="right">
                      {row.worked_days}/{row.days}
                    </Td>
                    <Td align="right">{formatMinutes(row.worked_minutes)}</Td>
                    <Td align="right">
                      {row.late_minutes > 0 ? (
                        <span style={{ color: "var(--tone-warn)" }}>
                          {formatMinutes(row.late_minutes)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td align="right">
                      {row.early_out_minutes > 0
                        ? formatMinutes(row.early_out_minutes)
                        : "—"}
                    </Td>
                    <Td align="right">
                      {row.absent_days > 0 ? (
                        <span style={{ color: "var(--tone-danger)" }}>
                          {row.absent_days} วัน
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td align="right">{formatMinutes(row.ot_minutes)}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
            {canSeeResults && (
              <SectionCard
                title="รายการสแกนทั้งหมด"
                description="ข้อมูลดิบจากเครื่อง ใช้ตรวจว่าเครื่องส่งถึงเซิร์ฟเวอร์จริงไหม"
                className="mt-4"
                action={<AutoRefresh />}
              >
                {(raw?.items ?? []).length === 0 ? (
                  <EmptyState>ไม่มีการสแกนในช่วงนี้</EmptyState>
                ) : (
                  <DataTable head={["เวลา", "พนักงาน", "เครื่อง", "Slot", "คะแนน"]}>
                    {(raw?.items ?? []).map((row) => (
                      <tr key={row.id} className="hover:bg-(--bg-soft)">
                        <Td className="font-mono text-xs">
                          {new Date(row.captured_at).toLocaleString("th-TH", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            timeZone: "Asia/Bangkok",
                          })}
                        </Td>
                        <Td>
                          {row.slot_resolved && row.display_name !== null ? (
                            <span className="font-medium">{row.display_name}</span>
                          ) : (
                            <Pill tone="var(--danger)">ไม่รู้ว่าเป็นใคร</Pill>
                          )}
                        </Td>
                        <Td className="text-(--ink-soft)">{row.device_code ?? "—"}</Td>
                        <Td align="right" className="font-mono text-xs">
                          {row.template_slot ?? "—"}
                        </Td>
                        <Td align="right" className="font-mono text-xs">
                          {row.match_score ?? "—"}
                        </Td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </SectionCard>
            )}
              </>
            )}
          </>
        );
      }}
    />
  );
}
