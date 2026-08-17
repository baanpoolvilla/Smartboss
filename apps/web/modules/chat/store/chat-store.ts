"use client";

import { create } from "zustand";
import type { ChatChannelSummary, ChatMessageDTO } from "../types";

/** ข้อความ optimistic ("temp-...") ยังไม่มี seq จริงจากเซิร์ฟเวอร์ — ให้ค่าใหญ่
 * infinity เสมอ (เข้าใจว่า "ใหม่สุด") ระหว่างรอเซิร์ฟเวอร์ตอบ ข้อความจริงเรียง
 * ตาม seq ตรง ๆ ได้เลย (ไม่ใช้ createdAt เทียบ — เหตุผลเดียวกับที่ ChatMessage.seq
 * มีอยู่: สอง insert ใน millisecond เดียวกันชนกันได้) */
function seqValue(m: ChatMessageDTO): bigint {
  return m.id.startsWith("temp-") ? BigInt(Number.MAX_SAFE_INTEGER) : BigInt(m.seq);
}

interface ChatState {
  channels: ChatChannelSummary[];
  messagesByChannel: Record<string, ChatMessageDTO[]>;
  activeChannelId: string | null;

  setChannels: (channels: ChatChannelSummary[]) => void;
  setActiveChannel: (id: string | null) => void;
  /** แทนที่ข้อความทั้งชุดของห้อง (โหลดหน้าแรก) */
  setMessages: (channelId: string, messages: ChatMessageDTO[]) => void;
  /** เติมข้อความใหม่ที่โพลเจอ/ที่เพิ่งส่งสำเร็จ — กันซ้ำด้วย id */
  appendMessages: (channelId: string, messages: ChatMessageDTO[]) => void;
  /** แทนที่ข้อความชั่วคราว (ตอนส่ง optimistic) ด้วยแถวจริงจากเซิร์ฟเวอร์ */
  replaceMessage: (channelId: string, tempId: string, real: ChatMessageDTO) => void;
  /** ส่งไม่สำเร็จ — เอาข้อความชั่วคราวออก */
  removeMessage: (channelId: string, id: string) => void;
  /** ล้าง badge ยังไม่อ่านของห้องนี้ในสถานะ local ทันที (ไม่ต้องรอโพลรอบหน้า) */
  markLocalRead: (channelId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  channels: [],
  messagesByChannel: {},
  activeChannelId: null,

  setChannels: (channels) => set({ channels }),
  setActiveChannel: (id) => set({ activeChannelId: id }),

  setMessages: (channelId, messages) =>
    set((s) => ({ messagesByChannel: { ...s.messagesByChannel, [channelId]: messages } })),

  appendMessages: (channelId, incoming) =>
    set((s) => {
      if (incoming.length === 0) return s;
      const existing = s.messagesByChannel[channelId] ?? [];
      const seen = new Set(existing.map((m) => m.id));
      const merged = [...existing, ...incoming.filter((m) => !seen.has(m.id))];
      merged.sort((a, b) => {
        const av = seqValue(a);
        const bv = seqValue(b);
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
      return { messagesByChannel: { ...s.messagesByChannel, [channelId]: merged } };
    }),

  replaceMessage: (channelId, tempId, real) =>
    set((s) => {
      const existing = s.messagesByChannel[channelId] ?? [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [channelId]: existing.map((m) => (m.id === tempId ? real : m)),
        },
      };
    }),

  removeMessage: (channelId, id) =>
    set((s) => {
      const existing = s.messagesByChannel[channelId] ?? [];
      return {
        messagesByChannel: { ...s.messagesByChannel, [channelId]: existing.filter((m) => m.id !== id) },
      };
    }),

  markLocalRead: (channelId) =>
    set((s) => ({
      channels: s.channels.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
    })),
}));
