"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "../store/chat-store";
import { fetchChannels, fetchMessages } from "./api";
import type { ChatMessageDTO } from "../types";

/** ห้อง+unread badge ทุกห้อง (รวมห้องที่ไม่ได้เปิดดูอยู่) */
const CHANNEL_POLL_MS = 20_000;
/** ข้อความใหม่ของห้องที่กำลังเปิดดูอยู่เท่านั้น — ไม่มี websocket จึงต้องโพลถี่กว่า */
const MESSAGE_POLL_MS = 5_000;
/** สลับแท็บ/พักเครื่องนานกว่านี้ = ตอนกลับมาโหลดห้อง active ใหม่ทั้งหน้าแทนการ
 * โพล incremental — deletedIds ฝั่งเซิร์ฟเวอร์จำได้แค่ 5 นาทีล่าสุด (ดู
 * listRecentlyDeletedIds) ถ้าหายไปนานกว่านั้นจะมีข้อความที่ถูกลบไปแล้วค้าง
 * บนจอถาวรเพราะไม่มี deletedIds มาบอกให้เอาออกอีกต่อไป reload ทั้งห้องแก้ปัญหา
 * นี้ตรง ๆ (ได้ทั้งข้อความที่พลาดไปและข้อความที่ถูกลบกลับมาถูกต้องพร้อมกัน) */
const RECONCILE_AFTER_HIDDEN_MS = 2 * 60 * 1000;

/** seq ของข้อความจริงล่าสุด (ข้ามข้อความ optimistic "temp-..." ที่ยังไม่มี seq จริง) */
function lastRealSeq(messages: ChatMessageDTO[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!m.id.startsWith("temp-")) return m.seq;
  }
  return undefined;
}

/**
 * ลูปโพล — ไม่มี websocket ตามที่ตกลง (ดูแผนของฟีเจอร์นี้) แยกสองรอบเพราะคนละ
 * ความถี่ที่เหมาะสม: รายชื่อห้อง/unread แค่ต้องอัปเดตพอให้เห็นว่ามีอะไรใหม่
 * เข้ามา ส่วนห้องที่กำลังคุยอยู่ต้องการความสดกว่านั้นมาก
 */
export function useChatPolling() {
  const setChannels = useChatStore((s) => s.setChannels);
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessages = useChatStore((s) => s.appendMessages);
  const removeMessage = useChatStore((s) => s.removeMessage);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const { channels } = await fetchChannels();
        if (!cancelled) setChannels(channels);
      } catch {
        // เน็ตสะดุดชั่วคราว — โพลรอบหน้าลองใหม่เอง ไม่ต้องแจ้งเตือนทุกครั้งที่พลาด
      }
    }
    tick();
    const id = setInterval(tick, CHANNEL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setChannels]);

  useEffect(() => {
    if (!activeChannelId) return;
    let cancelled = false;

    async function pollIncremental() {
      const existing = useChatStore.getState().messagesByChannel[activeChannelId!] ?? [];
      const after = lastRealSeq(existing);
      try {
        const { messages, deletedIds } = await fetchMessages(activeChannelId!, after);
        if (cancelled) return;
        if (messages.length > 0) appendMessages(activeChannelId!, messages);
        // ข้อความที่คนอื่นเพิ่งลบไป (ส่งผิด) — เอาออกจากจอถ้ายังค้างอยู่ (ดู
        // listRecentlyDeletedIds ฝั่งเซิร์ฟเวอร์ — ตอบกลับทุกรอบโพล ไม่ใช่แค่
        // ตอนมีข้อความใหม่)
        for (const id of deletedIds) removeMessage(activeChannelId!, id);
      } catch {
        // เช่นเดียวกับด้านบน
      }
    }

    async function reconcileFull() {
      try {
        const { messages } = await fetchMessages(activeChannelId!);
        if (!cancelled) setMessages(activeChannelId!, messages);
      } catch {
        // พลาดก็ปล่อยให้โพล incremental รอบถัดไปทำหน้าที่ต่อ
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt && Date.now() - hiddenAt >= RECONCILE_AFTER_HIDDEN_MS) {
        reconcileFull();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    const id = setInterval(pollIncremental, MESSAGE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeChannelId, appendMessages, removeMessage, setMessages]);
}
