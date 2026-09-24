"use client";

import { useEffect, useState } from "react";
import { BellRing, Download, X } from "lucide-react";
import { toast } from "sonner";

import { enablePush, onInstallAvailable, promptInstall, pushSupport, refreshPushSubscription, type PushSupport } from "@/lib/push-client";

const DISMISS_KEY = "chat-push-banner-dismissed";

/**
 * แถบชวนเปิดแจ้งเตือนเด้ง (Web Push) บนหัวรายการแชท — ขึ้นเฉพาะตอนที่ยังไม่ได้เปิด
 * และผู้ใช้ยังไม่ได้กดซ่อน iPhone ที่ยังไม่ได้ "เพิ่มลงหน้าจอหลัก" จะเห็นวิธีทำแทนปุ่ม
 */
export function PushBanner() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [canInstall, setCanInstall] = useState(false);

  // Android/Chrome: ติดตั้ง SmartBoss ลงเครื่องได้ → เปิดจากไอคอนเต็มจอเหมือนแอป
  useEffect(() => onInstallAvailable(setCanInstall), []);

  useEffect(() => {
    // อ่านสถานะจาก API ของเบราว์เซอร์ได้หลังโหลดหน้าเท่านั้น (ฝั่งเซิร์ฟเวอร์ไม่มี) — ตั้งค่าในนี้ตั้งใจ
    const s = pushSupport();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupport(s);
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    if (s === "granted") void refreshPushSubscription();
  }, []);

  const installRow = canInstall && (
    <div className="mx-3 mb-2 flex items-center gap-3 rounded-xl border border-(--line) px-3 py-2">
      <Download className="h-5 w-5 shrink-0 text-(--chat-accent-strong)" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-(--ink)">
        <b>ติดตั้ง SmartBoss ลงเครื่อง</b>
        <span className="block text-(--ink-soft)">เปิดจากไอคอนได้เลย เต็มจอเหมือนแอป</span>
      </p>
      <button
        type="button"
        onClick={() => void promptInstall()}
        className="shrink-0 rounded-full bg-(--chat-accent) px-3 py-1 text-[12px] font-semibold text-white"
      >
        ติดตั้ง
      </button>
    </div>
  );

  if (!support || dismissed || support === "granted" || support === "unsupported") return installRow || null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // เปิดแบบส่วนตัว — ซ่อนแค่รอบนี้
    }
  };

  return (
    <>
    {installRow}
    <div className="mx-3 mb-2 flex items-start gap-3 rounded-xl bg-(--chat-accent-soft) px-3 py-2.5">
      <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-(--chat-accent-strong)" />
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-(--ink)">
        {support === "ios-needs-install" ? (
          <>
            <b>รับแจ้งเตือนบน iPhone</b>
            <p className="text-(--ink-soft)">กดปุ่มแชร์ของ Safari → “เพิ่มไปยังหน้าจอโฮม” แล้วเปิด SmartBoss จากไอคอนนั้น</p>
          </>
        ) : support === "denied" ? (
          <>
            <b>การแจ้งเตือนถูกปิดอยู่</b>
            <p className="text-(--ink-soft)">เปิดได้ที่ไอคอนแม่กุญแจข้างช่องที่อยู่เว็บ → การแจ้งเตือน → อนุญาต</p>
          </>
        ) : (
          <>
            <b>เปิดแจ้งเตือนข้อความใหม่</b>
            <p className="text-(--ink-soft)">ได้รับข้อความทันทีแม้ปิดหน้าเว็บอยู่</p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await enablePush().catch(() => ({ ok: false, reason: "เปิดแจ้งเตือนไม่สำเร็จ" }));
                setBusy(false);
                setSupport(pushSupport());
                if (r.ok) toast.success("เปิดแจ้งเตือนแล้ว");
                else toast.error(r.reason ?? "เปิดแจ้งเตือนไม่สำเร็จ");
              }}
              className="mt-1.5 rounded-full bg-(--chat-accent) px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-60"
            >
              {busy ? "กำลังเปิด…" : "เปิดแจ้งเตือน"}
            </button>
          </>
        )}
      </div>
      <button type="button" onClick={dismiss} className="rounded-full p-1 text-(--ink-soft) hover:bg-black/5" aria-label="ซ่อน">
        <X className="h-4 w-4" />
      </button>
    </div>
    </>
  );
}
