import Link from "next/link";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Company,
  type Employment,
  type HolidayCalendar,
  type HolidayDate,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  NotProvisioned,
  Pill,
  SectionCard,
  Td,
} from "@/modules/hr/components/ui";
import { deleteHolidayAction } from "../actions";
import { AddHolidayForm } from "./add-holiday-form";

const MONTH_NAMES = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** ปฏิทินหนึ่งเดือน — จุดสีคือวันหยุด ชื่อวันหยุดอยู่ใน title ให้ hover ดู */
function MonthGrid({
  year,
  month,
  holidays,
}: {
  year: number;
  month: number;
  holidays: Map<string, HolidayDate>;
}) {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = first.getUTCDay();

  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="rounded-(--radius) border border-(--line) p-2">
      <p className="mb-1 text-center text-xs font-semibold text-(--ink)">
        {MONTH_NAMES[month]}
      </p>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DOW.map((d) => (
          <span key={d} className="text-[10px] text-(--ink-soft)">
            {d}
          </span>
        ))}
        {cells.map((day, index) => {
          if (day === null) return <span key={`x${index}`} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const holiday = holidays.get(iso);
          return (
            <span
              key={iso}
              title={holiday ? `${iso} · ${holiday.name}` : iso}
              className="rounded py-0.5 text-[11px]"
              style={
                holiday
                  ? {
                      color: "var(--danger)",
                      backgroundColor: "color-mix(in srgb, var(--danger) 12%, transparent)",
                      fontWeight: 600,
                    }
                  : undefined
              }
            >
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default async function HolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; emp?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const thisYear = new Date().getFullYear();
  const year =
    Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : thisYear;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "")
    ? sp.month!
    : new Date().toISOString().slice(0, 7);

  return (
    <HrPage
      title="วันหยุด"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const companies = await wfFetch<Paged<Company>>("/companies");
        const companyId = companies.items[0]?.id;
        if (companyId === undefined) return <NotProvisioned what="ตั้งวันหยุด" />;

        const daysInMonth = new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
        ).getUTCDate();
        const monthFrom = `${month}-01`;
        const monthTo = `${month}-${String(daysInMonth).padStart(2, "0")}`;

        const [calendars, employments, shifts] = await Promise.all([
          wfTry<Paged<HolidayCalendar>>(
            `/holiday-calendars?company_id=${companyId}&from=${year}-01-01&to=${year}-12-31`,
          ),
          wfTry<Paged<Employment>>("/employments"),
          wfTry<Paged<{ id: string; name: string; code: string; rest_day: boolean }>>(
            `/shifts?company_id=${companyId}`,
          ),
        ]);

        const people = (employments?.items ?? []).filter((e) => e.terminated_on === null);
        const selectedEmp =
          people.find((e) => e.id === sp.emp)?.id ?? people[0]?.id ?? null;

        // กะที่ติ๊ก "เป็นวันหยุด" คือตัวที่ใช้ทับวันที่พนักงานขอหยุด
        const restShiftId = (shifts?.items ?? []).find((sh) => sh.rest_day)?.id ?? null;
        const workShifts = (shifts?.items ?? [])
          .filter((sh) => !sh.rest_day)
          .map((sh) => ({ id: sh.id, label: `${sh.code} · ${sh.name}` }));

        // วันที่ถูกลงไว้แล้วในเดือนนี้ — เอามาติ๊กไว้ให้ตรงกับของจริง
        const assigned =
          selectedEmp === null
            ? null
            : await wfTry<{ items: { work_date: string; shift_id: string | null }[] }>(
                `/shift-assignments?from=${monthFrom}&to=${monthTo}&employment_id=${selectedEmp}`,
              );
        const initialOff = (assigned?.items ?? [])
          .filter((a) => a.shift_id !== null && a.shift_id === restShiftId)
          .map((a) => a.work_date);

        const dates = (calendars?.items ?? []).flatMap((c) => c.dates);
        const byDate = new Map(dates.map((d) => [d.holiday_date, d]));
        const sorted = [...dates].sort((a, b) =>
          a.holiday_date.localeCompare(b.holiday_date),
        );

        return (
          <div className="flex flex-col gap-4">
            <SectionCard
              title="วันหยุดของพนักงานรายคน"
              description="ย้ายไปอยู่ในหน้าของพนักงานแต่ละคนแล้ว — ตั้งค่าของคนหนึ่งคนจบในหน้าเดียว"
            >
              <Link
                href="/hr/employees"
                className="text-sm text-(--app-strong) hover:underline"
              >
                ไปที่ทะเบียนพนักงาน → เลือกคน → “วันหยุดของคนนี้”
              </Link>
            </SectionCard>

            <SectionCard
              title="วันหยุดบริษัท (ทุกคนหยุดพร้อมกัน)"
              description="ใช้เฉพาะวันที่ทั้งบริษัทหยุดเหมือนกัน เช่นวันหยุดราชการ — ถ้าไม่มีก็ไม่ต้องลง"
            >
              <AddHolidayForm companyId={companyId} defaultDate={`${year}-01-01`} />
            </SectionCard>

            <SectionCard
              title={`ปฏิทิน พ.ศ. ${year + 543}`}
              description={`วันหยุด ${dates.length} วัน · เลื่อนเมาส์บนวันที่สีแดงเพื่อดูชื่อ`}
              action={
                <div className="flex gap-1">
                  {[year - 1, year, year + 1].map((y) => (
                    <Link key={y} href={`/hr/holidays?year=${y}`}>
                      <Button size="sm" variant={y === year ? "primary" : "outline"}>
                        {y + 543}
                      </Button>
                    </Link>
                  ))}
                </div>
              }
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 12 }, (_, m) => (
                  <MonthGrid key={m} year={year} month={m} holidays={byDate} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title={`รายการวันหยุด ${year + 543}`}>
              {sorted.length === 0 ? (
                <EmptyState>ยังไม่มีวันหยุดในปีนี้</EmptyState>
              ) : (
                <DataTable head={["วันที่", "ชื่อวันหยุด", "ค่าจ้าง", "ลบ"]}>
                  {sorted.map((d) => (
                    <tr key={d.id} className="hover:bg-(--bg-soft)">
                      <Td className="font-mono text-xs">{d.holiday_date}</Td>
                      <Td className="font-medium">{d.name}</Td>
                      <Td>
                        {d.paid ? (
                          <Pill tone="var(--tone-ok)">ได้ค่าจ้าง</Pill>
                        ) : (
                          <Pill tone="var(--tone-muted)">ไม่ได้ค่าจ้าง</Pill>
                        )}
                      </Td>
                      <Td>
                        <form action={deleteHolidayAction}>
                          <input type="hidden" name="holidayDateId" value={d.id} />
                          <Button type="submit" size="sm" variant="danger">
                            ลบ
                          </Button>
                        </form>
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              )}
              <p className="mt-3 text-xs text-(--ink-soft)">
                แก้วันหยุดแล้วต้องสั่งคำนวณผลลงเวลาใหม่ที่หน้า “ผลลงเวลา” —
                ผลที่คำนวณไปแล้วยังใช้ข้อมูลวันหยุดตอนที่คำนวณครั้งนั้น
              </p>
            </SectionCard>
          </div>
        );
      }}
    />
  );
}
