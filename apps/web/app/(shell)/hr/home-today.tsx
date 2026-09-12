import Link from "next/link";
import { Button } from "@smartboss/ui/components/button";
import {
  wfTry,
  type AttendanceCorrection,
  type Employment,
  type LeaveRequest,
  type LeaveType,
  type Paged,
  type RecurringPattern,
  type TimeEvent,
} from "@/modules/hr/lib/api";
import { AttendanceRoster, type RosterRow } from "@/modules/hr/components/attendance-roster";
import { AttendanceDateNav } from "@/modules/hr/components/attendance-date-nav";
import { HelpPopover } from "@/modules/hr/components/design-kit-client";
import {
  NoPermission,
  Pill,
  SectionCard,
  inputClass,
} from "@/modules/hr/components/ui";
import { autoRecalculateAttendance } from "@/modules/hr/lib/auto-recalculate";
import { formatDate } from "@/modules/hr/lib/labels";

/** ช่วงที่สั่งคำนวณย้อนหลัง — คงที่ทุกครั้ง ไม่ผูกกับวันที่กำลังดูอยู่ */
const RECALC_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** เนื้อหาแท็บ "วันนี้" ของหน้าหลัก — เดิมคือทั้งหน้า /hr ก่อนยุบเป็น tab */
export async function renderTodayTab(
  dateParam: string | undefined,
  canExport: boolean,
): Promise<React.ReactNode> {
  const now = new Date();
  const todayReal = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - RECALC_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const to = todayReal;

  // วันที่กำลังดู — จำกัดไม่ให้เกินวันนี้ เพราะยังไม่มีข้อมูลของอนาคต
  // ค่าผิดรูปแบบ (แก้ URL มือ) ก็ตกกลับมาเป็นวันนี้เงียบ ๆ แทนพัง
  const viewDate =
    dateParam !== undefined && ISO_DATE.test(dateParam) && dateParam <= todayReal
      ? dateParam
      : todayReal;
  const isToday = viewDate === todayReal;

  // สั่งคำนวณแบบไม่รอผล — หน้านี้ไม่ได้แสดงผลคำนวณแล้ว แต่ยังต้องสั่ง
  // เพราะไม่มีอะไรอื่นในระบบคำนวณผลลงเวลาให้เลย (การสแกนเข้ามาไม่ trigger)
  // ถ้าตัดออก ข้อมูลที่เงินเดือนใช้อ้างอิงจะไม่ถูกอัปเดตเงียบ ๆ
  //
  // ⚠ ห้าม await ตรงนี้ — งานนี้ยิงคำนวณทีละคนจนครบทุกคน ใช้เวลาหลาย
  // วินาที การรอให้จบก่อนเรนเดอร์ทำให้หน้านี้ค้างทุกครั้งที่เปิด
  // ⚠ ผูกกับ todayReal เสมอ ไม่ใช่ viewDate — เปิดดูวันเก่าไม่ควรสั่งคำนวณ
  // วันเก่าซ้ำทุกครั้งที่มีคนย้อนดู
  void autoRecalculateAttendance(from, to);

  const [
    employments,
    board,
    timeline,
    shifts,
    todayAssignments,
    todayLeave,
    leaveTypes,
    corrections,
  ] = await Promise.all([
      wfTry<Paged<Employment>>("/employments"),
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
      }>(`/time-event-board?date=${viewDate}`),
      // การตอกบัตรทีละครั้งของวันที่กำลังดู — ข้อมูลของ Timeline
      wfTry<{ items: TimeEvent[] }>(`/time-events?date=${viewDate}`),
      // ใช้บอกว่ากะวันนั้นเป็นวันหยุดไหม (rest_day) และเข้ากี่โมง — ต้องมีสำหรับคนที่ยังไม่สแกน
      wfTry<Paged<{ id: string; rest_day: boolean; start_minutes: number }>>("/shifts"),
      // ตารางที่ประกาศไว้แล้วของวันที่กำลังดู (ทุกคน) — ชนะตารางประจำสัปดาห์เสมอ
      wfTry<{ items: { employment_id: string; shift_id: string | null }[] }>(
        `/shift-assignments?from=${viewDate}&to=${viewDate}`,
      ),
      // ใบลาที่อนุมัติแล้วของวันที่กำลังดู — คนที่ลาไม่ใช่คนขาดงาน
      wfTry<Paged<LeaveRequest>>(
        `/leave-requests?from=${viewDate}&to=${viewDate}&status=APPROVED`,
      ),
      // ชื่อประเภทการลา — "Day-Off" กับ "ลาป่วย" คนละเรื่องกัน ป้ายต้องบอกให้ตรง
      wfTry<Paged<LeaveType>>("/leave-types"),
      // การ์ด "ต้องจัดการ" ต้องรู้ว่ามีคำขอแก้เวลาค้างอยู่ไหม — เรียกเฉพาะคนที่
      // มีสิทธิ์อนุมัติอยู่แล้ว (canExport = employeeManage) กันยิง request ที่รู้
      // ล่วงหน้าว่าจะโดน 403 ให้คนที่ไม่มีสิทธิ์
      canExport
        ? wfTry<{ items: AttendanceCorrection[] }>("/attendance-correction-requests")
        : Promise.resolve(null),
    ]);

  // ตัวชี้ขาดว่าเข้าหน้านี้ได้ไหมคือกระดาน/Timeline ซึ่งทุกคนที่เข้าระบบเรียกได้
  if (board === null && timeline === null) {
    return <NoPermission what="การลงเวลา" />;
  }

  const arrivals = board?.items ?? [];
  const lateCount = arrivals.filter((a) => a.status === "LATE").length;

  const activePeople = (employments?.items ?? [])
    .filter((e) => e.terminated_on === null)
    .map((e) => ({ id: e.id, label: `${e.employee_code} · ${e.full_name}` }));

  /*
   * /employments ถูกจำกัดสิทธิ์ตาม data scope ของผู้เรียก (ดู resolveScopeFilter
   * ฝั่ง workforce-api) — คนที่ไม่มี workforce.people.manage และไม่มี employment_id
   * ผูกกับบัญชีตัวเอง จะได้ [] กลับมาเงียบ ๆ (HTTP 200) ทั้งที่บริษัทมีพนักงานจริง
   * ต่างจาก /time-event-board ที่เปิดให้ทุกคนเรียกได้แบบไม่จำกัด scope เลย
   * ⇒ ถ้ามีคนสแกนจริง (arrivals ไม่ว่าง) ให้ถือว่ามีพนักงานอยู่แน่ ๆ แม้ activePeople
   * จะว่างเพราะโดนจำกัดสิทธิ์ — กันไม่ให้ตัวเลขบนสุด (ลงเวลาแล้ว N คน) กับ
   * รายการด้านล่าง (ยังไม่มีพนักงานในระบบ) ขัดแย้งกันเองอย่างที่เจอ
   */
  const hasEmployees = activePeople.length > 0 || arrivals.length > 0;
  const peopleCount = Math.max(activePeople.length, arrivals.length);

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
  const todayDowField = DOW_FIELDS[new Date(`${viewDate}T00:00:00Z`).getUTCDay()]!;

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

  /*
   * คนที่ลาวันนี้ไม่ใช่คนขาดงาน — เดิมหน้านี้ดูแค่ตารางกะ ใครไม่มีสแกน
   * และวันนั้นไม่ใช่วันหยุดตามกะ ก็ขึ้น "ขาดงาน" หมด ทั้งที่เขายื่นลาและ
   * ได้รับอนุมัติไว้แล้ว ซึ่งเป็นการกล่าวหาพนักงานด้วยข้อมูลที่ระบบมีอยู่แล้ว
   *
   * เก็บ "ชื่อประเภท" ไม่ใช่แค่ "ลา/ไม่ลา" เพราะวันหยุดประจำเดือน (Day-Off)
   * กับลาป่วยเป็นคนละเรื่องกันในสายตาคนอ่าน — ป้ายที่เหมารวมว่า "ลา"
   * ทำให้เข้าใจผิดว่าคนนั้นใช้สิทธิ์ลาไป ทั้งที่เป็นวันหยุดตามสิทธิ์ปกติ
   */
  const leaveTypeName = new Map(
    (leaveTypes?.items ?? []).map((t) => [t.id, t.name]),
  );
  const leaveByEmployment = new Map(
    (todayLeave?.items ?? []).map((l) => [
      l.employment_id,
      leaveTypeName.get(l.leave_type_id) ?? "ลา",
    ]),
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
    const leaveName = leaveByEmployment.get(e.id);
    const status: "ABSENT" | "REST_DAY" | "NO_SHIFT" | "ON_LEAVE" =
      leaveName !== undefined
        ? "ON_LEAVE"
        : shiftId === null
          ? "NO_SHIFT"
          : restShiftIds.has(shiftId)
            ? "REST_DAY"
            : "ABSENT";
    return {
      employment_id: e.id,
      display_name: e.full_name,
      employee_code: e.employee_code,
      status,
      leave_name: leaveName ?? null,
      scheduled_start_minutes: shiftId === null ? null : (startMinutesByShift.get(shiftId) ?? null),
    };
  });
  const absentCount = missingRows.filter((m) => m.status === "ABSENT").length;

  const dayLabel = isToday ? "วันนี้" : "วันที่เลือก";

  const exportMonth = viewDate.slice(0, 7);

  /*
   * รายชื่อวันนี้แบบรวมเดียว (สเปคข้อ 4.1) — แทนที่การแยก "ลงเวลาแล้ว" (จาก
   * arrivals) กับ "ยังไม่ลงเวลา" (จาก missingRows) เป็นคนละ SectionCard
   * ต้องหาช่องทางล่าสุดที่แต่ละคนใช้ตอกจาก timeline เอง เพราะ arrivals (บอร์ด)
   * ไม่มีข้อมูลช่องทางติดมาด้วย มีแต่ timeline ที่เป็นรายเหตุการณ์
   */
  const latestEventByEmployment = new Map<string, TimeEvent>();
  for (const ev of timeline?.items ?? []) {
    const cur = latestEventByEmployment.get(ev.employment_id);
    if (!cur || ev.captured_at > cur.captured_at) latestEventByEmployment.set(ev.employment_id, ev);
  }
  const rosterRows: RosterRow[] = [
    ...arrivals.map((a) => ({
      employmentId: a.employment_id,
      name: a.display_name,
      code: a.employee_code,
      category: (a.status === "LATE"
        ? "late"
        : a.status === "REST_DAY"
          ? "off"
          : a.status === "NO_SHIFT"
            ? "noshift"
            : "ok") as RosterRow["category"],
      scheduledStartMinutes: a.scheduled_start_minutes,
      firstScanAt: a.first_scan_at,
      lateMinutes: a.late_minutes,
      offLabel: a.status === "REST_DAY" ? "วันหยุดตามกะ" : undefined,
      sourceType: latestEventByEmployment.get(a.employment_id)?.source_type ?? null,
    })),
    ...missingRows.map((m) => ({
      employmentId: m.employment_id,
      name: m.display_name,
      code: m.employee_code,
      category: (m.status === "ABSENT" ? "absent" : m.status === "NO_SHIFT" ? "noshift" : "off") as RosterRow["category"],
      scheduledStartMinutes: m.scheduled_start_minutes,
      offLabel: m.status === "ON_LEAVE" ? (m.leave_name ?? "ลา") : m.status === "REST_DAY" ? "วันหยุด" : undefined,
    })),
  ];

  // การ์ด "ต้องจัดการ" — คนที่ยังไม่ผูกกะ + คำขอแก้เวลาที่รออนุมัติ (เฉพาะคนมีสิทธิ์)
  const unassigned = missingRows.filter((m) => m.status === "NO_SHIFT");
  const pendingCorrections = (corrections?.items ?? []).filter((c) => c.status === "PENDING");
  const needsAttentionCount = unassigned.length + pendingCorrections.length;

  return (
    <>
      <AttendanceDateNav date={viewDate} today={todayReal} />

      {needsAttentionCount > 0 && (
        <SectionCard title={`ต้องจัดการ (${needsAttentionCount})`} className="mb-4">
          <div className="flex flex-col divide-y divide-(--line)">
            {unassigned.map((m) => (
              <div key={m.employment_id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-(--ink)">{m.display_name}</p>
                  <p className="text-xs text-(--ink-soft)">ยังไม่ผูกกะ</p>
                </div>
                <Link href={`/hr/employees/${m.employment_id}`}>
                  <Pill tone="var(--tone-muted)">ผูกกะ →</Pill>
                </Link>
              </div>
            ))}
            {pendingCorrections.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-(--ink)">{c.full_name}</p>
                  <p className="text-xs text-(--ink-soft)">ขอแก้เวลา {formatDate(c.work_date)}</p>
                </div>
                <Link href="/hr?tab=corrections">
                  <Pill tone="var(--tone-warn)">ตรวจสอบ →</Pill>
                </Link>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={
          <>
            {`รายชื่อวันนี้ · ${peopleCount} คน`}
            <HelpPopover label="คำอธิบายรายชื่อวันนี้">
              อ่านจากการสแกนสด ๆ ไม่ต้องรอสั่งคำนวณ — ตัวเลขสรุปรายเดือนและ OT
              ยังต้องกดคำนวณตามเดิม ไอคอนท้ายแถวบอกช่องทางที่ใช้ลงเวลา
              (เครื่องสแกนนิ้ว / แอปมือถือ / เว็บ / เจ้าหน้าที่บันทึกให้)
            </HelpPopover>
          </>
        }
        description={[
          `ลงเวลาแล้ว ${arrivals.length} คน`,
          lateCount > 0 ? `มาสาย ${lateCount} คน` : null,
          absentCount > 0 ? `ขาดงาน ${absentCount} คน` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        className="mb-4"
      >
        {hasEmployees ? (
          <AttendanceRoster rows={rosterRows} timelineEvents={timeline?.items ?? []} />
        ) : (
          <p className="p-10 text-center text-sm text-(--ink-soft)">ยังไม่มีพนักงานในระบบ</p>
        )}
      </SectionCard>

      {/*
        ดาวน์โหลดผลลงเวลาทั้งเดือน — หน้านี้ดูได้ทีละวัน ซึ่งพอสำหรับ
        "วันนี้ใครมาแล้ว" แต่ตอบไม่ได้ว่าเดือนนี้ใครสายกี่ครั้ง รวมกี่นาที
        ซึ่งเป็นตัวเลขที่ฝ่ายบุคคลต้องใช้ตอนสรุปเบี้ยขยัน/ประเมินผล
        เป็น <form method="get"> ธรรมดา ⇒ ทำงานได้แม้ JS ยังไม่โหลด
      */}
      {canExport && (
        <SectionCard
          title="ดาวน์โหลดรายงานการเข้างาน"
          description="ไฟล์ CSV รายวันของพนักงานทุกคน พร้อมสรุปรายคน (เปิดด้วย Excel ได้เลย)"
        >
          <form
            method="get"
            action="/hr/attendance/export"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex min-w-44 flex-col gap-1">
              <span className="text-xs font-medium text-(--ink-soft)">เดือน</span>
              <input
                type="month"
                name="month"
                defaultValue={exportMonth}
                max={todayReal.slice(0, 7)}
                className={inputClass}
              />
            </label>
            <Button type="submit" variant="outline">
              ดาวน์โหลด CSV
            </Button>
          </form>
          <p className="mt-3 text-xs text-(--ink-soft)">
            มีคอลัมน์: เวลาเข้า-ออก · สาย · ออกก่อน · ขาดงาน · ชั่วโมงทำงาน · OT ·
            สถานะรายวัน (ปกติ / มาสาย / ขาดงาน / ลา / วันหยุด) แล้วปิดท้ายด้วยสรุปรายคน
            <br />
            ⚠ ไฟล์อ่านจาก<strong>ผลคำนวณ</strong> ไม่ใช่การสแกนดิบ — เดือนที่เก่ากว่า 30 วัน
            อาจได้ข้อมูลไม่ครบถ้ายังไม่เคยสั่งคำนวณ
          </p>
        </SectionCard>
      )}
    </>
  );
}
