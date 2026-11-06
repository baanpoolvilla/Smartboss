import { readChecklistTemplate } from "@/modules/maintenance/lib/work-order-checklist";
import { prisma } from "@smartboss/database";
import { roleLabel } from "@/modules/maintenance/lib/role-label";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import { pmPlansSkipExpense } from "@/modules/maintenance/data/pm";
import { textareaClass } from "@/modules/maintenance/components/ui";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { FilePreviewInput } from "@/modules/maintenance/components/photos";
import {
  MultiPicker,
  AssigneeAndCc,
} from "@/modules/maintenance/components/multi-picker";
import { createWorkOrderAction } from "../actions";
import { todayBangkok } from "@/modules/maintenance/lib/no-past-date";
import { SubmitButton } from "@/modules/maintenance/components/submit-button";
import { PasteDropFiles } from "@/components/annotate/paste-drop-files";
import { ReportPrefill } from "@/modules/maintenance/components/report-prefill";
import { WoAdvancedOptions, WoDueDateField, WoPriorityField, WoPrivateToggle, WoRequiredGuard } from "@/modules/maintenance/components/wo-form-fields";
import Link from "next/link";
import { InitialAvatar } from "@/modules/maintenance/components/wo-card";
import { AlignLeft, CalendarDays, House, Paperclip, Type, type LucideIcon } from "lucide-react";

/** แถวของฟอร์ม: ไอคอนซ้าย + เนื้อหา — จัดวางแบบหน้าสร้างงาน (ผู้ใช้ 2/11/2569 "ให้เหมือนรูปแบบของ task") */
function Row({ icon: Icon, children, className = "" }: { icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-[20px_1fr] items-start gap-3 ${className}`}>
      <Icon className="mt-2.5 h-[18px] w-[18px] text-(--ink-soft)" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{
    title?: string;
    propertyId?: string;
    additionalPropertyIds?: string;
    technicianId?: string;
    assetId?: string;
    priority?: string;
    dueDate?: string;
    pmScheduleId?: string;
    pmScheduleIds?: string;
    description?: string;
    fromReport?: string;
  }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.workorderManage)) {
    redirect("/maintenance/work-orders");
  }
  const sp = await searchParams;
  const pmIds = [sp.pmScheduleId, ...(sp.pmScheduleIds?.split(",") ?? [])].filter((x): x is string => !!x);
  const [properties, users, defaultNoExpense] = await Promise.all([
    listProperties(session.orgId),
    listOrgUsers(session.orgId),
    pmPlansSkipExpense(session.orgId, pmIds),
  ]);
  // เปิดใบจากแผน PM: ทีม วิธีปิดงาน และเช็กลิสต์ตามแผน (แก้ในฟอร์มได้)
  const plan = sp.pmScheduleId
    ? await prisma.pmSchedule.findFirst({
        where: { orgId: session.orgId, id: sp.pmScheduleId },
        select: { assignedTo: true, groupMemberIds: true, completionRule: true, checklist: true },
      })
    : null;

  // ผู้ดูแลบ้านมอบหมายได้เฉพาะช่าง/ผู้ดูแลบ้าน (เหมือนของเดิม)
  const isCaretaker =
    !hasPermission(session, MAINT_PERMS.propertyManage) &&
    hasPermission(session, MAINT_PERMS.workorderManage);
  const assignable = isCaretaker
    ? users.filter(
        (u) =>
          u.roleCodes.includes("TECHNICIAN") || u.roleCodes.includes("CARETAKER")
      )
    : users;

  const prefillProps = [
    ...(sp.propertyId ? [sp.propertyId] : []),
    ...(sp.additionalPropertyIds
      ? sp.additionalPropertyIds.split(",").filter(Boolean)
      : []),
  ];

  // เห็นช่อง "เปิด PR ต่อเลย" เฉพาะคนที่เปิด PR ได้จริง — ติ๊กแล้วไปต่อหน้า PR
  // ซึ่ง guard ด้วยสิทธิ์เดียวกัน คนที่เปิดไม่ได้ติ๊กไปก็เจอแค่หน้าเด้งกลับ
  const canOpenPr = hasPermission(session, MAINT_PERMS.poCreate);

  const userOptions = users.map((u) => ({
    id: u.id,
    label: u.name,
    sub: roleLabel(u.roleCodes),
  }));

  return (
    <AppScaffold
      title="สร้างใบแจ้งซ่อม"
      width="max-w-none"
      backHref="/maintenance/work-orders"
    >
      {/* กว้างเท่าหน้าต่างสร้างงาน (ผู้ใช้ 5/11/2569) */}
      <Card className="mx-auto w-full max-w-[640px] p-5">
        <PasteDropFiles label="ปล่อยเพื่อแนบรูป">
        {/* noValidate: ให้ WoRequiredGuard บอกเป็นภาษาไทยทีเดียวว่าขาดอะไรบ้าง — ไม่งั้นเบราว์เซอร์เด้ง
            "Please select an item in the list." (อังกฤษ ทีละช่อง) ก่อน แล้วข้อความไทยไม่ขึ้นเลย (ทดสอบ 3/11/2569)
            ช่องที่ต้องกรอกถูกตรวจซ้ำที่เซิร์ฟเวอร์อยู่แล้ว (createWorkOrderAction) */}
        <form action={createWorkOrderAction} noValidate className="group/wo flex flex-col gap-3 sm:gap-4">
          {sp.fromReport && <ReportPrefill />}
          {sp.assetId && <input type="hidden" name="assetId" value={sp.assetId} />}
          {sp.pmScheduleId && (
            <input type="hidden" name="pmScheduleId" value={sp.pmScheduleId} />
          )}
          {sp.pmScheduleIds &&
            sp.pmScheduleIds
              .split(",")
              .filter(Boolean)
              .map((pid) => (
                <input key={pid} type="hidden" name="pmScheduleIds" value={pid} />
              ))}

          <WoRequiredGuard />
          <WoPrivateToggle />

          <Row icon={Type}>
            <div className="flex items-center gap-2 border-b border-(--line) pb-1">
              <Input
                name="title"
                required
                maxLength={200}
                defaultValue={sp.title ?? ""}
                placeholder="หัวข้องาน เช่น แอร์ไม่เย็น ห้องนอน"
                aria-label="หัวข้องาน"
                className="h-10 flex-1 border-0 px-0 text-base font-semibold shadow-none focus-visible:ring-0"
              />
              <WoPriorityField defaultValue={sp.priority} />
            </div>
          </Row>

          <Row icon={AlignLeft}>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-(--ink-soft)">รายละเอียด</span>
              <textarea
                name="description"
                rows={3}
                maxLength={2000}
                defaultValue={sp.description ?? ""}
                placeholder="อาการ ตำแหน่ง หรือสิ่งที่ช่างควรรู้"
                className={textareaClass}
              />
            </label>
          </Row>

          {/* บ้าน · ผู้รับผิดชอบ แถวเดียวทุกขนาดจอ ไม่กินที่ (ผู้ใช้ 5/11/2569) · CC อยู่ในตัวเลือกขั้นสูง
              ใบส่วนตัว: ผู้รับผิดชอบคือคนเปิดเอง — ซ่อนช่องนั้น บ้านขยายเต็มแถว */}
          <Row icon={House}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:gap-3">
              <div data-wo-field="house" className="min-w-0 sm:group-data-[private=1]/wo:col-span-2">
              <MultiPicker
              name="propertyIds"
              title="เลือกบ้าน"
              heading="บ้าน *"
              boxed
              emptyText="เลือกบ้าน"
              addLabel="เลือกบ้าน"
              options={properties.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: p.name }))}
              defaultSelected={prefillProps}
            />
              </div>
              <div className="contents group-data-[private=1]/wo:hidden">
              <AssigneeAndCc
                users={assignable.map((u) => ({
                  id: u.id,
                  label: u.name,
                  sub: roleLabel(u.roleCodes),
                }))}
                defaultAssignee={sp.technicianId ?? plan?.assignedTo ?? ""}
                defaultMembers={plan?.groupMemberIds ?? []}
                defaultRule={plan?.completionRule ?? "all"}
                defaultChecklist={readChecklistTemplate(plan?.checklist)}
                withChecklist
                checklistSlotId="wo-checklist-slot"
              />
              </div>
            </div>
          </Row>

          <Row icon={CalendarDays}>
            <WoDueDateField defaultValue={sp.dueDate} minDate={todayBangkok()} />
          </Row>

          {/* เช็กลิสต์และรูปภาพอยู่ในตัวเลือกขั้นสูง (ผู้ใช้ 6/11/2569) — ใบส่วนตัวยังแนบรูป/ใส่เช็กลิสต์ได้ */}
          <div className="pl-8">
            <WoAdvancedOptions canOpenPr={canOpenPr} defaultNoExpense={defaultNoExpense} ccOptions={userOptions} checklistSlotId="wo-checklist-slot">
              <div className="flex items-start gap-2">
                <Paperclip className="mt-1 h-4 w-4 shrink-0 text-(--ink-soft)" aria-hidden="true" />
                <FilePreviewInput name="photos" label="รูปภาพ" attachStyle />
              </div>
            </WoAdvancedOptions>
          </div>

          <div className="-mx-5 -mb-5 mt-1 flex items-center justify-between gap-2 border-t border-(--line) px-5 py-3">
            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-(--ink-soft)">
              <InitialAvatar name={users.find((u) => u.id === session.userId)?.name ?? "คุณ"} />
              <span className="truncate max-[359px]:hidden">
                <span className="hidden sm:inline">เปิดโดย </span>
                <span className="font-medium text-(--ink)">{users.find((u) => u.id === session.userId)?.name ?? "คุณ"}</span>
              </span>
            </span>
            <div className="flex shrink-0 gap-2">
              <Link
                href="/maintenance/work-orders"
                className="inline-flex h-10 items-center rounded-(--radius) border border-(--line) px-4 text-sm font-medium text-(--ink) hover:bg-(--bg-soft)"
              >
                ยกเลิก
              </Link>
              <SubmitButton className="w-auto px-5">สร้างใบแจ้งซ่อม</SubmitButton>
            </div>
          </div>
        </form>
        </PasteDropFiles>
      </Card>
    </AppScaffold>
  );
}
