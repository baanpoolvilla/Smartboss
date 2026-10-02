import { notFound } from "next/navigation";
import { requireAuth } from "@smartboss/auth";
import { SALES_MARKETING_APPS, appKey } from "@/lib/external-apps";
import { EmbeddedApp } from "./embedded-app";

/**
 * เปิดเว็บของทีมขาย/การตลาด "ข้างใน" SmartBoss (iframe ใต้แถบบนของ SmartBoss) แทนแท็บใหม่ —
 * เดิมเปิดแท็บใหม่ แล้วในแอปที่ติดตั้ง (ไม่มีแถบแท็บ/ปุ่มย้อนกลับ) กลับมาหน้าเดิมไม่ได้
 *
 * แอปที่มี SSO โหลดผ่าน /sales-marketing/open/<key> (เซ็น token แล้วพาเข้าแอปให้เลย)
 * แอปปลายทางต้องยอมให้ฝัง (CSP frame-ancestors มี app.smartboss.in.th) — ถ้าไม่ยอม/ล็อกอินใน
 * กรอบไม่ได้ ยังมีปุ่ม "เปิดในแท็บใหม่" ในแถบเครื่องมือ
 */
export default async function EmbeddedAppPage({ params }: { params: Promise<{ key: string }> }) {
  await requireAuth();
  const { key } = await params;
  const app = SALES_MARKETING_APPS.find((a) => appKey(a) === key);
  if (!app) notFound();

  const src = app.sso ? `/sales-marketing/open/${app.sso.key}` : app.url;
  return <EmbeddedApp name={app.name} host={new URL(app.url).host} src={src} />;
}
