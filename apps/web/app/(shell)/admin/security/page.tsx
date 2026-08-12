import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { Field, SectionCard, inputClass } from "@/modules/admin/components/ui";
import {
  SECURITY_DEFAULTS,
  SECURITY_LIMITS,
  loadSecuritySettings,
} from "@/lib/security-settings";
import { saveSecuritySettingsAction } from "../actions";

/**
 * ตั้งค่าความปลอดภัยตอนเข้าสู่ระบบ
 *
 * เดิมเป็นค่าตายในโค้ด บังคับให้ทุกบริษัทใช้เกณฑ์เดียวกัน — ใช้ไม่ได้จริง
 * เพราะบริบทต่างกันมาก สำนักงานที่ทุกคนมีเครื่องของตัวเองควรเข้มกว่านี้
 * ส่วนโรงงานที่ใช้เครื่องร่วมกันทั้งกะ การล็อก 15 นาทีเท่ากับหยุดงานทั้งกะ
 *
 * บริษัทที่ยังไม่เคยตั้ง จะเห็นค่าเริ่มต้นกรอกไว้ให้ กดบันทึกครั้งแรกจึงเกิดแถวจริง
 */
export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.securitySettingManage)) {
    redirect("/admin");
  }

  const s = await loadSecuritySettings(session.orgId);

  return (
    <AppScaffold title="ความปลอดภัยการเข้าสู่ระบบ" width="max-w-3xl" backHref="/admin">
      <form action={saveSecuritySettingsAction} className="flex flex-col gap-4">
        <SectionCard
          title="ล็อกบัญชีเมื่อกรอกรหัสผิด"
          description="กันคนเดารหัสผ่านไปเรื่อย ๆ — ตั้งให้พอดีกับหน้างานจริง"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="ผิดกี่ครั้งถึงล็อก"
              hint={`ค่าเริ่มต้น ${SECURITY_DEFAULTS.maxFailedLogins} · ตั้งได้ ${SECURITY_LIMITS.maxFailedLogins.min}–${SECURITY_LIMITS.maxFailedLogins.max}`}
            >
              <input
                type="number"
                name="maxFailedLogins"
                defaultValue={s.maxFailedLogins}
                min={SECURITY_LIMITS.maxFailedLogins.min}
                max={SECURITY_LIMITS.maxFailedLogins.max}
                required
                className={inputClass}
              />
            </Field>
            <Field
              label="ล็อกนานกี่นาที"
              hint={`ค่าเริ่มต้น ${SECURITY_DEFAULTS.lockMinutes} · ตั้งได้ ${SECURITY_LIMITS.lockMinutes.min}–${SECURITY_LIMITS.lockMinutes.max}`}
            >
              <input
                type="number"
                name="lockMinutes"
                defaultValue={s.lockMinutes}
                min={SECURITY_LIMITS.lockMinutes.min}
                max={SECURITY_LIMITS.lockMinutes.max}
                required
                className={inputClass}
              />
            </Field>
          </div>
          <p className="mt-3 text-xs text-(--ink-soft)">
            ตั้งสั้นเกินไปคนเดารหัสจะลองได้เรื่อย ๆ · ตั้งยาวเกินไปพนักงานที่พิมพ์ผิด
            จะทำงานไม่ได้ทั้งกะ · แอดมินปลดล็อกให้ก่อนครบเวลาได้ที่หน้าผู้ใช้งาน
          </p>
        </SectionCard>

        <SectionCard
          title="รหัสผ่านและอายุการเข้าสู่ระบบ"
          description="มีผลกับการตั้งรหัสใหม่และการเข้าระบบครั้งถัดไป ไม่ย้อนหลัง"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="รหัสผ่านสั้นสุดกี่ตัวอักษร"
              hint={`ค่าเริ่มต้น ${SECURITY_DEFAULTS.passwordMinLength} · ตั้งได้ ${SECURITY_LIMITS.passwordMinLength.min}–${SECURITY_LIMITS.passwordMinLength.max}`}
            >
              <input
                type="number"
                name="passwordMinLength"
                defaultValue={s.passwordMinLength}
                min={SECURITY_LIMITS.passwordMinLength.min}
                max={SECURITY_LIMITS.passwordMinLength.max}
                required
                className={inputClass}
              />
            </Field>
          </div>
          <p className="mt-3 text-xs text-(--ink-soft)">
            มีผลกับการตั้งรหัสใหม่เท่านั้น — รหัสเดิมที่สั้นกว่าเกณฑ์ใหม่ยังใช้เข้าระบบได้
            จนกว่าเจ้าตัวจะเปลี่ยนเอง (ถ้าบังคับทันทีจะมีคนเข้าระบบไม่ได้โดยไม่รู้ตัว)
          </p>
        </SectionCard>

        <Card className="p-4">
          <p className="mb-3 text-xs text-(--ink-soft)">
            การจำกัดจำนวนครั้งต่อ IP (10 ครั้ง/นาที) ตั้งที่นี่ไม่ได้โดยตั้งใจ —
            ด่านนั้นทำงานก่อนระบบจะรู้ว่าอีเมลที่ส่งมาเป็นของบริษัทไหน
            ถ้าตั้งรายบริษัทได้ คนยิงสุ่มรหัสจะเลี่ยงด้วยการส่งอีเมลของบริษัท
            ที่ตั้งค่าหลวมที่สุด
          </p>
          <Button type="submit" className="w-full sm:w-40">
            บันทึกการตั้งค่า
          </Button>
        </Card>
      </form>
    </AppScaffold>
  );
}
