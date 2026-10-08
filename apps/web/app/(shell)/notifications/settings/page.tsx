import { requireAuth } from "@smartboss/auth";
import { Suspense } from "react";
import { NotificationSettingsClient } from "./settings-client";

/**
 * ตั้งค่าแจ้งเตือนรายคน — เข้าจาก ⚙ ในกระดิ่ง (ทุกหน้า), ⚙ บนหน้า /notifications (แท็บ "แจ้งเตือน"
 * บนมือถือ) และแถว "การแจ้งเตือน" ในหน้าบัญชี · ค่าทั้งหมดอยู่ที่ modules/notifications/prefs.ts
 */
export default async function NotificationSettingsPage() {
  await requireAuth();
  return (
    <Suspense fallback={null}>
      <NotificationSettingsClient />
    </Suspense>
  );
}
