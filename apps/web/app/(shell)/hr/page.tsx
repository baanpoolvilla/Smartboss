import Link from "next/link";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfTry,
  type Employment,
  type LeaveRequest,
  type LeaveType,
  type Paged,
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
  Td,
} from "@/modules/hr/components/ui";
import { autoRecalculateAttendance } from "@/modules/hr/lib/auto-recalculate";

/** ช่วงที่สั่งคำนวณย้อนหลัง — ไม่มี UI ให้เลือกแล้ว หน้านี้แสดงแต่ของวันนี้ */
const RECALC_DAYS = 30;

export default async function HrOverviewPage() {
  return (
    <HrPage
      title="การลงเวลา"
      // เปิดให้ทุกคนที่เข้าโมดูลได้ — พนักงานต้องเห็นว่าใครมาถึงกี่โมง
      permission={HR_PERMS.access}
      load={async () => {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const from = new Date(now.getTime() - RECALC_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const to = today;

        // สั่งคำนวณแบบไม่รอผล — หน้านี้ไม่ได้แสดงผลคำนวณแล้ว แต่ยังต้องสั่ง
        // เพราะไม่มีอะไรอื่นในระบบคำนวณผลลงเวลาให้เลย (การสแกนเข้ามาไม่ trigger)
        // ถ้าตัดออก ข้อมูลที่เงินเดือนใช้อ้างอิงจะไม่ถูกอัปเดตเงียบ ๆ
        //
        // ⚠ ห้าม await ตรงนี้ — งานนี้ยิงคำนวณทีละคนจนครบทุกคน ใช้เวลาหลาย
        // วินาที การรอให้จบก่อนเรนเดอร์ทำให้หน้านี้ค้างทุกครั้งที่เปิด
        void autoRecalculateAttendance(from, to);

        const [
          employments,
          board,
          timeline,
          shifts,
          todayAssignments,
          todayLeave,
          leaveTypes,
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
            }>(`/time-event-board?date=${today}`),
            // การตอกบัตรทีละครั้งของวันนี้ — ข้อมูลของ Timeline
            wfTry<{ items: TimeEvent[] }>(`/time-events?date=${today}`),
            // ใช้บอกว่ากะวันนี้เป็นวันหยุดไหม (rest_day) และเข้ากี่โมง — ต้องมีสำหรับคนที่ยังไม่สแกน
            wfTry<Paged<{ id: string; rest_day: boolean; start_minutes: number }>>("/shifts"),
            // ตารางที่ประกาศไว้แล้วของวันนี้ (ทุกคน) — ชนะตารางประจำสัปดาห์เสมอ
            wfTry<{ items: { employment_id: string; shift_id: string | null }[] }>(
              `/shift-assignments?from=${today}&to=${today}`,
            ),
            // ใบลาที่อนุมัติแล้วของวันนี้ — คนที่ลาไม่ใช่คนขาดงาน
            wfTry<Paged<LeaveRequest>>(
              `/leave-requests?from=${today}&to=${today}&status=APPROVED`,
            ),
            // ชื่อประเภทการลา — "Day-Off" กับ "ลาป่วย" คนละเรื่องกัน ป้ายต้องบอกให้ตรง
            wfTry<Paged<LeaveType>>("/leave-types"),
          ]);

        // ตัวชี้ขาดว่าเข้าหน้านี้ได้ไหมคือกระดาน/Timeline ซึ่งทุกคนที่เข้าระบบเรียกได้
        if (board === null && timeline === null) {
          return <NoPermission what="การลงเวลา" />;
        }

        const arrivals = board?.items ?? [];
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
                        {m.status === "ON_LEAVE" ? (
                          <Pill tone="var(--tone-info)">{m.leave_name}</Pill>
                        ) : m.status === "REST_DAY" ? (
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
          </>
        );
      }}
    />
  );
}
