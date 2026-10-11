import { beforeEach, describe, expect, it } from "vitest";

import { useChatStore } from "../store/chat-store";
import type { ChatChannelSummary, ChatMessageDTO } from "../types";
import { clearChatCache, restoreChatCache, startChatCachePersist } from "./offline-cache";

// สภาพแวดล้อมเทสเป็น node — จำลอง localStorage / document / window เท่าที่ไฟล์นี้ใช้
const mem = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
  document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  window: { addEventListener() {}, removeEventListener() {} },
});

const channel = (id: string, activityAt: string) => ({ id, pinned: false, activityAt, unreadCount: 0 }) as unknown as ChatChannelSummary;
const message = (id: string, seq: string) => ({ id, seq, body: id }) as unknown as ChatMessageDTO;

const initial = useChatStore.getState();
beforeEach(() => {
  mem.clear();
  useChatStore.setState(initial, true);
});

/** ใช้แชทแล้วบันทึกลงเครื่อง (ตัวหยุด flush ของที่ค้างอยู่) แล้วจำลองเปิดแอปใหม่ (store ว่าง) */
function useThenReopen(meId: string) {
  const stop = startChatCachePersist(meId);
  const s = useChatStore.getState();
  s.setChannels([channel("c1", "2026-10-11T10:00:00Z"), channel("c2", "2026-10-11T09:00:00Z")]);
  s.setRoom("c1", [message("m1", "1"), message("m2", "2")], false);
  s.addLocal("c1", { ...message("local-x", ""), status: "sending" });
  stop();
  useChatStore.setState(initial, true);
}

describe("แชทที่จำไว้ในเครื่อง", () => {
  it("เปิดแอปใหม่เห็นรายการห้อง + ข้อความล่าสุดทันที ห้องถูกตีว่ามาจากเครื่อง", () => {
    useThenReopen("u1");
    restoreChatCache("u1");
    const s = useChatStore.getState();
    expect(s.channels.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(s.channelsLoaded).toBe(true);
    expect(s.channelsFromCache).toBe(true);
    // ข้อความที่กำลังส่งไม่ถูกเก็บ
    expect(s.rooms.c1?.items.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(s.rooms.c1?.fromCache).toBe(true);
  });

  it("รายการจริงจากเซิร์ฟเวอร์มาทับ = ไม่ใช่ของจากเครื่องแล้ว", () => {
    useThenReopen("u1");
    restoreChatCache("u1");
    useChatStore.getState().setChannels([channel("c3", "2026-10-11T11:00:00Z")]);
    expect(useChatStore.getState().channelsFromCache).toBe(false);
    useChatStore.getState().setRoom("c1", [message("m3", "3")], false);
    expect(useChatStore.getState().rooms.c1?.fromCache).toBeUndefined();
  });

  it("คนอื่นใช้เครื่องเดียวกันไม่เห็นแชทของคนก่อน", () => {
    useThenReopen("u1");
    restoreChatCache("u2");
    expect(useChatStore.getState().channels).toEqual([]);
    expect([...mem.keys()].some((k) => k.endsWith(":u1"))).toBe(false);
  });

  it("ออกจากระบบแล้วลบหมด และไม่เขียนกลับตอนหน้าปิด", () => {
    useThenReopen("u1");
    clearChatCache();
    expect(mem.size).toBe(0);
    useThenReopen("u1");
    expect(mem.size).toBe(0);
  });
});
