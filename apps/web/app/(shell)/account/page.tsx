import { requireAuth } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Avatar } from "@smartboss/ui/components/avatar";
import { AppScaffold } from "@/components/module/app-scaffold";
import { Field, SectionCard, inputClass } from "@/modules/admin/components/ui";
import { loadSecuritySettings } from "@/lib/security-settings";
import {
  changeOwnPasswordAction,
  removeOwnAvatarAction,
  updateOwnAvatarAction,
  updateOwnProfileAction,
} from "./actions";

/**
 * บัญชีของฉัน — ทุกคนที่ล็อกอินได้เข้าหน้านี้ได้ ไม่ต้องมีสิทธิ์อะไรเพิ่ม
 *
 * ก่อนมีหน้านี้ พนักงานทั่วไปเปลี่ยนรหัสผ่านตัวเองไม่ได้เลย ต้องไปขอแอดมิน
 * รีเซ็ตให้ ซึ่งแปลว่าแอดมินต้องรู้รหัสใหม่ของทุกคน — ใช้ไม่ได้กับระบบที่เก็บ
 * ข้อมูลเงินเดือน
 */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireAuth();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: {
      name: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
      organization: { select: { name: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
  });

  const roleNames = user.roles.map((r) => r.role.name).join(" · ") || "—";

  // ต้องตรงกับที่ changeOwnPasswordAction ใช้ตรวจจริง (ตั้งได้ที่ /admin/security)
  const { passwordMinLength } = await loadSecuritySettings(session.orgId ?? null);

  return (
    <AppScaffold title="บัญชีของฉัน" width="max-w-2xl" backHref="/">
      <SectionCard title="ข้อมูลบัญชี">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-(--ink-soft)">อีเมล</dt>
          <dd className="text-(--ink)">{user.email}</dd>
          <dt className="text-(--ink-soft)">บริษัท</dt>
          <dd className="text-(--ink)">{user.organization?.name ?? "—"}</dd>
          <dt className="text-(--ink-soft)">บทบาท</dt>
          <dd className="text-(--ink)">{roleNames}</dd>
        </dl>
        <p className="mt-3 text-xs text-(--ink-soft)">
          อีเมลใช้เป็นชื่อผู้ใช้สำหรับเข้าระบบ · ต้องการเปลี่ยนอีเมลหรือบทบาท
          ให้แจ้งผู้ดูแลของบริษัท
        </p>
      </SectionCard>

      <SectionCard
        title="รูปโปรไฟล์"
        description="แสดงในเมนูมุมขวาบนและทุกที่ที่มีชื่อคุณขึ้น"
        className="mt-4"
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <Avatar name={user.name} src={user.avatarUrl} className="h-20 w-20 text-2xl" />

          <div className="flex flex-1 flex-col gap-3">
            <form
              action={updateOwnAvatarAction}
              encType="multipart/form-data"
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <input
                type="file"
                name="avatar"
                accept="image/jpeg,image/png,image/webp,image/gif"
                required
                className="block w-full text-sm text-(--ink-soft) file:mr-3 file:rounded-(--radius) file:border-0 file:bg-(--bg-soft) file:px-3 file:py-2 file:text-sm file:font-medium file:text-(--ink) hover:file:bg-(--line)"
              />
              <Button type="submit" variant="outline" className="h-11 shrink-0">
                อัปโหลด
              </Button>
            </form>

            {user.avatarUrl && (
              <form action={removeOwnAvatarAction}>
                <button
                  type="submit"
                  className="text-xs text-(--ink-soft) underline-offset-2 hover:underline"
                >
                  ลบรูปโปรไฟล์
                </button>
              </form>
            )}

            <p className="text-xs text-(--ink-soft)">
              JPG, PNG, WEBP หรือ GIF — ขนาดไม่เกิน 5MB
            </p>
          </div>
        </div>
      </SectionCard>

      <form action={updateOwnProfileAction} className="mt-4">
        <SectionCard title="ชื่อที่แสดง" description="ชื่อที่คนอื่นเห็นในระบบ">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="ชื่อ-นามสกุล">
                <input
                  type="text"
                  name="name"
                  defaultValue={user.name}
                  required
                  maxLength={120}
                  className={inputClass}
                />
              </Field>
            </div>
            <Button type="submit" variant="outline" className="h-11 sm:w-32">
              บันทึก
            </Button>
          </div>
        </SectionCard>
      </form>

      <form action={changeOwnPasswordAction} className="mt-4">
        <SectionCard
          title="เปลี่ยนรหัสผ่าน"
          description="ต้องกรอกรหัสผ่านปัจจุบันเพื่อยืนยันว่าเป็นเจ้าของบัญชี"
        >
          <div className="grid gap-3">
            <Field label="รหัสผ่านปัจจุบัน">
              <input
                type="password"
                name="currentPassword"
                required
                autoComplete="current-password"
                className={inputClass}
              />
            </Field>
            <Field label="รหัสผ่านใหม่" hint={`อย่างน้อย ${passwordMinLength} ตัวอักษร`}>
              <input
                type="password"
                name="newPassword"
                required
                minLength={passwordMinLength}
                autoComplete="new-password"
                className={inputClass}
              />
            </Field>
            <Field label="ยืนยันรหัสผ่านใหม่">
              <input
                type="password"
                name="confirmPassword"
                required
                minLength={passwordMinLength}
                autoComplete="new-password"
                className={inputClass}
              />
            </Field>
          </div>

          <Card className="mt-4 border-(--tone-warn) p-3">
            <p className="text-xs text-(--ink-soft)">
              เปลี่ยนแล้วระบบจะ<strong className="text-(--ink)">ออกจากระบบทุกเครื่อง</strong>
              รวมถึงเครื่องนี้ แล้วให้เข้าใหม่ด้วยรหัสใหม่ —
              ตั้งใจให้เป็นแบบนั้น เพราะคนที่เปลี่ยนรหัสผ่านมักเปลี่ยนเพราะสงสัยว่ารหัสหลุด
            </p>
          </Card>

          <Button type="submit" className="mt-4 w-full sm:w-44">
            เปลี่ยนรหัสผ่าน
          </Button>
        </SectionCard>
      </form>
    </AppScaffold>
  );
}
