import { requireAuth } from "@smartboss/auth";
import { NotificationsPageClient } from "./notifications-page-client";

/**
 * แจ้งเตือนทั้งหมด (report_task + maintenance) รวมเป็นลิสต์เดียวพร้อมฟิลเตอร์
 * — requireAuth() แค่ gate การเข้าถึงหน้านี้ ข้อมูลจริงดึงฝั่ง client ผ่าน
 * useUnifiedNotifications (report_task server-synced store + maintenance
 * ผ่าน /api/notifications/maintenance ที่ผูก userId จาก session เดียวกันนี้)
 */
export default async function NotificationsPage() {
  await requireAuth();
  return <NotificationsPageClient />;
}
