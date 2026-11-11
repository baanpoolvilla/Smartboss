import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@smartboss/database";
import { listRoles } from "@/modules/admin/data/roles";
import { ceoTitle } from "@/lib/ceo-title";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { Field, SectionCard, inputClass } from "@/modules/admin/components/ui";
import {
  IDLE_LOGOUT_LIMITS,
  SECURITY_DEFAULTS,
  SECURITY_LIMITS,
  ipAllowed,
  loadSecuritySettings,
} from "@/lib/security-settings";

const checkRow = "flex items-start gap-3 rounded-lg border border-(--line) p-3 text-sm text-(--ink)";
import { saveSecuritySettingsAction } from "../actions";

const checkBox = "mt-0.5 h-5 w-5 shrink-0 accent-(--brand-navy)";

/**
 * คำอธิบายของสวิตช์แต่ละตัว แบบหัวข้อคงที่ — เปิดแล้วเกิดอะไร / ระวัง / ยกเลิก
 * (ผู้ใช้ 11/11/2569 "มีไว้ก็ได้แต่อยากให้อธิบายให้ชัดเจน" — เดิมเป็นย่อหน้าเดียวคั่นด้วยจุด อ่านยาก)
 */
function Explain({ rows }: { rows: [label: string, text: React.ReactNode][] }) {
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-2 rounded-lg bg-(--bg-soft) p-3 text-sm sm:grid-cols-[7.5rem_1fr]">
      {rows.map(([label, text]) => (
        <div key={label} className="sm:contents">
          <dt className="font-semibold text-(--ink)">{label}</dt>
          <dd className="text-(--ink-soft)">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

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

  // บทบาทของบริษัทนี้ + จำนวนคนที่เปิด 2 ชั้นแล้ว — ให้เห็นก่อนติ๊กบังคับว่าจะกระทบกี่คน
  const [roles, users, boss, hdrs] = await Promise.all([
    listRoles(session.orgId),
    prisma.user.findMany({
      where: { orgId: session.orgId, isActive: true },
      select: { totpEnabledAt: true, roles: { select: { role: { select: { code: true } } } } },
    }),
    ceoTitle(),
    headers(),
  ]);
  const roleStats = new Map<string, { total: number; ready: number }>();
  for (const u of users) {
    for (const r of u.roles) {
      const st = roleStats.get(r.role.code) ?? { total: 0, ready: 0 };
      st.total += 1;
      if (u.totpEnabledAt) st.ready += 1;
      roleStats.set(r.role.code, st);
    }
  }
  const usedRoles = roles.filter((r) => r.code !== "SUPER_ADMIN" && (roleStats.get(r.code)?.total ?? 0) > 0);
  const myIp = (hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "").replace(/^::ffff:/, "");
  const myIpBlocked = s.salaryAllowedIps.length > 0 && !ipAllowed(s.salaryAllowedIps, myIp);

  return (
    <AppScaffold title="ความปลอดภัยการเข้าสู่ระบบ" width="max-w-none" backHref="/admin">
      <form action={saveSecuritySettingsAction} className="flex flex-col gap-4">
        <Card className="p-4">
          <p className="text-sm font-semibold text-(--ink)">หน้านี้ใช้ทำอะไร</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-(--ink-soft)">
            <li>สองหัวข้อแรกคือเกณฑ์ล็อกบัญชีและความยาวรหัสผ่าน ใช้อยู่แล้วทุกบริษัท</li>
            <li>
              หัวข้อที่เหลือเป็น<strong className="text-(--ink)">ตัวเลือกเสริม ปิดไว้ทั้งหมด</strong>{" "}
              ไม่แตะ ระบบก็ทำงานเหมือนเดิม
            </li>
            <li>เปลี่ยนอะไรแล้วต้องกดปุ่มบันทึกการตั้งค่าท้ายหน้า ถึงจะมีผล และมีผลทันที</li>
            <li>ยกเลิกได้ทุกตัวที่หน้านี้ เอาติ๊กออกหรือลบค่าทิ้งแล้วบันทึก</li>
          </ul>
        </Card>

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

        <SectionCard
          title="ยืนยันตัวตน 2 ชั้น (2FA)"
          description="ทุกคนเปิดใช้เองได้อยู่แล้วที่ บัญชีของฉัน › ความปลอดภัย — ตรงนี้เลือกว่าบทบาทไหนต้องเปิด"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {usedRoles.map((r) => {
              const st = roleStats.get(r.code) ?? { total: 0, ready: 0 };
              return (
                <label key={r.code} className={checkRow}>
                  <input
                    type="checkbox"
                    name="twoFactorRoles"
                    value={r.code}
                    defaultChecked={s.twoFactorRoles.includes(r.code)}
                    className={checkBox}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{r.code === "CEO" ? boss : r.name}</span>
                    <span className="block text-xs text-(--ink-soft)">
                      {st.total} คน · เปิด 2 ชั้นแล้ว {st.ready} คน
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <Explain
            rows={[
              ["คืออะไร", "ตอนเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน ต้องพิมพ์เลข 6 หลักจากแอปในมือถือของตัวเองเพิ่มอีกขั้น รหัสผ่านหลุดอย่างเดียวคนอื่นจึงเข้าไม่ได้"],
              ["ไม่ติ๊กเลย", "ไม่บังคับใคร ใครอยากใช้ก็เปิดเองได้ ใครไม่เปิดก็เข้าระบบแบบเดิม"],
              ["ติ๊กบทบาทไหน", "คนในบทบาทนั้นที่ยังไม่ได้เปิด จะถูกพาไปหน้าตั้งค่าทันทีที่เปิดระบบ ใช้เวลาราว 2 นาที ตั้งเสร็จใช้งานต่อได้เลย ระหว่างยังไม่ตั้ง เปิดหน้าจัดการเงินเดือนไม่ได้"],
              [
                "ก่อนติ๊ก",
                <>
                  บอกคนในบทบาทนั้นล่วงหน้า และให้โหลดแอป Google Authenticator หรือ Microsoft Authenticator ไว้ก่อน{" "}
                  <strong className="text-(--ink)">ติ๊กแล้วมีผลทันทีที่บันทึก</strong>
                </>,
              ],
              ["มือถือหาย", "ใช้รหัสสำรองที่ได้ตอนเปิด หรือให้ผู้ดูแลกดล้างยืนยันตัวตน 2 ชั้น ที่หน้าผู้ใช้งานของคนนั้น"],
              ["เข้าทาง LINE", "ไม่ถามเลข 6 หลัก เพราะต้องถือมือถือที่ล็อกอิน LINE ของตัวเองอยู่แล้ว"],
            ]}
          />
        </SectionCard>

        <SectionCard
          title="ระหว่างใช้งาน"
          description="ปิดไว้ทั้งหมดเป็นค่าเริ่มต้น — เปิดเฉพาะที่เหมาะกับบริษัท"
        >
          <div className="grid gap-3">
            <label className={checkRow}>
              <input type="checkbox" name="requireCurrentPassword" defaultChecked={s.requireCurrentPassword} className={checkBox} />
              <span>
                <span className="block font-medium">เปลี่ยนรหัสผ่านต้องกรอกรหัสปัจจุบันก่อน</span>
                <span className="mt-1 block text-xs text-(--ink-soft)">
                  <strong className="text-(--ink)">เปิดแล้ว:</strong> หน้าเปลี่ยนรหัสผ่านมีช่องรหัสผ่านปัจจุบันเพิ่ม
                  คนที่หยิบเครื่องที่ล็อกอินค้างไว้จึงเปลี่ยนรหัสยึดบัญชีไม่ได้
                </span>
                <span className="block text-xs text-(--ink-soft)">
                  <strong className="text-(--ink)">ข้อเสีย:</strong> คนที่ลืมรหัสเปลี่ยนเองไม่ได้ ต้องให้ผู้ดูแลตั้งรหัสใหม่ให้
                </span>
              </span>
            </label>
            <label className={checkRow}>
              <input type="checkbox" name="notifyNewDevice" defaultChecked={s.notifyNewDevice} className={checkBox} />
              <span>
                <span className="block font-medium">แจ้งเจ้าของบัญชีเมื่อเข้าสู่ระบบจากอุปกรณ์ใหม่</span>
                <span className="mt-1 block text-xs text-(--ink-soft)">
                  <strong className="text-(--ink)">เปิดแล้ว:</strong> เมื่อบัญชีถูกเข้าจากเครื่องหรือเบราว์เซอร์ชนิดที่ไม่เคยใช้
                  เจ้าของบัญชีได้แจ้งเตือน ถ้าไม่ใช่ตัวเองจะรู้ทันที
                </span>
                <span className="block text-xs text-(--ink-soft)">
                  <strong className="text-(--ink)">ไม่เปิด:</strong> ไม่แจ้งเตือน แต่ยังบันทึกไว้ให้ผู้ดูแลดูได้ที่ ประวัติการใช้งาน
                </span>
              </span>
            </label>
            <Field
              label="ออกจากระบบเองเมื่อไม่ได้ใช้งาน (นาที)"
              hint={`0 = ไม่ใช้ (แบบเดิม) · ตั้งได้ ${IDLE_LOGOUT_LIMITS.min}–${IDLE_LOGOUT_LIMITS.max} นาที`}
            >
              <input
                type="number"
                name="idleLogoutMinutes"
                defaultValue={s.idleLogoutMinutes}
                min={0}
                max={IDLE_LOGOUT_LIMITS.max}
                inputMode="numeric"
                className={`${inputClass} sm:w-40`}
              />
            </Field>
            <Explain
              rows={[
                ["ใส่ 0", "ไม่ใช้ ล็อกอินค้างไว้ได้เหมือนเดิม"],
                ["ใส่ตัวเลข", "ไม่แตะหน้าจอครบจำนวนนาทีนั้น ระบบออกจากระบบให้เอง มีกล่องเตือนนับถอยหลัง 1 นาทีก่อน กดใช้งานต่อได้"],
                ["มีผลกับ", "ทุกคนในบริษัท ทั้งคอมและมือถือ ยกเว้นหน้าลงเวลาในแอป LINE"],
                ["ควรรู้", "ปิดแอปมือถือทิ้งไว้นานเกินเวลานี้ เปิดใหม่ต้องเข้าสู่ระบบใหม่ทุกครั้ง ข้อมูลที่พิมพ์ค้างไว้และยังไม่บันทึกจะหาย ส่วนตอนโทรหรือดูวิดีโอไม่นับว่าไม่ได้ใช้งาน"],
                ["แนะนำ", "เครื่องที่ใช้ร่วมกันหลายคน 15–30 นาที ถ้าทุกคนใช้เครื่องตัวเอง ไม่ต้องตั้งก็ได้"],
              ]}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="จำกัดที่ที่เปิดหน้าจัดการเงินเดือนได้"
          description="เว้นว่าง = เปิดได้จากทุกที่ (แบบเดิม)"
        >
          <Field
            label="IP ที่อนุญาต (บรรทัดละ 1 รายการ)"
            hint="เว้นว่าง = ไม่จำกัด · ลงท้าย * ได้ เช่น 203.0.113.*"
          >
            <textarea
              name="salaryAllowedIps"
              defaultValue={s.salaryAllowedIps.join("\n")}
              rows={3}
              spellCheck={false}
              placeholder="เช่น 203.0.113.25"
              className={`${inputClass} h-auto py-2 font-mono`}
            />
          </Field>
          <p className="mt-2 text-sm text-(--ink)">
            IP ของคุณตอนนี้: <strong className="font-mono">{myIp || "ไม่ทราบ"}</strong>
            <span className="text-xs text-(--ink-soft)"> (นั่งอยู่ที่ออฟฟิศ ใส่เลขนี้ได้เลย)</span>
          </p>
          <Explain
            rows={[
              ["IP คืออะไร", "เลขประจำเครือข่ายอินเทอร์เน็ต ทุกเครื่องที่ต่อ Wi-Fi ออฟฟิศเดียวกันจะเป็นเลขเดียวกัน"],
              ["ใส่แล้ว", "หน้าจัดการเงินเดือน สลิปของคนอื่น และไฟล์ส่งออก เปิดได้เฉพาะจากเครือข่ายในรายการ คนที่อยู่นอกรายการเห็นข้อความบอกเหตุผล และยังดูสลิปของตัวเองได้"],
              ["ไม่กระทบ", "สิทธิ์ของแต่ละคนยังอยู่ครบ กลับมาใช้เครือข่ายในรายการก็เห็นเมนูเดิมทันที พนักงานทั่วไปไม่เกี่ยวเลย"],
              [
                "ระวัง",
                <>
                  ใช้ได้เฉพาะออฟฟิศที่มี <strong className="text-(--ink)">IP คงที่</strong> ถามผู้ให้บริการอินเทอร์เน็ตก่อน
                  เน็ตบ้านและเน็ตมือถือเลขเปลี่ยนเอง วันที่เลขเปลี่ยนจะเปิดหน้าเงินเดือนไม่ได้จนกว่าจะมาแก้ที่นี่
                </>,
              ],
              ["ตั้งผิด", "แก้หรือลบได้ที่หน้านี้เสมอ หน้านี้ไม่ถูกจำกัดด้วย IP"],
            ]}
          />
          {myIpBlocked && (
            <p role="alert" className="mt-2 rounded-(--radius) border border-(--tone-warn) p-2 text-xs text-(--ink)">
              ⚠ IP ของคุณตอนนี้ไม่อยู่ในรายการ — คุณเปิดหน้าจัดการเงินเดือนจากที่นี่ไม่ได้
            </p>
          )}
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
