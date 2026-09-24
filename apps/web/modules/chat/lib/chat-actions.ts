"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { onRealtimeStatus, subscribeRealtime, type RealtimeEventMessage } from "@/lib/realtime-client";
import { useChatStore, type RoomMessage } from "../store/chat-store";
import type { ChatAttachment, ChatRealtimeEvent } from "../types";
import * as api from "./api";

/*
 * ลอจิกของหน้าแชทรวมไว้ที่นี่ (ไม่ใช่ในคอมโพเนนต์) — คอมโพเนนต์แค่เรียกฟังก์ชันพวกนี้
 * และอ่านสถานะจาก useChatStore
 *
 * การอัปเดตทั้งหมดมาจากท่อสด (/api/realtime) — ไม่มีการโพลถี่ ๆ แล้ว ถ้าท่อสดล่ม
 * ถอยไปดึงทุก 30 วิแทนจนกว่าจะต่อได้อีก แชทช้าลงแต่ไม่ดับ
 */

const get = () => useChatStore.getState();

function debounce(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

/** ผู้ใช้กำลังดูห้องนี้อยู่จริง (ห้องเปิดอยู่ + แท็บอยู่หน้าจอ) */
export function isViewing(channelId: string): boolean {
  return get().activeChannelId === channelId && typeof document !== "undefined" && document.visibilityState === "visible";
}

export async function loadChannels(): Promise<void> {
  try {
    const { channels } = await api.fetchChannels();
    const active = get().activeChannelId;
    // ห้องที่เปิดดูอยู่ถือว่าอ่านแล้ว — กันตัวเลขกระพริบขึ้นมาระหว่างที่การ mark read ยังเดินทางอยู่
    get().setChannels(active && isViewing(active) ? channels.map((c) => (c.id === active ? { ...c, unreadCount: 0, mentionCount: 0 } : c)) : channels);
  } catch {
    // เน็ตสะดุด — รอบหน้าจะลองใหม่เอง
  }
}

const refreshChannelsSoon = debounce(() => void loadChannels(), 400);

export async function loadUsers(): Promise<void> {
  try {
    const { users, onlineIds } = await api.fetchOrgUsers();
    get().setUsers(users, onlineIds);
  } catch {
    // ไม่เป็นไร — ใช้รายชื่อเดิมไปก่อน
  }
}

export async function loadDetail(channelId: string): Promise<void> {
  try {
    const { channel } = await api.fetchChannelDetail(channelId);
    get().setDetail(channelId, channel);
  } catch {
    // ห้องอาจถูกลบ/เราถูกนำออก — รายการห้องจะอัปเดตเอง
  }
}

const readTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** ส่ง "อ่านแล้ว" (หน่วงสั้น ๆ รวบหลายข้อความที่เข้ามาติดกันเป็นครั้งเดียว) */
export function markReadSoon(channelId: string, delay = 300): void {
  get().clearUnread(channelId);
  const prev = readTimers.get(channelId);
  if (prev) clearTimeout(prev);
  readTimers.set(
    channelId,
    setTimeout(() => {
      readTimers.delete(channelId);
      api.markChannelRead(channelId).catch(() => undefined);
    }, delay)
  );
}

export async function openChannel(channelId: string): Promise<void> {
  const s = get();
  s.setActive(channelId);
  markReadSoon(channelId, 0);
  void loadDetail(channelId);
  const room = s.rooms[channelId];
  if (room && !room.detached) {
    // เคยโหลดแล้ว — ดึงเฉพาะที่ใหม่กว่าที่มี (เผื่อพลาดระหว่างไม่ได้เปิด)
    void catchUp(channelId);
    return;
  }
  try {
    const page = await api.fetchMessages(channelId);
    get().setRoom(channelId, page.messages, page.hasMore);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "โหลดข้อความไม่สำเร็จ");
  }
}

function lastRealSeq(items: RoomMessage[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.seq) return items[i]!.seq;
  return undefined;
}

/** ดึงข้อความที่พลาดไป (ต่อท่อสดใหม่/กลับมาเปิดห้อง) — วนจนครบ */
export async function catchUp(channelId: string): Promise<void> {
  for (let round = 0; round < 10; round++) {
    const room = get().rooms[channelId];
    if (!room || room.detached) return;
    const after = lastRealSeq(room.items);
    if (!after) return;
    try {
      const page = await api.fetchMessages(channelId, { after });
      get().mergeMessages(channelId, page.messages);
      if (!page.hasMore) return;
    } catch {
      return;
    }
  }
  // ขาดไปเยอะเกิน — โหลดห้องใหม่ทั้งหน้าแทน
  const page = await api.fetchMessages(channelId).catch(() => null);
  if (page) get().setRoom(channelId, page.messages, page.hasMore);
}

const loadingOlder = new Set<string>();

export async function loadOlder(channelId: string): Promise<void> {
  const room = get().rooms[channelId];
  if (!room?.hasMore || loadingOlder.has(channelId)) return;
  const first = room.items.find((m) => m.seq);
  if (!first) return;
  loadingOlder.add(channelId);
  try {
    const page = await api.fetchMessages(channelId, { before: first.seq });
    get().prependOlder(channelId, page.messages, page.hasMore);
  } catch {
    // ลองใหม่ตอนเลื่อนขึ้นอีกครั้ง
  } finally {
    loadingOlder.delete(channelId);
  }
}

/** กระโดดไปข้อความหนึ่ง (ผลค้นหา/ข้อความที่ถูกตอบ) — ถ้าอยู่บนจออยู่แล้วแค่เลื่อนไปหา */
export async function jumpToMessage(channelId: string, messageId: string): Promise<void> {
  const room = get().rooms[channelId];
  if (!room?.items.some((m) => m.id === messageId)) {
    try {
      const page = await api.fetchMessages(channelId, { around: messageId });
      get().setRoom(channelId, page.messages, page.hasMore, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่พบข้อความนี้");
      return;
    }
  }
  get().setHighlight(channelId, messageId);
  // ไฮไลต์กระพริบครั้งเดียวแล้วหายไป
  const at = get().highlight?.at;
  setTimeout(() => {
    if (get().highlight?.at === at) useChatStore.setState({ highlight: null });
  }, 2500);
}

/** ออกจากโหมด "ดูข้อความเก่า" กลับมาที่ข้อความล่าสุด */
export async function backToLatest(channelId: string): Promise<void> {
  const page = await api.fetchMessages(channelId).catch(() => null);
  if (page) get().setRoom(channelId, page.messages, page.hasMore);
}

// ─── ส่งข้อความ ────────────────────────────────────────────────────────────

export interface OutgoingMessage {
  body?: string;
  attachments?: ChatAttachment[];
  replyTo?: RoomMessage | null;
  mentions?: string[];
}

const outbox = new Map<string, { channelId: string; input: OutgoingMessage }>();

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function deliver(clientId: string): Promise<void> {
  const job = outbox.get(clientId);
  if (!job) return;
  const { channelId, input } = job;
  get().setLocalStatus(channelId, clientId, "sending");
  // ลองซ้ำอัตโนมัติ 3 ครั้งถ้าเน็ตสะดุด — clientId เดิม เซิร์ฟเวอร์จึงไม่บันทึกซ้ำ
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { message } = await api.sendMessage(channelId, {
        body: input.body,
        attachments: input.attachments,
        replyToId: input.replyTo?.id,
        mentions: input.mentions,
        clientId,
      });
      outbox.delete(clientId);
      get().mergeMessages(channelId, [message]);
      get().receiveMessage(message, false);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const retryable = msg === "Failed to fetch" || msg.includes("NetworkError") || msg.startsWith("5") || msg.includes("เร็วเกินไป");
      if (!retryable || attempt === 2) {
        get().setLocalStatus(channelId, clientId, "failed");
        if (!retryable) toast.error(msg || "ส่งข้อความไม่สำเร็จ");
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

export function sendChatMessage(channelId: string, input: OutgoingMessage): void {
  const s = get();
  const clientId = newClientId();
  const replyTo = input.replyTo
    ? {
        id: input.replyTo.id,
        authorId: input.replyTo.authorId,
        body: input.replyTo.body,
        attachmentKind: input.replyTo.attachments[0]?.kind ?? null,
        deleted: input.replyTo.deleted,
      }
    : null;
  s.addLocal(channelId, {
    id: `local-${clientId}`,
    seq: "",
    channelId,
    authorId: s.meId,
    kind: "text",
    body: input.body ?? null,
    attachments: input.attachments ?? [],
    replyTo,
    mentions: input.mentions ?? [],
    reactions: [],
    clientId,
    deleted: false,
    createdAt: new Date().toISOString(),
    status: "sending",
  });
  outbox.set(clientId, { channelId, input });
  void deliver(clientId);
}

export function retrySend(clientId: string): void {
  void deliver(clientId);
}

export function discardFailed(channelId: string, clientId: string): void {
  outbox.delete(clientId);
  get().removeLocal(channelId, clientId);
}

export async function unsendMessage(channelId: string, messageId: string): Promise<void> {
  try {
    await api.deleteMessage(channelId, messageId);
    get().markDeleted(channelId, messageId);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "ยกเลิกข้อความไม่สำเร็จ");
  }
}

export async function reactToMessage(channelId: string, messageId: string, emoji: string): Promise<void> {
  const s = get();
  // แสดงผลทันทีก่อนเซิร์ฟเวอร์ตอบ
  const msg = s.rooms[channelId]?.items.find((m) => m.id === messageId);
  if (msg) {
    const mine = msg.reactions.find((r) => r.emoji === emoji)?.userIds.includes(s.meId);
    const next = mine
      ? msg.reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: r.userIds.filter((u) => u !== s.meId) } : r)).filter((r) => r.userIds.length > 0)
      : msg.reactions.some((r) => r.emoji === emoji)
        ? msg.reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: [...r.userIds, s.meId] } : r))
        : [...msg.reactions, { emoji, userIds: [s.meId] }];
    s.setReactions(channelId, messageId, next);
  }
  try {
    const { reactions } = await api.toggleReaction(channelId, messageId, emoji);
    get().setReactions(channelId, messageId, reactions);
  } catch (err) {
    if (msg) get().setReactions(channelId, messageId, msg.reactions);
    toast.error(err instanceof Error ? err.message : "กดอีโมจิไม่สำเร็จ");
  }
}

let lastTypingSent = 0;
export function notifyTyping(channelId: string): void {
  const now = Date.now();
  if (now - lastTypingSent < 3000) return;
  lastTypingSent = now;
  void api.sendTyping(channelId);
}

// ─── ท่อสด ────────────────────────────────────────────────────────────────

function handleEvent(raw: RealtimeEventMessage) {
  const s = get();
  if (raw.type === "realtime.reconnected") {
    void loadChannels();
    for (const channelId of Object.keys(s.rooms)) void catchUp(channelId);
    if (s.activeChannelId) void loadDetail(s.activeChannelId);
    return;
  }
  if (!raw.type.startsWith("chat.")) return;
  const event = raw as unknown as ChatRealtimeEvent;

  switch (event.type) {
    case "chat.message": {
      const { message } = event;
      const known = s.channels.some((c) => c.id === event.channelId);
      const fromOther = message.authorId !== s.meId;
      const viewing = isViewing(event.channelId);
      s.receiveMessage(message, fromOther && message.kind === "text" && !viewing);
      if (!known) refreshChannelsSoon();
      if (fromOther && viewing) markReadSoon(event.channelId);
      if (message.kind === "system" && s.details[event.channelId]) void loadDetail(event.channelId);
      break;
    }
    case "chat.message.deleted":
      s.markDeleted(event.channelId, event.messageId);
      break;
    case "chat.reaction":
      s.setReactions(event.channelId, event.messageId, event.reactions);
      break;
    case "chat.read":
      s.applyRead(event.channelId, event.userId, event.lastReadSeq);
      break;
    case "chat.typing":
      if (event.userId !== s.meId) s.setTyping(event.channelId, event.userId);
      break;
    case "chat.channel":
      refreshChannelsSoon();
      if (s.details[event.channelId]) void loadDetail(event.channelId);
      break;
  }
}

/** ต่อท่อสด + โหลดข้อมูลตั้งต้นของหน้าแชท — เรียกครั้งเดียวที่ ChatApp */
export function useChatSync(meId: string): void {
  useEffect(() => {
    get().setMe(meId);
    void loadChannels();
    void loadUsers();

    const offEvents = subscribeRealtime(handleEvent);
    // ท่อสดล่ม → ดึงเองทุก 30 วิจนกว่าจะกลับมา
    let fallback: ReturnType<typeof setInterval> | null = null;
    const offStatus = onRealtimeStatus((status) => {
      if (status === "offline" && !fallback) {
        fallback = setInterval(() => {
          void loadChannels();
          const active = get().activeChannelId;
          if (active) void catchUp(active);
        }, 30_000);
      } else if (status === "open" && fallback) {
        clearInterval(fallback);
        fallback = null;
      }
    });
    // จุดเขียว "ออนไลน์" — อัปเดตทุกนาที
    const usersTimer = setInterval(() => void loadUsers(), 60_000);
    // ล้าง "กำลังพิมพ์" ที่หมดอายุ
    const typingTimer = setInterval(() => {
      const now = Date.now();
      for (const [channelId, users] of Object.entries(get().typing)) {
        for (const [userId, until] of Object.entries(users)) if (until < now) get().clearTyping(channelId, userId);
      }
    }, 2000);
    // กลับมาที่แท็บ → ห้องที่เปิดอยู่ถือว่าอ่านแล้ว
    const onVisible = () => {
      const active = get().activeChannelId;
      if (document.visibilityState === "visible" && active) markReadSoon(active);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      offEvents();
      offStatus();
      if (fallback) clearInterval(fallback);
      clearInterval(usersTimer);
      clearInterval(typingTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [meId]);
}
