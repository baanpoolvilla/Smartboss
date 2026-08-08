import { redirect, notFound } from "next/navigation";
import { Building2, ShieldCheck } from "lucide-react";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { getOrgUser, getUserAnyOrg } from "@/modules/admin/data/users";
import { listAllOrganizations } from "@/modules/admin/data/orgs";
import { listRoles } from "@/modules/admin/data/roles";
import {
  Field,
  Pill,
  SectionCard,
  inputClass,
  selectClass,
} from "@/modules/admin/components/ui";
import { ConfirmSubmit } from "@/modules/admin/components/confirm-submit";
import {
  deleteUserAction,
  moveUserOrgAction,
  resetPasswordAction,
  setUserActiveAction,
  setUserRolesAction,
  updateUserAction,
} from "../../actions";

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moveTo?: string }>;
}) {
  const { id } = await params;
  const { moveTo } = await searchParams;
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.userView)) redirect("/admin");
  const canManage = hasPermission(session, ADMIN_PERMS.userManage);

  const superAdmin = isSuperAdmin(session);

  // SUPER_ADMIN เปิดดูผู้ใช้ของบริษัทไหนก็ได้ คนอื่นเห็นเฉพาะบริษัทตัวเอง
  const user = superAdmin
    ? await getUserAnyOrg(id)
    : await getOrgUser(session.orgId, id);
  if (!user) notFound();

  // บทบาทต้องมาจากบริษัท "ที่ผู้ใช้คนนี้สังกัด" ไม่ใช่บริษัทของคนที่กำลังดู
  const allRoles = user.orgId ? await listRoles(user.orgId) : [];
  const orgRoles = allRoles.filter((r) => !r.isSystem);

  const organizations = superAdmin ? await listAllOrganizations() : [];
  const currentOrgName =
    organizations.find((o) => o.id === user.orgId)?.name ?? null;

  // บริษัทปลายทางที่กำลังจะย้ายไป — ต้องโหลดบทบาทของบริษัทนั้นมาให้เลือกด้วย
  const moveTarget =
    superAdmin && moveTo && moveTo !== user.orgId
      ? (organizations.find((o) => o.id === moveTo) ?? null)
      : null;
  const moveTargetRoles = moveTarget
    ? (await listRoles(moveTarget.id)).filter((r) => !r.isSystem)
    : [];
  const heldRoleIds = new Set(user.roles.map((r) => r.roleId));
  const systemRoles = user.roles.filter((r) => r.role.isSystem);
  const isSelf = user.id === session.userId;

  return (
    <AppScaffold title={user.name} width="max-w-2xl" backHref="/admin/users">
      <div className="flex flex-col gap-4">
        {/* ─── ข้อมูลพื้นฐาน ─── */}
        <SectionCard title="ข้อมูลผู้ใช้">
          <p className="mb-3 text-sm text-(--ink-soft)">
            {user.email}
            {!user.isActive && (
              <span className="ml-2">
                <Pill color="#DC2626">ปิดใช้งาน</Pill>
              </span>
            )}
          </p>
          <p className="mb-3 text-xs text-(--ink-soft)">
            สร้างเมื่อ {fmt(user.createdAt)}
          </p>

          {superAdmin && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-(--ink-soft)">
              <Building2 className="h-3.5 w-3.5" />
              สังกัด{" "}
              <span className="font-semibold text-(--ink)">
                {currentOrgName ?? "ระดับแพลตฟอร์ม (ไม่สังกัดบริษัท)"}
              </span>
            </p>
          )}

          {systemRoles.length > 0 && (
            <p className="mb-3 flex items-center gap-2 text-xs text-(--ink-soft)">
              <Pill color="#8B5CF6">
                <ShieldCheck className="h-3 w-3" />
                {systemRoles.map((r) => r.role.name).join(", ")}
              </Pill>
              บทบาทระดับระบบ — แก้ไขจากหน้านี้ไม่ได้
            </p>
          )}

          {canManage ? (
            <form action={updateUserAction} className="flex flex-col gap-3">
              <input type="hidden" name="userId" value={user.id} />
              <Field label="ชื่อ-นามสกุล">
                <input
                  name="name"
                  defaultValue={user.name}
                  required
                  maxLength={120}
                  className={inputClass}
                />
              </Field>
              <Field label="LINE User ID" hint="สำหรับส่งแจ้งเตือนผ่าน LINE">
                <input
                  name="lineUserId"
                  defaultValue={user.lineUserId ?? ""}
                  placeholder="Uxxxxxxxx..."
                  className={inputClass}
                />
              </Field>
              <div>
                <Button type="submit" size="sm">
                  บันทึก
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-(--ink)">{user.name}</p>
          )}
        </SectionCard>

        {/* ─── บทบาท ─── */}
        <SectionCard
          title="บทบาท"
          description="กำหนดได้หลายบทบาท สิทธิ์จะรวมกันทั้งหมด"
        >
          {orgRoles.length === 0 ? (
            <p className="text-sm text-(--ink-soft)">
              ยังไม่มีบทบาทของบริษัท
            </p>
          ) : (
            <form action={setUserRolesAction} className="flex flex-col gap-2">
              <input type="hidden" name="userId" value={user.id} />
              {orgRoles.map((r) => (
                <label
                  key={r.id}
                  className="flex items-start gap-2.5 rounded-(--radius) border border-(--line) p-2.5"
                >
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={r.id}
                    defaultChecked={heldRoleIds.has(r.id)}
                    disabled={!canManage}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-(--ink)">
                      {r.name}{" "}
                      <span className="font-normal text-(--ink-soft)">
                        ({r.code})
                      </span>
                    </span>
                    {r.description && (
                      <span className="block text-xs text-(--ink-soft)">
                        {r.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {canManage && (
                <div className="mt-1">
                  <Button type="submit" size="sm">
                    บันทึกบทบาท
                  </Button>
                </div>
              )}
            </form>
          )}
        </SectionCard>

        {/* ─── ย้ายบริษัท (เฉพาะผู้ดูแลระบบสูงสุด) ─── */}
        {superAdmin && canManage && !isSelf && (
          <SectionCard
            title="ย้ายไปบริษัทอื่น"
            description="บทบาทผูกกับบริษัท การย้ายจะล้างบทบาทเดิมและให้เลือกบทบาทใหม่ ผู้ใช้จะถูกออกจากระบบทุกอุปกรณ์"
          >
            {/* เลือกบริษัทก่อน (GET) เพื่อโหลดบทบาทของบริษัทนั้น แล้วค่อยยืนยัน */}
            <form method="GET" className="mb-3 flex flex-wrap items-end gap-3">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-(--ink-soft)">
                  บริษัทปลายทาง
                </span>
                <select
                  name="moveTo"
                  defaultValue={moveTarget?.id ?? ""}
                  className={selectClass}
                >
                  <option value="">เลือกบริษัท</option>
                  {organizations
                    .filter((o) => o.id !== user.orgId)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                        {o.isActive ? "" : " (ปิดใช้งาน)"}
                      </option>
                    ))}
                </select>
              </label>
              <Button type="submit" size="sm" variant="outline">
                โหลดบทบาท
              </Button>
            </form>

            {moveTarget && (
              <form action={moveUserOrgAction} className="flex flex-col gap-3">
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="orgId" value={moveTarget.id} />
                <Field
                  label={`บทบาทใน ${moveTarget.name} *`}
                  hint="สิทธิ์สูงสุดของบริษัทคือ ผู้ดูแลบริษัท (ADMIN)"
                >
                  <select
                    name="roleId"
                    required
                    defaultValue=""
                    className={selectClass}
                  >
                    <option value="" disabled>
                      เลือกบทบาท
                    </option>
                    {moveTargetRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
                </Field>
                <div>
                  <ConfirmSubmit
                    message={`ย้าย ${user.name} ไปบริษัท ${moveTarget.name}? บทบาทเดิมจะถูกล้างทั้งหมด`}
                  >
                    ย้ายบริษัท
                  </ConfirmSubmit>
                </div>
              </form>
            )}
          </SectionCard>
        )}

        {canManage && (
          <>
            {/* ─── รหัสผ่าน ─── */}
            <SectionCard
              title="ตั้งรหัสผ่านใหม่"
              description="ตั้งแล้วผู้ใช้จะถูกออกจากระบบทุกอุปกรณ์"
            >
              <form action={resetPasswordAction} className="flex flex-col gap-3">
                <input type="hidden" name="userId" value={user.id} />
                <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร">
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={inputClass}
                  />
                </Field>
                <div>
                  <Button type="submit" size="sm" variant="outline">
                    ตั้งรหัสผ่านใหม่
                  </Button>
                </div>
              </form>
            </SectionCard>

            {/* ─── สถานะ / ลบ ─── */}
            <SectionCard title="สถานะบัญชี">
              <div className="flex flex-wrap items-center gap-2">
                <form action={setUserActiveAction}>
                  <input type="hidden" name="userId" value={user.id} />
                  <input
                    type="hidden"
                    name="isActive"
                    value={user.isActive ? "0" : "1"}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={isSelf && user.isActive}
                  >
                    {user.isActive ? "ปิดใช้งานบัญชี" : "เปิดใช้งานบัญชี"}
                  </Button>
                </form>

                <form action={deleteUserAction}>
                  <input type="hidden" name="userId" value={user.id} />
                  <ConfirmSubmit
                    message={`ต้องการลบผู้ใช้ "${user.name}" ใช่หรือไม่? ข้อมูลนี้กู้คืนไม่ได้`}
                    disabled={isSelf}
                    variant="danger"
                  >
                    ลบผู้ใช้
                  </ConfirmSubmit>
                </form>
              </div>
              {isSelf && (
                <p className="mt-2 text-xs text-(--ink-soft)">
                  ปิดใช้งานหรือลบบัญชีของตัวเองไม่ได้
                </p>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </AppScaffold>
  );
}
