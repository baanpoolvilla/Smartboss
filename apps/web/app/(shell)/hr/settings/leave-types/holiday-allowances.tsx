import Link from "next/link";
import { Button } from "@smartboss/ui/components/button";
import { DataTable, Pill, SectionCard, Td, inputClass } from "@/modules/hr/components/ui";
import { formatBuddhistYear, formatDate } from "@/modules/hr/lib/labels";
import type { MonthAllowance } from "@/modules/hr/lib/api";
import { importThaiHolidaysAction, setMonthAllowanceAction } from "../../actions";

const MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/**
 * ตารางสิทธิ์ Holiday รายเดือนของประเภทที่นับสิทธิ์จากวันหยุดบริษัท
 *
 * ค่าเริ่มต้นของแต่ละเดือน = จำนวนวันหยุดบริษัทในเดือนนั้น (แก้วันหยุดได้ที่หน้า "วันหยุดบริษัท")
 * บางเดือนบริษัทให้ไม่ตรงกับปฏิทิน ⇒ HR ใส่จำนวนทับได้ทีละเดือน · แก้ย้อนหลังแล้วยอดของทุกคนคิดใหม่เอง
 */
export function HolidayAllowances({
  companyId,
  leaveTypeId,
  leaveTypeName,
  year,
  months,
}: {
  companyId: string;
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  months: MonthAllowance[];
}) {
  const total = months.reduce((sum, m) => sum + m.days, 0);
  return (
    <SectionCard
      title={`สิทธิ์ ${leaveTypeName} รายเดือน · ปี ${formatBuddhistYear(year)}`}
      description={`แต่ละเดือนได้สิทธิ์เท่าจำนวนวันหยุดบริษัทของเดือนนั้น แก้จำนวนทับได้ถ้าบริษัทให้ไม่ตรง · สิทธิ์ของแต่ละเดือนใช้ได้ภายใน 3 เดือน (เช่น ก.ค. ใช้ได้ถึงสิ้น ก.ย.) เกินนั้นตัดทิ้ง · รวมทั้งปี ${total} วัน`}
      action={
        <div className="flex flex-wrap justify-end gap-1">
          <form action={importThaiHolidaysAction}>
            <input type="hidden" name="company_id" value={companyId} />
            <input type="hidden" name="year" value={year} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              title="เพิ่มวันหยุดราชการไทยของปีนี้เป็นวันหยุดบริษัท — วันที่มีอยู่แล้วไม่ซ้ำ"
            >
              นำเข้าวันหยุดราชการไทย
            </Button>
          </form>
          <Link href={`/hr/settings/leave-types?year=${year - 1}`}>
            <Button size="sm" variant="outline">ปีก่อน</Button>
          </Link>
          <Link href={`/hr/settings/leave-types?year=${year + 1}`}>
            <Button size="sm" variant="outline">ปีถัดไป</Button>
          </Link>
        </div>
      }
    >
      <DataTable head={["เดือน", "วันหยุดบริษัท", "ให้สิทธิ์ (วัน)", "แก้จำนวน"]}>
        {months.map((m) => (
          <tr key={m.month} className="border-b border-(--line) last:border-b-0">
            <Td className="whitespace-nowrap font-medium">{MONTH_NAMES[Number(m.month.slice(5, 7)) - 1]}</Td>
            <Td>
              {m.holiday_count === 0 ? (
                <span className="text-(--ink-soft)">ไม่มี</span>
              ) : (
                <span>
                  {m.holiday_count} วัน{" "}
                  <span className="text-xs text-(--ink-soft)">
                    ({m.holidays.map((h) => `${formatDate(h.date)} ${h.name}`).join(" · ")})
                  </span>
                </span>
              )}
            </Td>
            <Td className="whitespace-nowrap">
              <span className="font-semibold">{m.days}</span>{" "}
              {m.override_days !== null && <Pill tone="var(--tone-warn)">แก้เอง</Pill>}
            </Td>
            <Td>
              <form action={setMonthAllowanceAction} className="flex items-center gap-1">
                <input type="hidden" name="leave_type_id" value={leaveTypeId} />
                <input type="hidden" name="month" value={m.month} />
                <input
                  type="number"
                  name="days"
                  min={0}
                  max={31}
                  required
                  defaultValue={m.days}
                  className={`${inputClass} h-7 w-16 text-xs`}
                  aria-label={`จำนวนวัน ${leaveTypeName} ของ${MONTH_NAMES[Number(m.month.slice(5, 7)) - 1]}`}
                />
                <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
                  บันทึก
                </Button>
                {m.override_days !== null && (
                  <Button
                    type="submit"
                    name="reset"
                    value="1"
                    formNoValidate
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    title={`กลับไปใช้จำนวนวันหยุดบริษัท (${m.holiday_count} วัน)`}
                  >
                    ใช้ตามปฏิทิน
                  </Button>
                )}
              </form>
            </Td>
          </tr>
        ))}
      </DataTable>
      <p className="mt-3 text-xs text-(--ink-soft)">
        เพิ่ม/ลบวันหยุดบริษัทได้ที่{" "}
        <Link href="/hr/settings/holidays" className="underline">
          ตั้งค่า › วันหยุดบริษัท
        </Link>{" "}
        — เดือนที่ไม่ได้แก้เองจะเปลี่ยนตามทันที
      </p>
    </SectionCard>
  );
}
