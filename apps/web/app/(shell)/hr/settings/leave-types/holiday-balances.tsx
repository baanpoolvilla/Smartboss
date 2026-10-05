import Link from "next/link";
import { Button } from "@smartboss/ui/components/button";
import { DataTable, EmptyState, Pill, SectionCard, Td } from "@/modules/hr/components/ui";
import type { HolidayBalanceRow } from "@/modules/hr/lib/api";

const MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const MONTH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function shiftMonth(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const shortOf = (month: string) => MONTH_SHORT[Number(month.slice(5, 7)) - 1];

/**
 * ยอด Holiday คงเหลือของพนักงานทุกคน ณ เดือนหนึ่ง — ให้ HR เห็นว่าใครเหลือกี่วัน
 * และใครมีวันที่ต้องใช้ภายในเดือนนั้น (สิทธิ์ของแต่ละเดือนใช้ได้ภายใน 3 เดือน เกินนั้นตัดทิ้ง)
 * เรียงคนที่มีวันใกล้หมดอายุขึ้นก่อน — กลุ่มที่ HR ต้องเตือนให้รีบใช้
 */
export function HolidayBalances({
  leaveTypeName,
  month,
  year,
  rows,
}: {
  leaveTypeName: string;
  month: string;
  /** ปีของตารางสิทธิ์รายเดือนด้านบน — คงไว้ในลิงก์เปลี่ยนเดือนไม่ให้ตารางนั้นเด้งกลับปีปัจจุบัน */
  year: number;
  rows: (HolidayBalanceRow & { name: string; code: string })[];
}) {
  const sorted = [...rows].sort(
    (a, b) => b.expiring_days - a.expiring_days || b.available_days - a.available_days || a.name.localeCompare(b.name, "th"),
  );
  const expiringPeople = rows.filter((r) => r.expiring_days > 0).length;
  const link = (target: string) => `/hr/settings/leave-types?year=${year}&month=${target}#holiday-balances`;

  return (
    <div id="holiday-balances">
      <SectionCard
        title={`ยอด ${leaveTypeName} คงเหลือรายคน · ${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${Number(month.slice(0, 4)) + 543}`}
        description={
          expiringPeople > 0
            ? `${expiringPeople} คนมีวันที่ต้องใช้ภายในเดือนนี้ ไม่งั้นถูกตัดทิ้ง`
            : "ไม่มีใครมีวันที่จะหมดอายุสิ้นเดือนนี้"
        }
        action={
          <div className="flex gap-1">
            <Link href={link(shiftMonth(month, -1))}>
              <Button size="sm" variant="outline">ก่อนหน้า</Button>
            </Link>
            <Link href={link(shiftMonth(month, 1))}>
              <Button size="sm" variant="outline">ถัดไป</Button>
            </Link>
          </div>
        }
      >
        {sorted.length === 0 ? (
          <EmptyState>ยังไม่มีพนักงานในทะเบียน</EmptyState>
        ) : (
          <DataTable head={["พนักงาน", "ใช้ไปเดือนนี้", "เหลือลงได้", "มาจากสิทธิ์ของเดือน", "ต้องใช้ในเดือนนี้"]}>
            {sorted.map((r) => (
              <tr key={r.employment_id} className="border-b border-(--line) last:border-b-0">
                <Td>
                  <span className="font-medium">{r.name}</span>{" "}
                  <span className="text-xs text-(--ink-soft)">{r.code}</span>
                </Td>
                <Td numeric>{r.used_days}</Td>
                <Td numeric>
                  <span className={r.available_days > 0 ? "font-semibold" : "text-(--ink-soft)"}>{r.available_days}</span>
                </Td>
                <Td>
                  {r.buckets.length === 0 ? (
                    <span className="text-(--ink-soft)">—</span>
                  ) : (
                    <span className="text-xs">
                      {r.buckets
                        .map((b) => `${shortOf(b.month)} ${b.remaining_days} วัน (ถึงสิ้น ${shortOf(b.expires_month)})`)
                        .join(" · ")}
                    </span>
                  )}
                </Td>
                <Td>
                  {r.expiring_days > 0 ? (
                    <Pill tone="var(--tone-warn)">{r.expiring_days} วัน</Pill>
                  ) : (
                    <span className="text-(--ink-soft)">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}
