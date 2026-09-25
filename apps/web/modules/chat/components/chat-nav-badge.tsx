"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { hiddenRecently, subscribeRealtime, type RealtimeEventMessage } from "@/lib/realtime-client";
import { pushSupport, serverPushConfigured, showLocalNotification } from "@/lib/push-client";
import { useChatStore } from "../store/chat-store";
import { fetchUnread } from "../lib/api";
import { getChatPrefs, playChatSound, unlockChatAudio } from "../lib/prefs";
import { attachmentLabel } from "../lib/format";
import type { ChatRealtimeEvent } from "../types";

/*
 * ตัวเลขบนเมนู "แชท" + เด้งแจ้งเตือนในเว็บตอนอยู่หน้าอื่น
 *
 * เมนูนี้ถูกวาดได้มากกว่าหนึ่งที่พร้อมกัน (แถบข้างคอม + เมนูมือถือ) — สถานะจึงเก็บเป็น
 * ของกลางระดับโมดูล ฟังท่อสดครั้งเดียว และเด้งแจ้งเตือนแค่ครั้งเดียวต่อข้อความ
 */

const CHAT_PATH = "/report-task/chat";

const state = { unread: 0, meId: "", muted: new Set<string>(), mounted: 0 };
const listeners = new Set<(n: number) => void>();
let unsubscribe: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let currentPath = "";
let navigate: ((url: string) => void) | null = null;
const notified = new Set<string>();

function setUnread(n: number) {
  state.unread = n;
  for (const l of listeners) l(n);
}

async function refresh() {
  try {
    const r = await fetchUnread();
    state.meId = r.userId;
    state.muted = new Set(r.mutedIds);
    setUnread(r.unread);
  } catch {
    // ไม่มีสิทธิ์แชท/เน็ตหลุด — ไม่แสดงตัวเลข
  }
}

/** หน่วงแบบสุ่ม — ห้องใหญ่มีคนเปิดเว็บพร้อมกันเป็นร้อย ไม่ให้ทุกเครื่องยิงถามเซิร์ฟเวอร์ในวินาทีเดียวกัน */
function jitter(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

function refreshSoon(ms = 800) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, ms);
}

/** เสียงตามที่ผู้ใช้ตั้งไว้ในหน้าตั้งค่าแชท (lib/prefs.ts) */
function ding() {
  playChatSound();
}

function onEvent(raw: RealtimeEventMessage) {
  if (raw.type === "realtime.reconnected") {
    refreshSoon(0);
    return;
  }
  if (!raw.type.startsWith("chat.")) return;
  const event = raw as unknown as ChatRealtimeEvent;
  // เราอ่านจากแท็บ/เครื่องอื่น หรือห้องของเราเปลี่ยน → ดึงตัวเลขใหม่ (เหตุการณ์พวกนี้ส่งถึงเราคนเดียว)
  if ((event.type === "chat.read" && event.userId === state.meId) || event.type === "chat.channel") {
    refreshSoon();
    return;
  }
  if (event.type === "chat.message.deleted") {
    refreshSoon(jitter(2000, 8000));
    return;
  }
  if (event.type !== "chat.message") return;
  const { message } = event;
  if (message.authorId === state.meId || message.kind !== "text") return;

  const onChatPage = currentPath.startsWith(CHAT_PATH);
  const viewingRoom = onChatPage && useChatStore.getState().activeChannelId === event.channelId && document.visibilityState === "visible";
  // นับเพิ่มเองในเครื่อง ไม่ถามเซิร์ฟเวอร์ทุกข้อความ (ภาระจะเท่ากับคนออนไลน์ คูณ จำนวนข้อความ)
  const mentionedHere = message.mentions.includes(state.meId) || message.mentions.includes("all");
  if (!viewingRoom && (!state.muted.has(event.channelId) || mentionedHere)) setUnread(state.unread + 1);

  // ─── เด้งแจ้งเตือน ───
  if (viewingRoom || notified.has(message.id)) return;
  notified.add(message.id);
  if (notified.size > 200) notified.clear();
  const mentioned = message.mentions.includes(state.meId) || message.mentions.includes("all");
  if (state.muted.has(event.channelId) && !mentioned) return;
  // ห้องรวมทั้งบริษัท (คนเป็นพัน) — เด้งเฉพาะเมื่อถูกแท็ก
  if (event.channelType === "org" && !mentioned) return;

  const who = event.authorName ?? "ข้อความใหม่";
  const preview = message.body?.slice(0, 120) || attachmentLabel(message.attachments[0]?.kind ?? null);
  const title = event.channelType === "dm" || !event.channelName ? who : `${event.channelName}`;
  const body = event.channelType === "dm" || !event.channelName ? preview : `${who}: ${preview}`;
  const url = `${CHAT_PATH}?c=${encodeURIComponent(event.channelId)}`;

  if (document.visibilityState !== "visible") {
    // ย่อเบราว์เซอร์/สลับแอปอยู่ — ปกติเซิร์ฟเวอร์ส่งแจ้งเตือนเด้ง (มีเสียงของเครื่อง) ให้แล้ว
    // หน้าเว็บเด้งเองเฉพาะตอนเซิร์ฟเวอร์ยังไม่ได้ตั้ง Web Push หรือเพิ่งย่อไป (เซิร์ฟเวอร์อาจยังไม่รู้)
    // ใช้ tag เดียวกับของเซิร์ฟเวอร์ ถ้ามาทั้งคู่จะทับกันเป็นอันเดียว ไม่ซ้อน
    if (pushSupport() !== "granted") return;
    const recent = hiddenRecently(10_000);
    void serverPushConfigured().then((configured) => {
      if (!configured || recent) void showLocalNotification(mentioned ? `${who} แท็กคุณ` : title, { body, url, tag: `chat-${event.channelId}` });
    });
    return;
  }
  if (onChatPage) {
    // อยู่หน้าแชทแต่คนละห้อง — มีเสียงเตือนเหมือน LINE (ไม่ต้องเด้งกล่อง รายการห้องขึ้นตัวเลขให้เห็นเอง)
    ding();
    return;
  }
  ding();
  if (!getChatPrefs().toast) return;
  toast(mentioned ? `${who} แท็กคุณ` : title, {
    description: body,
    duration: 5000,
    action: { label: "เปิด", onClick: () => navigate?.(url) },
  });
}

/** ตัวเลขยังไม่อ่านของแชท (ติดตามแบบสด) */
export function useChatUnread(): number {
  const [n, setN] = useState(state.unread);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    currentPath = pathname ?? "";
  }, [pathname]);

  useEffect(() => {
    navigate = (url) => router.push(url);
    listeners.add(setN);
    state.mounted++;
    if (state.mounted === 1) {
      void refresh();
      unsubscribe = subscribeRealtime(onEvent);
      // เทียบกับเซิร์ฟเวอร์เป็นระยะ กันตัวเลขเพี้ยนสะสม
      reconcileTimer = setInterval(() => refreshSoon(jitter(0, 30_000)), 3 * 60_000);
      // เบราว์เซอร์ให้เล่นเสียงได้หลังผู้ใช้แตะหน้าเว็บครั้งแรกเท่านั้น — ปลดล็อกไว้ตอนนั้น
      document.addEventListener("pointerdown", unlockChatAudio, { once: true });
    }
    return () => {
      listeners.delete(setN);
      state.mounted--;
      if (state.mounted === 0) {
        unsubscribe?.();
        unsubscribe = null;
        if (reconcileTimer) clearInterval(reconcileTimer);
        reconcileTimer = null;
      }
    };
  }, [router]);

  return n;
}

export function ChatNavBadge() {
  const n = useChatUnread();
  if (n <= 0) return null;
  return (
    <span
      className="ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white"
      aria-label={`ข้อความแชทยังไม่อ่าน ${n} ข้อความ`}
      title={`ข้อความแชทยังไม่อ่าน ${n} ข้อความ`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
