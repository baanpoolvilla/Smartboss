"use client";

import { useCallback, useMemo } from "react";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canManage } from "@/modules/report_task/lib/directory";
import { useMaintenanceNotifStore } from "@/modules/notifications/use-maintenance-notifications";
import { isRoomPost, reportCategoryFor, maintenanceCategoryFor, maintenanceHrefFor, moduleForCategory } from "@/modules/notifications/derive";
import type { UnifiedNotification } from "@/modules/notifications/types";

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
  /** "วันนี้ทั้งบริษัทมีอะไรเกิดขึ้นบ้าง" (PM/ใบงานช่าง/HR ของทุกคน) — server
   * เช็คซ้ำว่าเรียกคนนี้เป็นเจ้าของบริษัทจริงไหมเสมอ (ดู route ของ
   * /api/notifications/maintenance) ส่ง true มาแล้วไม่ใช่เจ้าของก็แค่ได้
   * ลิสต์ว่างกลับมาเฉย ๆ ไม่ error รายการที่ได้มาเป็น "ของคนอื่น" ล้วน ๆ —
   * อ่านอย่างเดียว, ไม่นับใน unreadCount, กด markRead ไม่ได้ (ดู
   * UnifiedNotification.scope's doc) */
  includeOrgActivity?: boolean;
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
  const orgItems = useMaintenanceNotifStore((s) => s.orgItems);
  const maintenanceLoaded = useMaintenanceNotifStore((s) => s.loaded);
  const maintenanceRefreshRaw = useMaintenanceNotifStore((s) => s.refresh);
  const maintenanceMarkRead = useMaintenanceNotifStore((s) => s.markRead);
  const maintenanceMarkAllRead = useMaintenanceNotifStore((s) => s.markAllRead);
  const includeOrgActivity = !!options.includeOrgActivity;
  // ต้องคงหน้าตาฟังก์ชันไว้ (useCallback) ไม่งั้นได้ reference ใหม่ทุก render
  // — ผู้เรียก (notification-bell-popover.tsx) มี useEffect ที่มี refresh
  // เป็น dependency ตัวหนึ่ง ถ้า reference เปลี่ยนทุกครั้ง effect จะยิงซ้ำทุก
  // render, ยิงซ้ำแล้ว set() ก็ทำให้ re-render อีก วนไม่จบจนกว่าจะเบรกเอง
  // ("กดทั้งบริษัทแล้วมันเด้งแบบรัวๆแล้วค่อยมาอันสุดท้าย")
  const maintenanceRefresh = useCallback(
    () => maintenanceRefreshRaw({ includeOrgActivity }),
    [maintenanceRefreshRaw, includeOrgActivity]
  );

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

    const fromMaintenance: UnifiedNotification[] = maintenanceItems.map((n) => {
      const category = maintenanceCategoryFor(n.type);
      return {
        id: `mt:${n.id}`,
        module: moduleForCategory(category),
        category,
        message: n.title,
        body: n.body,
        createdAt: n.createdAt,
        read: n.readAt !== null,
        link: maintenanceHrefFor(n.type, n.referenceId),
      };
    });

    // "mtorg:" prefix (not "mt:") so markRead below can never mistake one of
    // these for the viewer's own — read: true always, since these are other
    // people's notifications, not a real unread count for the viewer.
    const fromOrgActivity: UnifiedNotification[] = includeOrgActivity
      ? orgItems.map((n) => {
          const category = maintenanceCategoryFor(n.type);
          return {
            id: `mtorg:${n.id}`,
            module: moduleForCategory(category),
            category,
            message: n.title,
            body: n.body,
            createdAt: n.createdAt,
            read: true,
            link: maintenanceHrefFor(n.type, n.referenceId),
            scope: "org" as const,
          };
        })
      : [];

    // unread-first, then purely newest→oldest by actual event time — no
    // per-module/category grouping. ยืนยันจากเจ้าของระบบตรง ๆ ("ไม่เอาแบบแจ้ง
    // เตือนโมดูลนี้อยู่บน แล้วต่อด้วยอีกโมดูล เอารวมกันเลย ไล่ตามระดับเวลา")
    // — เคยมี isPersonal ดันหมวด "เกี่ยวกับฉันโดยตรง" ให้อยู่เหนือแจ้งเตือน
    // ตามกำหนดเวลาเสมอไม่ว่าจะเก่าแค่ไหน (กันไม่ให้ PM ที่ backfill มาทีเดียว
    // หลายสิบอันฝังของใหม่จริง) แต่พอ notifyDuePmSchedules มีเกณฑ์วันกันสแปม
    // แล้ว (shouldNotifyPmToday ฝั่ง cron.ts) ปริมาณ PM ต่อวันจะน้อยลงมากจนไม่
    // จำเป็นต้องกันแบบนี้อีก — org-activity อ่านแล้วเสมอจึงยังจมท้ายสุดตาม
    // ธรรมชาติของการเรียงเวลาอยู่ดี ไม่ต้องมีเงื่อนไขพิเศษแยก
    return [...fromReport, ...fromMaintenance, ...fromOrgActivity].sort(
      (a, b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt)
    );
  }, [reportNotifications, maintenanceItems, orgItems, viewingAsUserId, includeRoomPosts, includeOrgActivity]);

  const unreadCount = items.filter((n) => !n.read).length;

  function markRead(id: string) {
    // "mtorg:" (org-activity, someone else's notification) is deliberately
    // not handled here at all — see UnifiedNotification.scope's doc comment
    // on why marking it read would be wrong. Falls through as a no-op.
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
