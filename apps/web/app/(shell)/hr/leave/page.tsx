import Link from "next/link";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Company,
  type Employment,
  type LeaveCalendarEntry,
  type LeaveRequest,
  type LeaveType,
  type Me,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Field,
  NotProvisioned,
  Pill,
  SectionCard,
  Td,
  inputClass,
} from "@/modules/hr/components/ui";
import { createLeaveTypeAction, decideLeaveAction } from "../actions";
import {
  LeaveCalendar,
  type DayEntry,
  type PersonLegend,
} from "./leave-calendar";

const THAI_MONTH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** ทุกวันที่คำขอใบหนึ่งครอบคลุม — คำขอเก็บเป็นช่วง แต่ปฏิทินวางเป็นรายวัน */
function datesBetween(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  const end = new Date(`${endsOn}T00:00:00Z`).getTime();
  for (let t = new Date(`${startsOn}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > 400) break; // กันช่วงเพี้ยนจนวนยาว
  }
  return out;
}

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "")
    ? sp.month!
    : new Date().toISOString().slice(0, 7);

  return (
    <HrPage
      title="ปฏิทินวันหยุด"
      permission={HR_PERMS.access}
      load={async () => {
        const companies = await wfTry<Paged<Company>>("/companies");
        const companyId = companies?.items[0]?.id;

        const daysInMonth = new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
        ).getUTCDate();
        const from = `${month}-01`;
        const to = `${month}-${String(daysInMonth).padStart(2, "0")}`;

        const [me, employments, types, calendar, requests] = await Promise.all([
          wfFetch<Me>("/me"),
          // พนักงานทั่วไปอ่าน /employments ไม่ได้ (ต้องมี people.read) — ปฏิทิน
          // จึงพึ่งชื่อจาก /leave-calendar แทน อันนี้ใช้แค่ตารางอนุมัติ
          wfTry<Paged<Employment>>("/employments"),
          wfTry<Paged<LeaveType>>("/leave-types"),
          // ตัวนี้ทุกคนเรียกได้ — เป็นแหล่งข้อมูลหลักของปฏิทิน
          wfTry<{ items: LeaveCalendarEntry[] }>(`/leave-calendar?from=${from}&to=${to}`),
          wfTry<Paged<LeaveRequest>>(`/leave-requests?from=${from}&to=${to}&status=PENDING`),
        ]);

        /*
         * พนักงานทั่วไปอ่าน /companies ไม่ได้ (ต้องมี people.read) — ห้ามใช้
         * ค่านั้นตัดสินว่าระบบตั้งต้นเสร็จหรือยัง ไม่งั้นคนที่ควรใช้หน้านี้ที่สุด
         * จะโดนบล็อกทั้งที่ระบบพร้อมแล้ว · ตัวชี้ขาดคือปฏิทินซึ่งทุกคนเรียกได้
         */
        if (calendar === null) {
          return <NotProvisioned what="ดูปฏิทินวันหยุด" />;
        }

        const nameOf = new Map(
          (employments?.items ?? []).map((e) => [e.id, e.display_name || e.full_name]),
        );
        const canApprove = me.permissions.includes("workforce.leave.approve");
        const canManageTypes = me.permissions.includes("workforce.scheduling.manage");

        // วางคำขอลงปฏิทินรายวัน — endpoint คืนเฉพาะใบที่ยังมีผล (PENDING/APPROVED)
        const entriesByDate: Record<string, DayEntry[]> = {};
        for (const entry of calendar?.items ?? []) {
          for (const date of datesBetween(entry.starts_on, entry.ends_on)) {
            if (date < from || date > to) continue;
            (entriesByDate[date] ??= []).push({
              employmentId: entry.employment_id,
              name: entry.display_name,
              status: entry.status,
              mine: entry.employment_id === me.employment_id,
            });
          }
        }

        // รายชื่อในแถบซ้าย — เอาจากคนที่มีวันหยุดเดือนนี้ เรียงตามชื่อให้หาเจอง่าย
        const legend: PersonLegend[] = [
          ...new Map(
            (calendar?.items ?? []).map((e) => [
              e.employment_id,
              { id: e.employment_id, name: e.display_name },
            ]),
          ).values(),
        ].sort((a, b) => a.name.localeCompare(b.name, "th"));

        const pending = requests?.items ?? [];
        const [y, m] = month.split("-").map(Number);

        return (
          <div className="flex flex-col gap-4">
            <SectionCard
              title={`${THAI_MONTH[m! - 1]} ${y! + 543}`}
              description="คลิกวันที่จะหยุดแล้วกดขอ — แต่ละคนมีสีประจำตัว · แถบจางมีจุดนำหน้า = รออนุมัติ"
              action={
                <div className="flex gap-1">
                  <Link href={`/hr/leave?month=${shiftMonth(month, -1)}`}>
                    <Button size="sm" variant="outline">ก่อนหน้า</Button>
                  </Link>
                  <Link href={`/hr/leave?month=${shiftMonth(month, 1)}`}>
                    <Button size="sm" variant="outline">ถัดไป</Button>
                  </Link>
                </div>
              }
            >
              <LeaveCalendar
                key={month}
                month={month}
                today={new Date().toISOString().slice(0, 10)}
                employmentId={me.employment_id}
                leaveTypes={(types?.items ?? []).map((t) => ({
                  id: t.id,
                  label: `${t.name}${t.paid ? "" : " (ไม่ได้ค่าจ้าง)"}`,
                }))}
                entriesByDate={entriesByDate}
                people={legend}
              />
            </SectionCard>

            {canApprove && (
              <SectionCard
                title={`รออนุมัติ ${pending.length} ใบ`}
                description="อนุมัติแล้วเท่านั้นที่จะไม่ถูกนับเป็นขาดงาน"
              >
                {pending.length === 0 ? (
                  <EmptyState>ไม่มีคำขอค้าง</EmptyState>
                ) : (
                  <DataTable head={["พนักงาน", "วันที่", "เหตุผล", "ดำเนินการ"]}>
                    {pending.map((r) => (
                      <tr key={r.id} className="hover:bg-(--bg-soft)">
                        <Td className="font-medium">
                          {nameOf.get(r.employment_id) ?? "—"}
                        </Td>
                        <Td className="font-mono text-xs">
                          {r.starts_on === r.ends_on
                            ? r.starts_on
                            : `${r.starts_on} → ${r.ends_on}`}
                        </Td>
                        <Td className="text-(--ink-soft)">{r.reason || "—"}</Td>
                        <Td>
                          <div className="flex gap-2">
                            <form action={decideLeaveAction}>
                              <input type="hidden" name="requestId" value={r.id} />
                              <input type="hidden" name="outcome" value="APPROVED" />
                              <Button type="submit" size="sm">อนุมัติ</Button>
                            </form>
                            <form action={decideLeaveAction}>
                              <input type="hidden" name="requestId" value={r.id} />
                              <input type="hidden" name="outcome" value="REJECTED" />
                              <Button type="submit" size="sm" variant="danger">
                                ไม่อนุมัติ
                              </Button>
                            </form>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </SectionCard>
            )}

            {canManageTypes && companyId !== undefined && (
              <SectionCard
                title="ประเภทการลา"
                description="ต้องมีอย่างน้อยหนึ่งประเภท พนักงานถึงจะขอลาได้"
              >
                {(types?.items ?? []).length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {(types?.items ?? []).map((t) => (
                      <Pill key={t.id} tone={t.paid ? "var(--tone-ok)" : "var(--tone-muted)"}>
                        {t.code} · {t.name}
                      </Pill>
                    ))}
                  </div>
                )}
                <form
                  action={createLeaveTypeAction}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-4"
                >
                  <input type="hidden" name="company_id" value={companyId} />
                  <Field label="รหัส *">
                    <input
                      name="code"
                      required
                      maxLength={32}
                      placeholder="ANNUAL"
                      className={`${inputClass} font-mono uppercase`}
                    />
                  </Field>
                  <Field label="ชื่อ *">
                    <input
                      name="name"
                      required
                      maxLength={120}
                      placeholder="ลาพักร้อน"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="โควตา (วัน/ปี)" hint="0 = ไม่จำกัด">
                    <input
                      type="number"
                      name="quota_days"
                      min={0}
                      max={365}
                      defaultValue={0}
                      className={inputClass}
                    />
                  </Field>
                  <div className="flex items-end gap-2">
                    <select name="paid" defaultValue="1" className={inputClass}>
                      <option value="1">ได้ค่าจ้าง</option>
                      <option value="0">ไม่ได้ค่าจ้าง</option>
                    </select>
                    <Button type="submit">เพิ่ม</Button>
                  </div>
                </form>
              </SectionCard>
            )}
          </div>
        );
      }}
    />
  );
}
