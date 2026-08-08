import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, wfTry, type Company, type Paged } from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Field,
  Pill,
  SectionCard,
  StatusBadge,
  Td,
  inputClass,
} from "@/modules/hr/components/ui";
import { createShiftAction } from "../actions";

interface Shift {
  id: string;
  company_id: string;
  code: string;
  name: string;
  start_minutes: number;
  end_minutes: number;
  rest_day: boolean;
  status: string;
  breaks: {
    start_minutes: number;
    duration_minutes: number;
    paid: boolean;
    auto_deduct: boolean;
  }[];
}

interface WorkPolicy {
  id: string;
  code: string;
  name: string;
  late_mode: string;
  grace_minutes: number;
  ot_requires_approval: boolean;
}

/** 480 → "08:00" · เกิน 1440 = ข้ามวัน แสดง +1 */
function minutesToClock(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "—";
  const day = Math.floor(minutes / 1440);
  const withinDay = minutes - day * 1440;
  const hour = String(Math.floor(withinDay / 60)).padStart(2, "0");
  const minute = String(withinDay % 60).padStart(2, "0");
  return day > 0 ? `${hour}:${minute} (+${day})` : `${hour}:${minute}`;
}

const LATE_MODE: Record<string, string> = {
  GRACE_THEN_FULL: "ผ่อนผันแล้วนับเต็ม",
  GRACE_THEN_EXCESS: "ผ่อนผันแล้วนับส่วนเกิน",
  STRICT: "นับทันที",
};

export default async function ShiftsPage() {
  return (
    <HrPage
      title="กะทำงาน"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const companies = await wfFetch<Paged<Company>>("/companies");
        const companyId = companies.items[0]?.id;

        const [shifts, policies] = await Promise.all([
          wfTry<Paged<Shift>>(
            companyId ? `/shifts?company_id=${companyId}` : "/shifts"
          ),
          wfTry<Paged<WorkPolicy>>("/work-policies"),
        ]);

        return (
          <div className="flex flex-col gap-4">
            <SectionCard
              title="กะทำงาน"
              description="เวลาเข้า-ออกและช่วงพัก ใช้เป็นเกณฑ์คิดสาย/ขาด/OT"
            >
              {!shifts || shifts.items.length === 0 ? (
                <EmptyState>ยังไม่มีกะทำงาน</EmptyState>
              ) : (
                <DataTable
                  head={["รหัส", "ชื่อกะ", "เข้า", "ออก", "พัก", "ประเภท", "สถานะ"]}
                >
                  {shifts.items.map((shift) => {
                    const breakMinutes = shift.breaks.reduce(
                      (sum, b) => sum + b.duration_minutes,
                      0
                    );
                    return (
                      <tr key={shift.id} className="hover:bg-(--bg-soft)">
                        <Td className="font-mono text-xs">{shift.code}</Td>
                        <Td className="font-medium">{shift.name}</Td>
                        <Td>{minutesToClock(shift.start_minutes)}</Td>
                        <Td>{minutesToClock(shift.end_minutes)}</Td>
                        <Td>{breakMinutes > 0 ? `${breakMinutes} น.` : "—"}</Td>
                        <Td>
                          {shift.rest_day ? (
                            <Pill tone="var(--tone-info)">วันหยุด</Pill>
                          ) : (
                            <Pill tone="var(--tone-ok)">วันทำงาน</Pill>
                          )}
                        </Td>
                        <Td>
                          <StatusBadge value={shift.status} />
                        </Td>
                      </tr>
                    );
                  })}
                </DataTable>
              )}
            </SectionCard>

            {companyId && (
              <SectionCard
                title="เพิ่มกะทำงาน"
                description="กะข้ามคืนให้ติ๊ก &quot;ข้ามคืน&quot; แล้วเวลาออกจะตีความเป็นวันถัดไป"
              >
                <form
                  action={createShiftAction}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                >
                  <input type="hidden" name="company_id" value={companyId} />
                  <Field label="รหัสกะ *">
                    <input
                      name="code"
                      required
                      maxLength={32}
                      placeholder="DAY"
                      className={`${inputClass} font-mono uppercase`}
                    />
                  </Field>
                  <Field label="ชื่อกะ *">
                    <input
                      name="name"
                      required
                      maxLength={120}
                      placeholder="กะกลางวัน"
                      className={inputClass}
                    />
                  </Field>
                  <div />
                  <Field label="เวลาเข้า *">
                    <input type="time" name="start" required className={inputClass} />
                  </Field>
                  <Field label="เวลาออก *">
                    <input type="time" name="end" required className={inputClass} />
                  </Field>
                  <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="crosses_midnight"
                        value="1"
                        className="h-4 w-4"
                      />
                      ข้ามคืน
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="rest_day" value="1" className="h-4 w-4" />
                      เป็นวันหยุด
                    </label>
                  </div>
                  <div className="sm:col-span-3">
                    <Button type="submit" className="sm:w-40">
                      เพิ่มกะ
                    </Button>
                  </div>
                </form>
              </SectionCard>
            )}

            <SectionCard
              title="นโยบายการทำงาน"
              description="เกณฑ์ผ่อนผันการมาสายและการอนุมัติ OT"
            >
              {!policies || policies.items.length === 0 ? (
                <p className="text-sm text-(--ink-soft)">ยังไม่มีนโยบาย</p>
              ) : (
                <DataTable
                  head={["รหัส", "ชื่อ", "วิธีคิดสาย", "ผ่อนผัน", "OT ต้องอนุมัติ"]}
                >
                  {policies.items.map((policy) => (
                    <tr key={policy.id} className="hover:bg-(--bg-soft)">
                      <Td className="font-mono text-xs">{policy.code}</Td>
                      <Td className="font-medium">{policy.name}</Td>
                      <Td>{LATE_MODE[policy.late_mode] ?? policy.late_mode}</Td>
                      <Td align="right">{policy.grace_minutes} น.</Td>
                      <Td>
                        {policy.ot_requires_approval ? (
                          <Pill tone="var(--tone-warn)">ต้องอนุมัติ</Pill>
                        ) : (
                          <Pill tone="var(--tone-muted)">ไม่ต้อง</Pill>
                        )}
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </SectionCard>
          </div>
        );
      }}
    />
  );
}
