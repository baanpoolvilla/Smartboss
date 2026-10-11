"use client";

import type { ChatChannelSummary, ChatUser } from "../types";
import { useChatStore, type RoomMessage, type RoomState } from "../store/chat-store";

/**
 * แชทที่จำไว้ในเครื่อง — เปิดแชทมาเห็นรายการห้อง/ข้อความล่าสุดทันทีแบบ LINE แล้วค่อยดึงของจริงมาทับ
 * ("เวลาเข้าแชทต้องโหลดข้อมูลแปปนึงถึงจะแสดง") เดิมทุกอย่างอยู่แค่ในหน่วยความจำ ⇒ เปิดแอปใหม่/แอปรีโหลด
 * หลัง deploy = ว่างเปล่าจนกว่าเซิร์ฟเวอร์จะตอบ
 *
 * ไม่ให้เครื่องอืด: เก็บแค่ห้องล่าสุด MAX_CHANNELS ห้อง ข้อความท้าย ๆ MAX_ROOMS ห้อง ห้องละ MAX_MESSAGES
 * เขียนลงเครื่องรวบเป็นครั้ง (SAVE_DEBOUNCE_MS) + ตอนสลับออกจากแอป ไม่ใช่ทุกข้อความ
 * ไม่มีผลกระทบ: เป็นแค่ของ "แสดงก่อน" — รายการห้องดึงใหม่ทุกครั้งเหมือนเดิม และห้องที่มาจากเครื่อง
 * (fromCache) เปิดเมื่อไหร่ดึงข้อความทั้งหน้ามาแทนทันที (ข้อความที่ถูกลบ/แก้/รีแอ็กชันระหว่างไม่ได้เปิดจึงไม่ค้าง)
 * อ่าน/เขียนพังได้เสมอ (โหมดส่วนตัว/เต็ม) — ห่อ try/catch ทุกจุด แชทยังทำงานแบบเดิม
 * แยกตามคน + ล้างตอนออกจากระบบ (เครื่องใช้ร่วมกัน คนถัดไปต้องไม่เห็นแชทของคนก่อน)
 */
const PREFIX = "sb-chat-cache:v1:";
const MAX_CHANNELS = 60;
const MAX_ROOMS = 15;
const MAX_MESSAGES = 30;
const MAX_BYTES = 1_500_000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 3000;

interface Snapshot {
  savedAt: number;
  channels: ChatChannelSummary[];
  users: ChatUser[];
  rooms: Record<string, RoomMessage[]>;
}

const keyFor = (meId: string) => `${PREFIX}${meId}`;

/** ออกจากระบบแล้ว — หน้ากำลังปิดจะ flush รอบสุดท้าย (pagehide) ต้องไม่เขียนแชทกลับลงเครื่อง */
let disabled = false;

/** ใส่ของที่จำไว้ลง store — เฉพาะตอนยังไม่มีของจริง (ไม่ทับข้อมูลสดที่โหลดมาแล้ว) */
export function restoreChatCache(meId: string): void {
  try {
    // แชทของคนอื่นที่เคยใช้เครื่องนี้ (ออกจากระบบไม่ผ่านปุ่ม เช่น token หมดอายุ) — ไม่เก็บไว้
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && k !== keyFor(meId)) localStorage.removeItem(k);
    }
    const raw = localStorage.getItem(keyFor(meId));
    if (!raw) return;
    const snap = JSON.parse(raw) as Snapshot;
    if (!snap || Date.now() - snap.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(meId));
      return;
    }
    const s = useChatStore.getState();
    if (s.channelsLoaded) return;
    if (Array.isArray(snap.channels) && snap.channels.length > 0) {
      s.setChannels(snap.channels);
      useChatStore.setState({ channelsFromCache: true });
    }
    if (Object.keys(s.users).length === 0 && Array.isArray(snap.users)) s.setUsers(snap.users, []);
    const rooms: Record<string, RoomState> = { ...useChatStore.getState().rooms };
    for (const [id, items] of Object.entries(snap.rooms ?? {})) {
      if (rooms[id] || !Array.isArray(items) || items.length === 0) continue;
      rooms[id] = { items, hasMore: true, detached: false, fromCache: true };
    }
    useChatStore.setState({ rooms });
  } catch {
    // ของในเครื่องอ่านไม่ได้/เพี้ยน — ทิ้งไป ใช้แบบเดิม (รอเซิร์ฟเวอร์)
    try {
      localStorage.removeItem(keyFor(meId));
    } catch {}
  }
}

function snapshot(): Snapshot {
  const s = useChatStore.getState();
  const channels = s.channels.slice(0, MAX_CHANNELS);
  const rooms: Record<string, RoomMessage[]> = {};
  for (const c of channels) {
    if (Object.keys(rooms).length >= MAX_ROOMS) break;
    const room = s.rooms[c.id];
    // ห้องที่กระโดดไปกลางประวัติ (detached) ไม่ใช่ "ข้อความล่าสุด" — ไม่เก็บ
    if (!room || room.detached) continue;
    // ข้อความที่กำลังส่ง/ส่งไม่สำเร็จไม่เก็บ — เปิดใหม่แล้วจะเห็นเป็นของค้างที่ส่งไม่ได้
    const items = room.items.filter((m) => !m.status).slice(-MAX_MESSAGES);
    if (items.length > 0) rooms[c.id] = items;
  }
  return { savedAt: Date.now(), channels, users: Object.values(s.users), rooms };
}

function save(meId: string): void {
  try {
    if (disabled || !useChatStore.getState().channelsLoaded) return;
    const snap = snapshot();
    let json = JSON.stringify(snap);
    // ใหญ่เกิน (ห้องที่มีข้อความยาว/ไฟล์แนบเยอะ) — เก็บแค่รายการห้อง + รายชื่อ ไม่เก็บข้อความ
    if (json.length > MAX_BYTES) json = JSON.stringify({ ...snap, rooms: {} });
    localStorage.setItem(keyFor(meId), json);
  } catch {
    // เครื่องเต็ม/โหมดส่วนตัว — ข้ามไป รอบหน้าโหลดจากเซิร์ฟเวอร์แบบเดิม
  }
}

/** เริ่มจำแชทลงเครื่องเป็นระยะ — คืนตัวหยุด */
export function startChatCachePersist(meId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    save(meId);
  };
  const unsubscribe = useChatStore.subscribe((s, prev) => {
    // พิมพ์อยู่/จุดออนไลน์/ไฮไลต์เปลี่ยนบ่อยแต่ไม่ได้เก็บ — ไม่ต้องตั้งเวลาเขียนใหม่
    if (s.channels === prev.channels && s.rooms === prev.rooms && s.users === prev.users) return;
    if (!timer) timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  });
  const onHide = () => {
    if (document.visibilityState === "hidden" && timer) flush();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
    if (timer) flush();
  };
}

/** ออกจากระบบ — ลบแชทที่จำไว้ในเครื่องทั้งหมด */
export function clearChatCache(): void {
  disabled = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {}
}
