"use client";

import { create } from "zustand";
import type { ChatChannelDetail, ChatChannelSummary, ChatMessageDTO, ChatReactionDTO, ChatUser } from "../types";

/** ข้อความบนจอ — ข้อความที่เรากำลังส่งมี status (id = "local-<clientId>", seq = "") */
export type RoomMessage = ChatMessageDTO & { status?: "sending" | "failed" };

export interface RoomState {
  items: RoomMessage[];
  /** มีข้อความเก่ากว่านี้ให้เลื่อนขึ้นไปโหลดอีก */
  hasMore: boolean;
  /** โหลดแบบ "รอบ ๆ ข้อความหนึ่ง" (กระโดดจากผลค้นหา) — ยังมีข้อความใหม่กว่าที่ยังไม่ได้โหลด */
  detached: boolean;
}

const LOCAL_SEQ = BigInt(Number.MAX_SAFE_INTEGER);

function seqOf(m: RoomMessage): bigint {
  return m.seq ? BigInt(m.seq) : LOCAL_SEQ;
}

function sortMessages(list: RoomMessage[]): RoomMessage[] {
  return list.sort((a, b) => {
    const av = seqOf(a);
    const bv = seqOf(b);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
}

/** รวมข้อความใหม่เข้ากับของเดิม: ซ้ำ id = แทนที่, clientId ตรงกับข้อความที่กำลังส่ง = แทนที่ตัวชั่วคราว */
function merge(existing: RoomMessage[], incoming: ChatMessageDTO[]): RoomMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (m.clientId) byId.delete(`local-${m.clientId}`);
    byId.set(m.id, m);
  }
  return sortMessages([...byId.values()]);
}

function sortChannels(list: ChatChannelSummary[]): ChatChannelSummary[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.activityAt.localeCompare(a.activityAt);
  });
}

interface ChatState {
  meId: string;
  channels: ChatChannelSummary[];
  channelsLoaded: boolean;
  users: Record<string, ChatUser>;
  onlineIds: Record<string, true>;
  rooms: Record<string, RoomState>;
  details: Record<string, ChatChannelDetail>;
  activeChannelId: string | null;
  /** channelId → userId → หมดอายุ (ms) */
  typing: Record<string, Record<string, number>>;
  /** ข้อความที่ต้องเลื่อนไปหาและไฮไลต์ (กดผลค้นหา/กดข้อความที่ถูกตอบ) */
  highlight: { channelId: string; messageId: string; at: number } | null;

  setMe: (id: string) => void;
  setChannels: (channels: ChatChannelSummary[]) => void;
  setUsers: (users: ChatUser[], onlineIds: string[]) => void;
  setActive: (id: string | null) => void;
  setRoom: (channelId: string, messages: ChatMessageDTO[], hasMore: boolean, detached?: boolean) => void;
  prependOlder: (channelId: string, messages: ChatMessageDTO[], hasMore: boolean) => void;
  mergeMessages: (channelId: string, messages: ChatMessageDTO[]) => void;
  addLocal: (channelId: string, message: RoomMessage) => void;
  setLocalStatus: (channelId: string, clientId: string, status: "sending" | "failed") => void;
  removeLocal: (channelId: string, clientId: string) => void;
  markDeleted: (channelId: string, messageId: string) => void;
  setReactions: (channelId: string, messageId: string, reactions: ChatReactionDTO[]) => void;
  setDetail: (channelId: string, detail: ChatChannelDetail) => void;
  applyRead: (channelId: string, userId: string, seq: string) => void;
  setTyping: (channelId: string, userId: string) => void;
  clearTyping: (channelId: string, userId: string) => void;
  /** ข้อความใหม่เข้ามา — อัปเดตทั้งห้อง (ถ้าโหลดอยู่) และแถวในรายการห้อง */
  receiveMessage: (message: ChatMessageDTO, countAsUnread: boolean) => void;
  clearUnread: (channelId: string) => void;
  setPrefsLocal: (channelId: string, prefs: { pinned?: boolean; muted?: boolean }) => void;
  setHighlight: (channelId: string, messageId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  meId: "",
  channels: [],
  channelsLoaded: false,
  users: {},
  onlineIds: {},
  rooms: {},
  details: {},
  activeChannelId: null,
  typing: {},
  highlight: null,

  setMe: (id) => set({ meId: id }),
  setChannels: (channels) => set({ channels: sortChannels(channels), channelsLoaded: true }),
  setUsers: (users, onlineIds) =>
    set({
      users: Object.fromEntries(users.map((u) => [u.id, u])),
      onlineIds: Object.fromEntries(onlineIds.map((id) => [id, true as const])),
    }),
  setActive: (id) => set({ activeChannelId: id }),

  setRoom: (channelId, messages, hasMore, detached = false) =>
    set((s) => {
      // เก็บข้อความที่กำลังส่ง/ส่งไม่สำเร็จไว้ — โหลดห้องใหม่ต้องไม่ทำให้ข้อความที่พิมพ์ไว้หาย
      const locals = (s.rooms[channelId]?.items ?? []).filter((m) => m.status);
      return { rooms: { ...s.rooms, [channelId]: { items: merge(locals, messages), hasMore, detached } } };
    }),

  prependOlder: (channelId, messages, hasMore) =>
    set((s) => {
      const room = s.rooms[channelId];
      if (!room) return s;
      return { rooms: { ...s.rooms, [channelId]: { ...room, items: merge(room.items, messages), hasMore } } };
    }),

  mergeMessages: (channelId, messages) =>
    set((s) => {
      const room = s.rooms[channelId];
      if (!room) return s;
      return { rooms: { ...s.rooms, [channelId]: { ...room, items: merge(room.items, messages) } } };
    }),

  addLocal: (channelId, message) =>
    set((s) => {
      const room = s.rooms[channelId] ?? { items: [], hasMore: false, detached: false };
      return { rooms: { ...s.rooms, [channelId]: { ...room, items: [...room.items.filter((m) => m.id !== message.id), message] } } };
    }),

  setLocalStatus: (channelId, clientId, status) =>
    set((s) => {
      const room = s.rooms[channelId];
      if (!room) return s;
      const items = room.items.map((m) => (m.id === `local-${clientId}` ? { ...m, status } : m));
      return { rooms: { ...s.rooms, [channelId]: { ...room, items } } };
    }),

  removeLocal: (channelId, clientId) =>
    set((s) => {
      const room = s.rooms[channelId];
      if (!room) return s;
      return { rooms: { ...s.rooms, [channelId]: { ...room, items: room.items.filter((m) => m.id !== `local-${clientId}`) } } };
    }),

  markDeleted: (channelId, messageId) =>
    set((s) => {
      const room = s.rooms[channelId];
      const rooms = room
        ? {
            ...s.rooms,
            [channelId]: {
              ...room,
              items: room.items.map((m) =>
                m.id === messageId ? { ...m, deleted: true, body: null, attachments: [], reactions: [], mentions: [], replyTo: null } : m
              ),
            },
          }
        : s.rooms;
      const detail = s.details[channelId];
      const details =
        detail?.announcement?.id === messageId ? { ...s.details, [channelId]: { ...detail, announcement: null } } : s.details;
      // ข้อความล่าสุดของห้องถูกยกเลิก → แถวในรายการห้องเปลี่ยนตาม (ไม่ต้องดึงรายการใหม่ทั้งหมด)
      const channels = s.channels.map((c) =>
        c.id === channelId && c.lastMessage?.id === messageId
          ? { ...c, lastMessage: { ...c.lastMessage, deleted: true, body: null, attachmentKind: null } }
          : c
      );
      return { rooms, details, channels };
    }),

  setReactions: (channelId, messageId, reactions) =>
    set((s) => {
      const room = s.rooms[channelId];
      if (!room) return s;
      const items = room.items.map((m) => (m.id === messageId ? { ...m, reactions } : m));
      return { rooms: { ...s.rooms, [channelId]: { ...room, items } } };
    }),

  setDetail: (channelId, detail) => set((s) => ({ details: { ...s.details, [channelId]: detail } })),

  applyRead: (channelId, userId, seq) =>
    set((s) => {
      const detail = s.details[channelId];
      const prev = detail?.readSeqs[userId];
      const details =
        detail && (!prev || BigInt(seq) > BigInt(prev))
          ? { ...s.details, [channelId]: { ...detail, readSeqs: { ...detail.readSeqs, [userId]: seq } } }
          : s.details;
      // เราอ่านจากอีกเครื่อง/อีกแท็บ → ตัวเลขยังไม่อ่านบนเครื่องนี้หายตาม
      const channels =
        userId === s.meId ? s.channels.map((c) => (c.id === channelId ? { ...c, unreadCount: 0, mentionCount: 0 } : c)) : s.channels;
      return { details, channels };
    }),

  setTyping: (channelId, userId) =>
    set((s) => ({ typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [userId]: Date.now() + 6000 } } })),

  clearTyping: (channelId, userId) =>
    set((s) => {
      const room = { ...s.typing[channelId] };
      delete room[userId];
      return { typing: { ...s.typing, [channelId]: room } };
    }),

  receiveMessage: (message, countAsUnread) =>
    set((s) => {
      const channelId = message.channelId;
      const room = s.rooms[channelId];
      const rooms = room && !room.detached ? { ...s.rooms, [channelId]: { ...room, items: merge(room.items, [message]) } } : s.rooms;

      const mentioned = message.mentions.includes(s.meId) || message.mentions.includes("all");
      const channels = s.channels.map((c) => {
        if (c.id !== channelId) return c;
        const isNewer = !c.lastMessage || message.createdAt >= c.lastMessage.createdAt;
        return {
          ...c,
          lastMessage: isNewer
            ? {
                id: message.id,
                body: message.body,
                authorId: message.authorId,
                kind: message.kind,
                attachmentKind: message.attachments[0]?.kind ?? null,
                deleted: message.deleted,
                createdAt: message.createdAt,
              }
            : c.lastMessage,
          activityAt: isNewer ? message.createdAt : c.activityAt,
          unreadCount: countAsUnread ? c.unreadCount + 1 : c.unreadCount,
          mentionCount: countAsUnread && mentioned ? c.mentionCount + 1 : c.mentionCount,
        };
      });
      // ผู้ส่งเป็นคนพิมพ์เสร็จแล้ว — เอา "กำลังพิมพ์" ของเขาออกทันที
      const typingRoom = s.typing[channelId];
      const typing = typingRoom?.[message.authorId]
        ? { ...s.typing, [channelId]: Object.fromEntries(Object.entries(typingRoom).filter(([u]) => u !== message.authorId)) }
        : s.typing;
      return { rooms, channels: sortChannels(channels), typing };
    }),

  clearUnread: (channelId) =>
    set((s) => ({ channels: s.channels.map((c) => (c.id === channelId ? { ...c, unreadCount: 0, mentionCount: 0 } : c)) })),

  setPrefsLocal: (channelId, prefs) =>
    set((s) => ({ channels: sortChannels(s.channels.map((c) => (c.id === channelId ? { ...c, ...prefs } : c))) })),

  setHighlight: (channelId, messageId) => set({ highlight: { channelId, messageId, at: Date.now() } }),
}));
