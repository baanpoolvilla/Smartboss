import { describeDevice, isMobileDevice, requireAuth } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { LauncherPage } from "@/components/shell/launcher-page";
import { SectionCard } from "@/modules/admin/components/ui";
import { loadSecuritySettings, twoFactorRequiredFor } from "@/lib/security-settings";
import { AccountTabs } from "../account-tabs";
import { DeviceList, type DeviceRow } from "./device-list";
import { TwoFactorPanel } from "./two-factor-panel";

/**
 * บัญชีของฉัน › ความปลอดภัย — ทุกคนที่ล็อกอินได้เข้าได้
 * ยืนยันตัวตน 2 ชั้น · อุปกรณ์ที่เข้าสู่ระบบอยู่ · สรุปว่าบริษัทตั้งกฎอะไรไว้กับบัญชีนี้บ้าง
 */
export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(d);

export default async function AccountSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; recovery?: string }>;
}) {
  const session = await requireAuth();
  const { setup, recovery } = await searchParams;

  const [user, tokens, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { totpEnabledAt: true, totpRecoveryHashes: true, lineUserId: true },
    }),
    prisma.refreshToken.findMany({
      where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, deviceInfo: true, ip: true, createdAt: true },
    }),
    loadSecuritySettings(session.orgId ?? null),
  ]);

  const enabled = !!user.totpEnabledAt;
  const required = twoFactorRequiredFor(settings, session.roles);
  const devices: DeviceRow[] = tokens.map((t) => ({
    id: t.id,
    label: describeDevice(t.deviceInfo),
    mobile: isMobileDevice(t.deviceInfo),
    lastActiveText: fmt(t.createdAt),
    ip: t.ip && t.ip !== "unknown" ? t.ip : null,
  }));
  const recoveryLeft = Number(recovery);

  return (
    <LauncherPage title="บัญชีของฉัน" width="max-w-none">
      <AccountTabs active="/account/security" />

      {required && !enabled && (
        <div role="alert" className="mb-4 rounded-(--radius) border border-(--tone-warn) p-3 sm:p-4">
          <p className="text-sm font-semibold text-(--ink)">ต้องเปิดยืนยันตัวตน 2 ชั้นก่อนใช้งานต่อ</p>
          <p className="mt-1 text-sm text-(--ink-soft)">
            บริษัทกำหนดให้บทบาทของคุณต้องเปิด เพราะเข้าถึงข้อมูลสำคัญได้ — ใช้เวลาประมาณ 2 นาที
            ตั้งเสร็จแล้วเมนูอื่นจะกลับมาใช้ได้ทันที {setup === "required" ? "(ระบบพามาหน้านี้เพราะยังไม่ได้ตั้ง)" : ""}
          </p>
        </div>
      )}

      {recovery !== undefined && Number.isFinite(recoveryLeft) && (
        <div role="status" className="mb-4 rounded-(--radius) border border-(--tone-warn) p-3 sm:p-4">
          <p className="text-sm font-semibold text-(--ink)">คุณเพิ่งเข้าสู่ระบบด้วยรหัสสำรอง</p>
          <p className="mt-1 text-sm text-(--ink-soft)">
            รหัสนั้นใช้ซ้ำไม่ได้แล้ว เหลืออีก {recoveryLeft} รหัส — ถ้ามือถือหายหรือเปลี่ยนเครื่อง ให้ปิด 2 ชั้นแล้วตั้งใหม่กับมือถือเครื่องใหม่
            หรือออกรหัสสำรองชุดใหม่ด้านล่าง
          </p>
        </div>
      )}

      <SectionCard
        title="ยืนยันตัวตน 2 ชั้น (2FA)"
        description="นอกจากรหัสผ่าน ต้องมีรหัส 6 หลักจากแอปในมือถือของคุณด้วย — รหัสผ่านหลุดอย่างเดียวเข้าบัญชีไม่ได้"
      >
        <TwoFactorPanel
          enabled={enabled}
          enabledAtText={user.totpEnabledAt ? fmt(user.totpEnabledAt) : null}
          recoveryLeft={user.totpRecoveryHashes.length}
          required={required}
        />
      </SectionCard>

      <SectionCard
        title="อุปกรณ์ที่เข้าสู่ระบบอยู่"
        description="ทุกเครื่องที่ยังเปิดบัญชีนี้ค้างไว้ — ไม่ได้ใช้เกิน 7 วันจะหลุดเอง"
        className="mt-4"
      >
        <DeviceList devices={devices} />
      </SectionCard>

      <SectionCard title="ระบบดูแลบัญชีนี้อย่างไร" className="mt-4">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-(--ink)">
          <li>
            กรอกรหัสผ่านผิด {settings.maxFailedLogins} ครั้ง บัญชีถูกล็อก {settings.lockMinutes} นาที
            (ผู้ดูแลของบริษัทปลดให้ก่อนได้)
          </li>
          <li>เปลี่ยนรหัสผ่าน / เปิด-ปิด 2 ชั้น ระบบแจ้งเตือนคุณทุกครั้ง — ถ้าไม่ได้ทำเองจะรู้ทันที</li>
          <li>
            {settings.idleLogoutMinutes > 0
              ? `ไม่ได้ใช้งานเกิน ${settings.idleLogoutMinutes} นาที ระบบออกจากระบบให้เอง (เตือนก่อน 1 นาที) — บริษัทของคุณตั้งไว้`
              : "บริษัทของคุณไม่ได้ตั้งให้ออกจากระบบเองเมื่อไม่ใช้งาน — ใช้เครื่องร่วมกับคนอื่นให้กดออกจากระบบทุกครั้ง"}
          </li>
          <li>
            {settings.notifyNewDevice
              ? "มีการเข้าสู่ระบบจากอุปกรณ์ที่ไม่เคยใช้ ระบบแจ้งเตือนคุณ"
              : "การเข้าสู่ระบบจากอุปกรณ์ใหม่ถูกบันทึกไว้ในประวัติ (บริษัทยังไม่ได้เปิดให้แจ้งเตือน)"}
          </li>
          {user.lineUserId && <li>บัญชีนี้ผูกกับ LINE — เข้าผ่านแอป LINE ได้โดยไม่ต้องพิมพ์รหัสผ่าน</li>}
        </ul>
      </SectionCard>
    </LauncherPage>
  );
}
