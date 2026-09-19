"use client";

import { useMemo } from "react";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canManage } from "@/modules/report_task/lib/directory";
import { useMaintenanceNotifStore } from "@/modules/notifications/use-maintenance-notifications";
import { isRoomPost, reportCategoryFor, maintenanceCategoryFor, maintenanceHrefFor } from "@/modules/notifications/derive";
import type { NotifCategory, UnifiedNotification } from "@/modules/notifications/types";

/** "มีคนทำอะไรบางอย่างที่พาดพิงถึงฉันโดยตรง เมื่อกี้นี้" (แท็ก/มอบหมายงาน/
 * ตอบกลับ/ตั๋วปัญหา/นัดประชุม/ใบงานที่มอบหมายให้) เทียบกับแจ้งเตือนแบบ
 * "เตือนตามกำหนดเวลา" ที่ระบบสร้างเป็นชุดใหญ่ล่วงหน้า (แผนบำรุงรักษา,
 * ค่าใช้จ่าย, ใบสั่งซื้อ, เตือนส่งรายงาน) — PM เดียวสร้างเตือนล่วงหน้าได้
 * หลายรอบ (7 วัน/5 วัน/1 วันก่อนถึงกำหนด ฯลฯ) ต่อหนึ่งงาน คูณด้วยจำนวนงาน PM
 * ทั้งบริษัท ยอดรวมจึงมากกว่าจำนวนครั้งที่มีคนแท็ก/มอบหมายงานให้จริงๆ เป็นสิบ
 * เท่าได้ง่ายๆ — เรียงแค่ unread-first + ใหม่→เก่า อย่างเดียวเลยทำให้ของจริง
 * ที่ควรรีบเห็น (เพิ่งมีคนมอบหมายงานให้) จมหายไปในกองเตือน PM ที่ backfill
 * มาทีเดียวหลายสิบอัน แม้จะเพิ่งเกิดใหม่กว่าก็ตาม ("กระดิ่งไม่ขึ้น...เปิดใน
 * งาน/Kanban ถึงเห็น") จัดลำดับกลุ่มนี้ไว้ก่อนเสมอ ไม่ว่าฝั่งเตือนตามกำหนดจะมี
 * เยอะแค่ไหนหรือใหม่กว่าแค่ไหน */
const PERSONAL_CATEGORIES = new Set<NotifCategory>([
  "mention",
  "reply",
  "reaction",
  "task",
  "task_rejected",
  "ticket",
  "meeting",
  "work_order",
  "hr_leave",
  "hr_attendance",
]);
function isPersonal(n: UnifiedNotification): boolean {
  return PERSONAL_CATEGORIES.has(n.category);
}

export interface UseUnifiedNotificationsOptions {
  /** รวมแจ้งเตือน "โพสต์ใหม่ในห้อง" (room_post) ด้วยไหม — โหมด "ทั้งหมด" ที่
   * owner/หัวหน้าแผนกสลับเปิดเองได้ (ดู notification-bell-popover.tsx),
   * ค่าเริ่มต้น false (เฉพาะแจ้งเตือนของตัวเอง — ทุกคนรวมถึง owner/หัวหน้า
   * ตอนยังไม่ได้สลับโหมด) เช็คซ้ำด้วย canManage ในนี้อีกชั้น — ต่อให้ผู้เรียก
   * ส่ง true มาผิดๆ พนักงานทั่วไปก็ยังไม่มีทางเห็น room_post หลุดออกไป
   * (ขอบเขตจริงว่าเห็น "ทั้งหมด" แค่ไหน — แค่แผนกตัวเองหรือทั้งบริษัท — ถูก
   * กำหนดไว้แล้วตั้งแต่ตอนสร้าง notification เอง ไม่ใช่ตรงนี้: report-feed-
   * store.ts's addPost ส่ง room_post ให้ owner ทุกโพสต์ทุกห้อง แต่ส่งให้
   * หัวหน้าแผนกเฉพาะห้องที่แผนกตัวเองเห็นเท่านั้น). */
  includeRoomPosts?: boolean;
}

/** รวมแจ้งเตือน 2 แหล่ง (report_task client store + maintenance ผ่าน
 * /api/notifications/maintenance) เป็นลิสต์เดียว เรียง unread-first แล้ว
 * "เกี่ยวกับฉันโดยตรง" ก่อนแจ้งเตือนตามกำหนดเวลา (ดู isPersonal ด้านล่าง)
 * แล้วค่อยใหม่→เก่า ให้ทั้ง bell popover และหน้าเต็ม /notifications ใช้ตัวเดียวกัน */
export function useUnifiedNotifications(options: UseUnifiedNotificationsOptions = {}) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const includeRoomPosts = !!options.includeRoomPosts && canManage(viewingAsUserId);

  const reportNotifications = useNotificationStore((s) => s.notifications);
  const reportMarkRead = useNotificationStore((s) => s.markRead);
  const reportMarkAllRead = useNotificationStore((s) => s.markAllRead);

  const maintenanceItems = useMaintenanceNotifStore((s) => s.items);
  const maintenanceLoaded = useMaintenanceNotifStore((s) => s.loaded);
  const maintenanceRefresh = useMaintenanceNotifStore((s) => s.refresh);
  const maintenanceMarkRead = useMaintenanceNotifStore((s) => s.markRead);
  const maintenanceMarkAllRead = useMaintenanceNotifStore((s) => s.markAllRead);

  const items = useMemo<UnifiedNotification[]>(() => {
    const fromReport: UnifiedNotification[] = reportNotifications
      .filter((n) => n.userId === viewingAsUserId && (includeRoomPosts || !isRoomPost(n)))
      .map((n) => ({
        id: `rt:${n.id}`,
        module: "report" as const,
        category: reportCategoryFor(n),
        message: n.message,
        byUserId: n.byUserId,
        roomName: n.topicName,
        createdAt: n.createdAt,
        read: n.read,
        link: n.link ?? null,
      }));

    const fromMaintenance: UnifiedNotification[] = maintenanceItems.map((n) => ({
      id: `mt:${n.id}`,
      module: "maintenance" as const,
      category: maintenanceCategoryFor(n.type),
      message: n.title,
      body: n.body,
      createdAt: n.createdAt,
      read: n.readAt !== null,
      link: maintenanceHrefFor(n.type, n.referenceId),
    }));

    // unread-first, then "about me directly" ahead of scheduled/bulk
    // reminders (see isPersonal's own doc comment), then newest→oldest
    // within each bucket
    return [...fromReport, ...fromMaintenance].sort(
      (a, b) =>
        Number(a.read) - Number(b.read) ||
        Number(isPersonal(b)) - Number(isPersonal(a)) ||
        b.createdAt.localeCompare(a.createdAt)
    );
  }, [reportNotifications, maintenanceItems, viewingAsUserId, includeRoomPosts]);

  const unreadCount = items.filter((n) => !n.read).length;

  function markRead(id: string) {
    if (id.startsWith("rt:")) reportMarkRead(id.slice(3));
    else if (id.startsWith("mt:")) void maintenanceMarkRead(id.slice(3));
  }

  function markAllRead() {
    reportMarkAllRead(viewingAsUserId);
    void maintenanceMarkAllRead();
  }

  return {
    items,
    unreadCount,
    /** ยังไม่โหลดแจ้งเตือนซ่อมบำรุงรอบแรก — เรียก refresh() ตอน mount/เปิด dropdown */
    maintenanceLoaded,
    markRead,
    markAllRead,
    refresh: maintenanceRefresh,
  };
}
