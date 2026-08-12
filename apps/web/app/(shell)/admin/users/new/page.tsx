import { redirect } from "next/navigation";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { listRoles } from "@/modules/admin/data/roles";
import { listAllOrganizations } from "@/modules/admin/data/orgs";
import { Field, inputClass, selectClass } from "@/modules/admin/components/ui";
import { loadSecuritySettings } from "@/lib/security-settings";
import { createUserAction } from "../../actions";

export default async function NewUserPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.userManage)) redirect("/admin/users");

  const superAdmin = isSuperAdmin(session);
  const { orgId: requestedOrgId } = await searchParams;

  // เฉพาะ SUPER_ADMIN ที่เลือกบริษัทอื่นได้ คนอื่นล็อกที่บริษัทตัวเอง
  const organizations = superAdmin ? await listAllOrganizations() : [];
  const targetOrgId =
    superAdmin && requestedOrgId && organizations.some((o) => o.id === requestedOrgId)
      ? requestedOrgId
      : session.orgId;

  // role ระบบกำหนดให้ผู้ใช้จากหน้านี้ไม่ได้ — ต้องตั้งจากระดับแพลตฟอร์ม
  const roles = (await listRoles(targetOrgId)).filter((r) => !r.isSystem);
  const targetOrgName = organizations.find((o) => o.id === targetOrgId)?.name ?? null;

  // ความยาวรหัสผ่านขั้นต่ำตั้งได้รายบริษัท (/admin/security) — ต้องตรงกับที่
  // createUserAction ใช้ตรวจจริง ไม่งั้นฟอร์มยอมให้กรอกสั้นกว่าที่ผ่านจริง
  // แล้วพังตอนกด submit
  const { passwordMinLength } = await loadSecuritySettings(targetOrgId);

  return (
    <AppScaffold title="เพิ่มผู้ใช้งาน" width="max-w-2xl" backHref="/admin/users">
      {superAdmin && (
        /*
         * เปลี่ยนบริษัทแล้วต้องโหลดบทบาทของบริษัทนั้นใหม่ จึงส่งเป็น GET ให้หน้า
         * re-render ฝั่งเซิร์ฟเวอร์ แทนที่จะไปถือ state ฝั่ง client
         */
        <Card className="mb-4 p-5">
          <form method="GET" className="flex flex-col gap-3">
            <Field
              label="บริษัทปลายทาง"
              hint="ผู้ใช้ใหม่จะสังกัดบริษัทนี้ และเลือกบทบาทได้เฉพาะของบริษัทนี้"
            >
              <select name="orgId" defaultValue={targetOrgId} className={selectClass}>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.isActive ? "" : " (ปิดใช้งาน)"} — {o.userCount} คน
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <Button type="submit" variant="outline" className="w-full sm:w-48">
                โหลดบทบาทของบริษัทนี้
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <form action={createUserAction} className="flex flex-col gap-4">
          {/* ฝั่ง action ตรวจซ้ำว่าคนกดเป็น SUPER_ADMIN จริงก่อนยอมข้ามบริษัท */}
          <input type="hidden" name="orgId" value={targetOrgId} />

          {superAdmin && targetOrgName && (
            <p className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink-soft)">
              กำลังเพิ่มผู้ใช้เข้าบริษัท{" "}
              <span className="font-semibold text-(--ink)">{targetOrgName}</span>
            </p>
          )}

          <Field label="ชื่อ-นามสกุล *">
            <input name="name" required maxLength={120} className={inputClass} />
          </Field>

          <Field label="อีเมล *" hint="ใช้เข้าสู่ระบบ">
            <input
              type="email"
              name="email"
              required
              autoComplete="off"
              className={inputClass}
            />
          </Field>

          <Field label="รหัสผ่านเริ่มต้น *" hint={`อย่างน้อย ${passwordMinLength} ตัวอักษร`}>
            <input
              type="password"
              name="password"
              required
              minLength={passwordMinLength}
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>

          <Field label="บทบาท *" hint="สิทธิ์สูงสุดของบริษัทคือ ผู้ดูแลบริษัท (ADMIN)">
            <select name="roleId" required defaultValue="" className={selectClass}>
              <option value="" disabled>
                เลือกบทบาท
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
          </Field>

          <div>
            <Button type="submit" className="w-full sm:w-40">
              เพิ่มผู้ใช้
            </Button>
          </div>
        </form>
      </Card>
    </AppScaffold>
  );
}
