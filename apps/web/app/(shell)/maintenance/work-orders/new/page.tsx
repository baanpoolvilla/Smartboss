import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import {
  Field,
  selectClass,
  textareaClass,
} from "@/modules/maintenance/components/ui";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { FilePreviewInput } from "@/modules/maintenance/components/photos";
import {
  MultiPicker,
  AssigneeAndCc,
} from "@/modules/maintenance/components/multi-picker";
import { createWorkOrderAction } from "../actions";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "ผู้ดูแลระบบ",
  CEO: "เจ้าของ",
  MANAGER: "ผู้จัดการ",
  CARETAKER: "ผู้ดูแลบ้าน",
  TECHNICIAN: "ช่าง",
  STAFF: "พนักงาน",
};
function roleLabel(codes: string[]): string {
  const c = codes.find((x) => ROLE_LABEL[x]);
  return c ? ROLE_LABEL[c]! : "";
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
    pmScheduleId?: string;
    pmScheduleIds?: string;
    description?: string;
  }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.workorderManage)) {
    redirect("/maintenance/work-orders");
  }
  const sp = await searchParams;
  const [properties, users] = await Promise.all([
    listProperties(session.orgId),
    listOrgUsers(session.orgId),
  ]);

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

  const userOptions = users.map((u) => ({
    id: u.id,
    label: u.name,
    sub: roleLabel(u.roleCodes),
  }));

  return (
    <AppScaffold
      title="สร้างใบงานใหม่"
      width="max-w-2xl"
      backHref="/maintenance/work-orders"
    >
      <Card className="p-5">
        <form action={createWorkOrderAction} className="flex flex-col gap-4">
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

          <Field label="หัวข้องาน *">
            <Input
              name="title"
              required
              maxLength={200}
              defaultValue={sp.title ?? ""}
              placeholder="เช่น แอร์ไม่เย็น ห้องนอน"
            />
          </Field>

          <MultiPicker
            name="propertyIds"
            title="เลือกบ้าน"
            heading="บ้าน *"
            emptyText="กรุณาเลือกอย่างน้อย 1 บ้าน"
            addLabel="เลือกบ้าน"
            options={properties.map((p) => ({ id: p.id, label: p.name }))}
            defaultSelected={prefillProps}
          />

          <AssigneeAndCc
            users={assignable.map((u) => ({
              id: u.id,
              label: u.name,
              sub: roleLabel(u.roleCodes),
            }))}
            ccOptions={userOptions}
            defaultAssignee={sp.technicianId ?? ""}
          />

          <Field label="ความสำคัญ">
            <select
              name="priority"
              defaultValue={sp.priority ?? "medium"}
              className={selectClass}
            >
              <option value="low">ต่ำ</option>
              <option value="medium">ปานกลาง</option>
              <option value="urgent">เร่งด่วน</option>
            </select>
          </Field>

          <label className="flex items-start gap-2.5 rounded-(--radius) border border-(--line) p-3">
            <input
              type="checkbox"
              name="noExpense"
              value="1"
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium text-(--ink)">
                งานนี้ไม่มีค่าใช้จ่าย
              </span>
              <span className="block text-xs text-(--ink-soft)">
                เช่น งานที่จ้างเหมารายปีไว้แล้ว — ติ๊กแล้วตอนปิดงานจะไม่ถามค่าใช้จ่าย
                และไม่ถูกทวงในรายงาน
              </span>
            </span>
          </label>

          <Field label="รายละเอียด">
            <textarea
              name="description"
              rows={4}
              defaultValue={sp.description ?? ""}
              className={textareaClass}
            />
          </Field>

          <FilePreviewInput name="photos" label="แนบรูปภาพ" />

          <div>
            <Button type="submit" className="w-full sm:w-48">
              บันทึกใบงาน
            </Button>
          </div>
        </form>
      </Card>
    </AppScaffold>
  );
}
