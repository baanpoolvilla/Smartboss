import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@smartboss/auth";
import { EXTERNAL_APP_GROUPS, SALES_MARKETING_APPS, appKey } from "@/lib/external-apps";
import { ssoTarget } from "@/lib/external-apps-sso";
import { EmbeddedApp } from "./embedded-app";

export const dynamic = "force-dynamic";

/**
 * เปิดเว็บของทีมขาย/การตลาด "ข้างใน" SmartBoss (iframe ใต้แถบบนของ SmartBoss) แทนแท็บใหม่ —
 * เดิมเปิดแท็บใหม่ แล้วในแอปที่ติดตั้ง (ไม่มีแถบแท็บ/ปุ่มย้อนกลับ) กลับมาหน้าเดิมไม่ได้
 *
 * กรอบโหลดลิงก์ล็อกอินของแอปปลายทางตรง ๆ (เซ็น token ที่นี่ทุกครั้งที่เปิดหน้า) — ห้ามให้กรอบโหลด
 * หน้าไหนของ SmartBoss เอง เพราะทุกหน้าตั้ง X-Frame-Options: DENY (proxy.ts) ถ้า session หมดอายุ
 * แล้วเด้งไปหน้า login ในกรอบจะขึ้น "ปฏิเสธการเชื่อมต่อ"
 */
export default async function EmbeddedAppPage({ params }: { params: Promise<{ key: string }> }) {
  await requireAuth();
  const { key } = await params;
  const app = SALES_MARKETING_APPS.find((a) => appKey(a) === key);
  if (!app) notFound();

  const target = await ssoTarget(app, { embed: true });
  if (target.kind === "login") redirect(`/login?next=${encodeURIComponent(`/sales-marketing/app/${key}`)}`);

  return (
    <EmbeddedApp
      // ลิงก์ใหม่ (token ใหม่) = ประกอบหน้าใหม่ทั้งอัน สถานะโหลด/หมดอายุเริ่มใหม่เอง
      key={target.issuedAt}
      name={app.name}
      backHref={app.group === "home" ? "/" : `/sales-marketing/${app.group}`}
      backLabel={app.group === "home" ? "หน้าแรก" : EXTERNAL_APP_GROUPS[app.group].title}
      host={new URL(app.url).host}
      src={target.url}
      issuedAt={target.issuedAt}
      newTabHref={app.sso ? `/sales-marketing/open/${app.sso.key}` : app.url}
    />
  );
}
