"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { hiddenRecently, subscribeRealtime, type RealtimeEventMessage } from "@/lib/realtime-client";
import { pushSupport, serverPushConfigured, showLocalNotification } from "@/lib/push-client";
import { useMaintenanceNotifStore } from "@/modules/notifications/use-maintenance-notifications";
import { getChatPrefs, playChatSound, unlockChatAudio } from "@/modules/chat/lib/prefs";

/**
 * เสียง + เด้งแจ้งเตือนของ "ทุกโมดูล" (งาน, รายงาน, งานซ่อม, HR, แจ้งบัค) — วางครั้งเดียวที่ Shell
 * รับเหตุการณ์ { type: "notify.new" } จากท่อสด (lib/notify-push.ts ฝั่งเซิร์ฟเวอร์)
 *
 *  - ดูหน้าเว็บอยู่ → เสียงตามที่ตั้งไว้ + กล่องเด้งพร้อมปุ่ม "เปิด" + รีเฟรชกระดิ่งทันที
 *  - ย่อ/สลับแอป → ปกติเซิร์ฟเวอร์ส่ง Web Push (เสียงของเครื่อง) ให้แล้ว หน้าเว็บเด้งเองเฉพาะ
 *    ตอนเซิร์ฟเวอร์ยังไม่ได้ตั้ง Web Push หรือเพิ่งย่อไป (tag เดียวกัน มาทั้งคู่ก็ทับเป็นอันเดียว)
 *
 * เสียง/เปิดปิดกล่องเด้ง ใช้ค่าเดียวกับหน้าตั้งค่าแชท (modules/chat/lib/prefs.ts) — ตั้งที่เดียวใช้ทั้งระบบ
 * แชทมีตัวเด้งของตัวเอง (chat-nav-badge.tsx) เซิร์ฟเวอร์จึงไม่ส่ง notify.new ของแชทมาซ้ำ
 */
export function SystemNotify() {
  const router = useRouter();

  useEffect(() => {
    document.addEventListener("pointerdown", unlockChatAudio, { once: true });
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const off = subscribeRealtime((raw: RealtimeEventMessage) => {
      if (raw.type !== "notify.new") return;
      const title = typeof raw.title === "string" ? raw.title : "SmartBoss";
      const body = typeof raw.body === "string" ? raw.body : "";
      const url = typeof raw.url === "string" && raw.url.startsWith("/") ? raw.url : "/notifications";

      // กระดิ่งดึงใหม่ทันที (รวบหลายอันที่มาติดกันเป็นครั้งเดียว)
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void useMaintenanceNotifStore.getState().refresh(), 400);

      if (document.visibilityState !== "visible") {
        if (pushSupport() !== "granted") return;
        const recent = hiddenRecently(10_000);
        void serverPushConfigured().then((configured) => {
          if (!configured || recent) void showLocalNotification(title, { body, url });
        });
        return;
      }

      playChatSound();
      if (!getChatPrefs().toast) return;
      toast(title, {
        description: body || undefined,
        duration: 6000,
        action: { label: "เปิด", onClick: () => router.push(url) },
      });
    });

    return () => {
      off();
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener("pointerdown", unlockChatAudio);
    };
  }, [router]);

  return null;
}
