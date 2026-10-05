import { HrPage } from "@/modules/hr/components/hr-page";
import { SettingsSubnav } from "@/modules/hr/components/design-kit";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Company,
  type Employment,
  type HolidayBalanceRow,
  type LeaveType,
  type Me,
  type MonthAllowance,
  type Paged,
} from "@/modules/hr/lib/api";
import { Field, NotProvisioned, Pill, SectionCard, inputClass } from "@/modules/hr/components/ui";
import {
  createLeaveTypeAction,
  renameLeaveTypeAction,
  seedLeaveTypesAction,
  setHolidayModeAction,
} from "../../actions";
import { HolidayAllowances } from "./holiday-allowances";
import { HolidayModeForm } from "./holiday-mode-form";
import { HolidayBalances } from "./holiday-balances";
import { Button } from "@smartboss/ui/components/button";
import { DeleteLeaveTypeButton, MoveLeftoverEntries } from "./delete-leave-type-button";

const MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** "2026-10-01" → "ตุลาคม 2569" */
function monthLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return MONTH_NAMES[Number(iso.slice(5, 7)) - 1] + " " + String(Number(iso.slice(0, 4)) + 543);
}

export default async function LeaveTypesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : new Date().getFullYear();
  // เดือนของตารางยอดคงเหลือรายคน — ค่าเริ่มต้นคือเดือนนี้ตามเวลาไทย
  const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()).slice(0, 7);
  const balanceMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : thisMonth;
  return (
    <HrPage
      title="ประเภทการลา"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const companies = await wfFetch<Paged<Company>>("/companies");
        const companyId = companies.items[0]?.id;
        if (companyId === undefined) {
          return <NotProvisioned what="ตั้งค่าประเภทการลา" />;
        }

        const [me, allTypes] = await Promise.all([
          wfFetch<Me>("/me"),
          // รวมประเภทที่ลบแล้ว — ใช้หาตัวที่ยังมีใบค้างอยู่ (ย้ายทีหลังได้ที่ท้ายหน้า)
          wfTry<Paged<LeaveType>>("/leave-types?include_archived=true"),
        ]);
        const leaveTypes = allTypes ? { ...allTypes, items: allTypes.items.filter((t) => !t.archived) } : null;
        // ลบแล้วแต่ยังมีใบเป็นประเภทนี้ = ยังขึ้นเป็นชิปในปฏิทินทีม จนกว่าจะย้ายใบไปประเภทอื่น
        const leftovers = (allTypes?.items ?? []).filter((t) => t.archived && (t.request_count ?? 0) > 0);
        // ประเภทที่นับสิทธิ์จากวันหยุดบริษัท (Holiday) — แต่ละอันมีตารางสิทธิ์รายเดือนให้ HR แก้
        const accruing = (leaveTypes?.items ?? []).filter((t) => t.accrues_from_holidays);
        // ยอดคงเหลือรายคนของประเภทที่สะสม — ชื่อพนักงานจับคู่จากทะเบียน (API คืนแค่ employment_id)
        const [balances, employments] = accruing[0]
          ? await Promise.all([
              wfTry<{ items: HolidayBalanceRow[] }>(`/leave-types/${accruing[0].id}/holiday-balances?month=${balanceMonth}`),
              wfTry<Paged<Employment>>("/employments"),
            ])
          : [null, null];
        const personOf = new Map((employments?.items ?? []).map((e) => [e.id, e]));
        const allowanceTables = await Promise.all(
          accruing.map(async (t) => ({
            type: t,
            months: (await wfTry<{ items: MonthAllowance[] }>(`/leave-types/${t.id}/month-allowances?year=${year}`))?.items ?? [],
          })),
        );
        const activeChoices = (leaveTypes?.items ?? []).map((o) => ({ id: o.id, name: o.name }));

        /*
         * สิทธิ์ของ workforce ไม่ใช่ชุดเดียวกับของ Smartboss — คนที่เข้าหน้านี้ได้
         * อาจยังแก้ประเภทการลาไม่ได้ ซ่อนฟอร์มดีกว่าปล่อยให้กดแล้วโดน 403
         */
        const canManage = me.permissions.includes("workforce.scheduling.manage");

        return (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <SettingsSubnav active="/hr/settings/leave-types" />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {!canManage ? (
                <SectionCard title="ประเภทการลา">
                  <p className="text-sm text-(--ink-soft)">
                    คุณไม่มีสิทธิ์แก้ไขประเภทการลา — ติดต่อผู้ดูแลระบบบุคคล
                  </p>
                </SectionCard>
              ) : (
                <SectionCard
                  title="ประเภทการลา"
                  description="ต้องมีอย่างน้อยหนึ่งประเภท พนักงานถึงจะลงวันหยุดเองได้ที่ปฏิทินทีม"
                  action={
                    <form action={seedLeaveTypesAction}>
                      <input type="hidden" name="company_id" value={companyId} />
                      <Button type="submit" size="sm" variant="outline">
                        สร้างชุดมาตรฐาน
                      </Button>
                    </form>
                  }
                >
                  {(leaveTypes?.items ?? []).length === 0 ? (
                    <p className="mb-3 text-sm text-(--ink-soft)">
                      ยังไม่มีประเภทการลา — กด “สร้างชุดมาตรฐาน” จะได้ วันหยุดประจำเดือน ·
                      ลาป่วย · ลากิจ · ลาพักร้อน · ลาไม่รับค่าจ้าง ครบในคลิกเดียว
                    </p>
                  ) : (
                    <div className="mb-3 flex flex-col gap-1.5">
                      {(leaveTypes?.items ?? []).map((t) => (
                        <div key={t.id} className="flex flex-wrap items-center gap-1.5">
                          <Pill tone={t.auto_approve ? "var(--app-strong)" : "var(--tone-ok)"}>
                            {t.name}
                            {t.auto_approve ? " · สิทธิ์" : " · ต้องอนุมัติ"}
                            {t.accrues_from_holidays
                              ? " · Holiday สะสม ใช้ได้ภายใน 3 เดือน"
                              : t.auto_approve && t.monthly_quota_days > 0
                                ? ` ${t.monthly_quota_days} วัน/เดือน`
                                : ""}
                            {t.requires_reports ? " · ยังต้องส่งรายงาน" : ""}
                          </Pill>
                          {/* แก้คำสะกดผิดในชื่อจริงได้ตรงนี้ — ค่าอื่น ๆ (โควตา,
                              ต้องอนุมัติหรือไม่) ยังตั้งได้ครั้งเดียวตอนสร้างเท่านั้น */}
                          <form action={renameLeaveTypeAction} className="flex items-center gap-1">
                            <input type="hidden" name="leave_type_id" value={t.id} />
                            <input
                              name="name"
                              defaultValue={t.name}
                              className={`${inputClass} h-7 w-40 text-xs`}
                              aria-label={`แก้ชื่อประเภทการลา ${t.name}`}
                            />
                            <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
                              บันทึกชื่อ
                            </Button>
                          </form>
                          <DeleteLeaveTypeButton
                            id={t.id}
                            name={t.name}
                            others={(leaveTypes?.items ?? []).filter((o) => o.id !== t.id).map((o) => ({ id: o.id, name: o.name }))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {leftovers.length > 0 && activeChoices.length > 0 && (
                    <div className="mb-3 flex flex-col gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 py-2">
                      <p className="text-xs font-semibold text-(--ink)">ประเภทที่ลบแล้ว แต่ยังมีใบค้างอยู่</p>
                      <p className="text-xs text-(--ink-soft)">
                        ใบเหล่านี้ยังขึ้นในปฏิทินทีมใต้ชื่อประเภทเดิม — ย้ายไปประเภทที่ใช้อยู่เพื่อรวมให้เป็นประเภทเดียว (ย้ายแล้วย้อนกลับไม่ได้)
                      </p>
                      {leftovers.map((t) => (
                        <MoveLeftoverEntries key={t.id} id={t.id} name={t.name} count={t.request_count ?? 0} others={activeChoices} />
                      ))}
                    </div>
                  )}
                  <form
                    action={createLeaveTypeAction}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                  >
                    <input type="hidden" name="company_id" value={companyId} />
                    <Field label="ชื่อ *">
                      <input
                        name="name"
                        required
                        maxLength={120}
                        placeholder="ลาพักร้อน"
                        className={inputClass}
                      />
                    </Field>
                    <Field label="โควตา (วัน/เดือน)" hint="0 = ไม่จำกัด">
                      <input
                        type="number"
                        name="monthly_quota_days"
                        min={0}
                        max={31}
                        defaultValue={0}
                        className={inputClass}
                      />
                    </Field>
                    <div className="flex items-end pb-3 text-sm sm:col-span-2">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="auto_approve" value="1" className="h-4 w-4" />
                        เป็นสิทธิ์ ไม่ต้องอนุมัติ (เลือกวันแล้วมีผลทันที)
                      </label>
                    </div>
                    <div className="flex items-end pb-3 text-sm sm:col-span-3">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="requires_reports" value="1" className="h-4 w-4" />
                        ยังต้องส่งรายงานตามปกติ (เช่น Work From Home — ไม่ต้องลงเวลา แต่ยังทำงาน)
                      </label>
                    </div>
                    <div className="flex items-end gap-2">
                      <select name="paid" defaultValue="1" className={inputClass}>
                        <option value="1">ได้ค่าจ้าง</option>
                        <option value="0">ไม่ได้ค่าจ้าง</option>
                      </select>
                      <Button type="submit">เพิ่ม</Button>
                    </div>
                  </form>
                  <p className="mt-3 text-xs text-(--ink-soft)">
                    ประเภทที่ติ๊ก &ldquo;เป็นสิทธิ์&rdquo;
                    พนักงานคลิกวันในปฏิทินแล้วหยุดได้ทันทีไม่ต้องรอใคร ·
                    ประเภทที่ไม่ติ๊กจะค้างเป็นคำขอ และ
                    <strong> ยังถูกนับเป็นขาดงานจนกว่าจะอนุมัติ</strong> ·
                    ทุกประเภทไม่ต้องลงเวลา ส่วนการส่งรายงานยกเว้นให้ เว้นแต่ติ๊ก &ldquo;ยังต้องส่งรายงาน&rdquo;
                  </p>
                </SectionCard>
              )}
              {canManage && activeChoices.length > 0 && (
                <HolidayModeForm
                  action={setHolidayModeAction}
                  types={activeChoices}
                  currentId={accruing[0]?.id ?? null}
                  startsLabel={monthLabel(accruing[0]?.accrual_starts_on)}
                />
              )}
              {canManage &&
                allowanceTables.map(({ type, months }) => (
                  <HolidayAllowances key={type.id} leaveTypeId={type.id} leaveTypeName={type.name} year={year} months={months} />
                ))}
              {canManage && accruing[0] && balances && (
                <HolidayBalances
                  leaveTypeName={accruing[0].name}
                  month={balanceMonth}
                  year={year}
                  rows={balances.items.map((b) => ({
                    ...b,
                    name: personOf.get(b.employment_id)?.display_name || personOf.get(b.employment_id)?.full_name || "ไม่ทราบชื่อ",
                    code: personOf.get(b.employment_id)?.employee_code ?? "",
                  }))}
                />
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
