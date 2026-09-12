import { HrPage } from "@/modules/hr/components/hr-page";
import { SettingsSubnav } from "@/modules/hr/components/design-kit";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Company,
  type LeaveType,
  type Me,
  type Paged,
} from "@/modules/hr/lib/api";
import { Field, NotProvisioned, Pill, SectionCard, inputClass } from "@/modules/hr/components/ui";
import { createLeaveTypeAction, seedLeaveTypesAction } from "../../actions";
import { Button } from "@smartboss/ui/components/button";

export default async function LeaveTypesSettingsPage() {
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

        const [me, leaveTypes] = await Promise.all([
          wfFetch<Me>("/me"),
          wfTry<Paged<LeaveType>>("/leave-types"),
        ]);

        /*
         * สิทธิ์ของ workforce ไม่ใช่ชุดเดียวกับของ Smartboss — คนที่เข้าหน้านี้ได้
         * อาจยังแก้ประเภทการลาไม่ได้ ซ่อนฟอร์มดีกว่าปล่อยให้กดแล้วโดน 403
         */
        const canManage = me.permissions.includes("workforce.scheduling.manage");

        return (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <SettingsSubnav active="/hr/settings/leave-types" />
            <div className="min-w-0 flex-1">
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
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {(leaveTypes?.items ?? []).map((t) => (
                        <Pill
                          key={t.id}
                          tone={t.auto_approve ? "var(--app-strong)" : "var(--tone-ok)"}
                        >
                          {t.name}
                          {t.auto_approve
                            ? ` · สิทธิ์${t.monthly_quota_days > 0 ? ` ${t.monthly_quota_days} วัน/เดือน` : ""}`
                            : " · ต้องอนุมัติ"}
                        </Pill>
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
                    <strong> ยังถูกนับเป็นขาดงานจนกว่าจะอนุมัติ</strong>
                  </p>
                </SectionCard>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
