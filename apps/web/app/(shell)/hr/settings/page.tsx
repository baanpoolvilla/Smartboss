import Link from "next/link";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { SettingsSubnav } from "@/modules/hr/components/design-kit";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Company,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Field,
  NotProvisioned,
  Pill,
  SectionCard,
  StatusBadge,
  Td,
  inputClass,
} from "@/modules/hr/components/ui";
import { createShiftAction, createWorkPolicyAction } from "../actions";

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

/** ต้องตรงกับ late_mode ใน createWorkPolicySchema — STRICT | GRACE | FLEX */
const LATE_MODE: Record<string, string> = {
  STRICT: "นับทันที",
  GRACE: "ผ่อนผัน",
  FLEX: "เข้าได้ยืดหยุ่น",
};

/*
 * ตั้งค่าส่วนที่มีหน้าจอของตัวเองอยู่แล้ว "นอก" ต้นไม้ /hr/settings — ที่เหลือ
 * (วันหยุด/อุปกรณ์/ชุดกฎ/เกณฑ์คะแนน) ย้ายเข้า sub-nav ของหน้าตั้งค่าแล้ว
 * (SettingsSubnav) ไม่ต้องมีลิงก์ซ้ำอีกที่นี่
 */
const ELSEWHERE: { href: string; label: string; hint: string }[] = [
  {
    href: "/hr/employees",
    label: "ผูกตารางกะให้พนักงาน",
    hint: "เลือกคน → การ์ด “ตารางกะประจำสัปดาห์” · ไม่ผูกก็คิดสาย/ขาดไม่ได้",
  },
  /*
   * ย้ายโค้ดจริงมาไว้ที่นี่ไม่ได้ — หน้าจัดการสติกเกอร์ผูกกับ StoreHydrator
   * ที่ติดตั้งเฉพาะใน layout ของโมดูล report_task เท่านั้น เอามาวางนอกโมดูล
   * ปุ่ม "บันทึก" จะกดได้แต่ข้อมูลไม่ถูกส่งไปเซิร์ฟเวอร์จริง (ซิงก์ไม่ทำงาน)
   * ⇒ ลิงก์ตรงไปหน้าจริงพร้อม deep-link เปิดแท็บ/หัวข้อที่ถูกต้องให้เลย
   */
  {
    href: "/report-task/settings?tab=task&section=stickers",
    label: "สติกเกอร์ให้คะแนนบนการ์ดงาน",
    hint: "อิโมจิที่หัวหน้ากดบนการ์ดงาน Kanban (หัวร้อน/ทำได้ดี ฯลฯ) — คะแนนมีผลกับเกรดรวมของพนักงานด้วย",
  },
];

/**
 * หน้า index ของ /hr/settings — กะทำงาน + นโยบายการมาสาย
 *
 * ประเภทการลาแยกไปอยู่ /hr/settings/leave-types แล้ว ส่วนวันหยุด/อุปกรณ์/
 * ชุดกฎ/เกณฑ์คะแนนอยู่ในหน้าย่อยอื่นของ /hr/settings เช่นกัน — ดู SettingsSubnav
 */
export default async function HrSettingsPage() {
  return (
    <HrPage
      title="กะและเวลาทำงาน"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const companies = await wfFetch<Paged<Company>>("/companies");
        const companyId = companies.items[0]?.id;
        if (companyId === undefined) {
          return <NotProvisioned what="ตั้งค่าระบบบุคคล" />;
        }

        const [shifts, policies] = await Promise.all([
          wfTry<Paged<Shift>>(`/shifts?company_id=${companyId}`),
          wfTry<Paged<WorkPolicy>>("/work-policies"),
        ]);

        const today = new Date().toISOString().slice(0, 10);

        return (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <SettingsSubnav active="/hr/settings" />
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <SectionCard
              title="กะทำงาน"
              description="เวลาเข้า-ออกและช่วงพัก ใช้เป็นเกณฑ์คิดสาย/ขาด/OT"
            >
              {!shifts || shifts.items.length === 0 ? (
                <EmptyState>ยังไม่มีกะทำงาน</EmptyState>
              ) : (
                <DataTable
                  head={["ชื่อกะ", "รหัส", "เข้า", "ออก", "พัก", "ประเภท", "สถานะ"]}
                >
                  {shifts.items.map((shift) => {
                    const breakMinutes = shift.breaks.reduce(
                      (sum, b) => sum + b.duration_minutes,
                      0
                    );
                    return (
                      <tr key={shift.id} className="hover:bg-(--bg-soft)">
                        <Td className="font-medium">{shift.name}</Td>
                        <Td className="font-mono text-xs text-(--ink-soft)">{shift.code}</Td>
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

            <SectionCard
              title="เพิ่มกะทำงาน"
              description="กะข้ามคืนให้ติ๊ก &quot;ข้ามคืน&quot; แล้วเวลาออกจะตีความเป็นวันถัดไป"
            >
              <form
                action={createShiftAction}
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
              >
                <input type="hidden" name="company_id" value={companyId} />
                <Field label="ชื่อกะ *">
                  <input
                    name="name"
                    required
                    maxLength={120}
                    placeholder="กะกลางวัน"
                    className={inputClass}
                  />
                </Field>
                <Field label="นโยบาย" hint="เกณฑ์ผ่อนผันการมาสาย">
                  <select name="work_policy_id" defaultValue="" className={inputClass}>
                    <option value="">— ไม่ผูก (สายนาทีเดียวก็นับ) —</option>
                    {(policies?.items ?? []).map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.name}
                        {policy.late_mode === "GRACE"
                          ? ` · ผ่อนผัน ${policy.grace_minutes} น.`
                          : ` · ${LATE_MODE[policy.late_mode] ?? policy.late_mode}`}
                      </option>
                    ))}
                  </select>
                </Field>
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
              <p className="mt-3 text-xs text-(--ink-soft)">
                สร้างกะแล้วยังไม่พอ — ต้องไป
                <Link
                  href="/hr/employees"
                  className="mx-1 text-(--app-strong) hover:underline"
                >
                  ผูกตารางกะให้พนักงานรายคน
                </Link>
                ระบบถึงจะรู้ว่าใครควรเข้ากี่โมง
              </p>
            </SectionCard>

            <SectionCard
              title="นโยบายการทำงาน"
              description="เกณฑ์ผ่อนผันการมาสายและการอนุมัติ OT"
            >
              {!policies || policies.items.length === 0 ? (
                <p className="text-sm text-(--ink-soft)">ยังไม่มีนโยบาย</p>
              ) : (
                <DataTable
                  head={["ชื่อ", "วิธีคิดสาย", "ผ่อนผัน", "OT ต้องอนุมัติ"]}
                >
                  {policies.items.map((policy) => (
                    <tr key={policy.id} className="hover:bg-(--bg-soft)">
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

            <SectionCard
              title="เพิ่มนโยบายการทำงาน"
              description="กำหนดว่าสายได้กี่นาทีก่อนจะถูกนับว่าสาย แล้วเอาไปผูกกับกะ"
            >
              <form
                action={createWorkPolicyAction}
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
              >
                <input type="hidden" name="company_id" value={companyId} />
                <Field label="ชื่อนโยบาย *">
                  <input
                    name="name"
                    required
                    maxLength={120}
                    placeholder="พนักงานทั่วไป"
                    className={inputClass}
                  />
                </Field>
                <Field label="เริ่มใช้ตั้งแต่ *">
                  <input
                    type="date"
                    name="effective_from"
                    required
                    defaultValue={today}
                    className={inputClass}
                  />
                </Field>

                <Field label="วิธีคิดสาย *">
                  <select name="late_mode" defaultValue="GRACE" className={inputClass}>
                    <option value="GRACE">ผ่อนผัน — สายได้ตามจำนวนนาทีที่กำหนด</option>
                    <option value="STRICT">นับทันที — สายนาทีเดียวก็นับ</option>
                    <option value="FLEX">ยืดหยุ่น — เข้าได้ 07:00-10:00 ขอให้ครบ 8 ชม.</option>
                  </select>
                </Field>
                <Field label="สายได้กี่นาที" hint="0-240 · ใช้เมื่อเลือก &quot;ผ่อนผัน&quot;">
                  <input
                    type="number"
                    name="grace_minutes"
                    min={0}
                    max={240}
                    defaultValue={15}
                    className={inputClass}
                  />
                </Field>
                <Field label="เกินเวลาผ่อนผันแล้ว">
                  <select
                    name="grace_deduction"
                    defaultValue="EXCESS_OVER_GRACE"
                    className={inputClass}
                  >
                    <option value="EXCESS_OVER_GRACE">นับเฉพาะส่วนที่เกิน</option>
                    <option value="FULL_FROM_SCHEDULED">นับตั้งแต่เวลาเข้างาน</option>
                  </select>
                </Field>

                <Field label="ออกก่อนได้กี่นาที" hint="0-240">
                  <input
                    type="number"
                    name="early_out_tolerance_minutes"
                    min={0}
                    max={240}
                    defaultValue={0}
                    className={inputClass}
                  />
                </Field>
                <div className="flex items-end pb-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="ot_requires_approval"
                      value="1"
                      defaultChecked
                      className="h-4 w-4"
                    />
                    OT ต้องอนุมัติก่อน
                  </label>
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="sm:w-40">
                    เพิ่มนโยบาย
                  </Button>
                </div>
              </form>
              <p className="mt-3 text-xs text-(--ink-soft)">
                &ldquo;นับเฉพาะส่วนที่เกิน&rdquo; กับ &ldquo;นับตั้งแต่เวลาเข้างาน&rdquo;
                ต่างกันเป็นเงินจริง — ผ่อนผัน 15 นาทีแล้วมาสาย 20 นาที
                แบบแรกนับสาย 5 นาที แบบหลังนับ 20 นาที
              </p>
            </SectionCard>

            <SectionCard
              title="ตั้งค่าอื่นของระบบบุคคล"
              description="ส่วนที่มีหน้าจอของตัวเอง — รวมทางเข้าไว้ที่นี่จะได้ไม่ต้องไล่หาในเมนู"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ELSEWHERE.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-(--radius) border border-(--line) p-3 transition-colors hover:bg-(--bg-soft)"
                  >
                    <span className="block text-sm font-medium text-(--app-strong)">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-(--ink-soft)">
                      {item.hint}
                    </span>
                  </Link>
                ))}
              </div>
            </SectionCard>
          </div>
          </div>
        );
      }}
    />
  );
}
