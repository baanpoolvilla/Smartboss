"use client";

import { useSyncExternalStore } from "react";

import { loadLocalMedia } from "./local-media";

/**
 * ตั้งค่าแชทส่วนตัว — เก็บในเครื่อง (localStorage) แยกต่อเครื่อง เช่น คอมที่ทำงานเปิดเสียง
 * มือถือปิดเสียงได้ อ่านได้ทั้งจากคอมโพเนนต์ (useChatPrefs) และโค้ดนอก React (getChatPrefs)
 */

/** "custom" = ไฟล์เสียงที่ผู้ใช้เลือกเอง (เก็บในเครื่อง ดู local-media.ts) */
export type ChatSound = "ding" | "pop" | "bell" | "custom" | "none";
export type ChatTextSize = "sm" | "md" | "lg";
/** "custom-color" = สีที่เลือกเอง (bgColor) · "custom-image" = รูปจากเครื่อง (local-media.ts) */
export type ChatBackground = "blue" | "white" | "green" | "cream" | "custom-color" | "custom-image";

export interface ChatPrefs {
  /** เสียงเมื่อมีข้อความใหม่ (ตอนเปิดเว็บอยู่) */
  sound: ChatSound;
  /** ความดัง 0–1 */
  volume: number;
  /** เด้งกล่องมุมจอเมื่อมีข้อความใหม่ตอนอยู่หน้าอื่น */
  toast: boolean;
  /** คอม: Enter = ส่ง (ปิดแล้ว Enter = ขึ้นบรรทัด, Ctrl+Enter = ส่ง) */
  enterToSend: boolean;
  textSize: ChatTextSize;
  background: ChatBackground;
  /** สีพื้นหลังที่เลือกเอง (ใช้เมื่อ background = "custom-color") */
  bgColor: string;
  /** สีฟองข้อความของฉัน — null = สีเขียวมาตรฐาน */
  bubbleColor: string | null;
  /** ชื่อไฟล์เสียงที่เลือกไว้ (แสดงในหน้าตั้งค่า) */
  customSoundName: string | null;
  /** เพิ่มทุกครั้งที่เปลี่ยนไฟล์ — ให้ส่วนที่แคชไฟล์ไว้รู้ว่าต้องโหลดใหม่ */
  mediaVersion: number;
}

export const DEFAULT_CHAT_PREFS: ChatPrefs = {
  sound: "ding",
  volume: 0.6,
  toast: true,
  enterToSend: true,
  textSize: "md",
  background: "blue",
  bgColor: "#e8eef5",
  bubbleColor: null,
  customSoundName: null,
  mediaVersion: 0,
};

export const CHAT_BACKGROUNDS: Record<"blue" | "white" | "green" | "cream", { label: string; color: string }> = {
  blue: { label: "ฟ้าเทา", color: "#eaf0f6" },
  white: { label: "ขาว", color: "#ffffff" },
  green: { label: "เขียวอ่อน", color: "#eef6ea" },
  cream: { label: "ครีม", color: "#f6f1e7" },
};

export const CHAT_TEXT_SIZES: Record<ChatTextSize, { label: string; px: number }> = {
  sm: { label: "เล็ก", px: 13.5 },
  md: { label: "ปกติ", px: 14.5 },
  lg: { label: "ใหญ่", px: 16.5 },
};

const KEY = "smartboss-chat-prefs";
const listeners = new Set<() => void>();
let cache: ChatPrefs | null = null;

function read(): ChatPrefs {
  if (cache) return cache;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    cache = raw ? { ...DEFAULT_CHAT_PREFS, ...JSON.parse(raw) } : DEFAULT_CHAT_PREFS;
  } catch {
    cache = DEFAULT_CHAT_PREFS;
  }
  return cache!;
}

export function getChatPrefs(): ChatPrefs {
  return read();
}

export function setChatPrefs(patch: Partial<ChatPrefs>): void {
  cache = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // โหมดส่วนตัว — ใช้ได้แค่รอบนี้
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  // เปลี่ยนจากอีกแท็บ → ตามกัน
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useChatPrefs(): ChatPrefs {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_CHAT_PREFS);
}

// ─── เสียง (สร้างเองด้วย Web Audio ไม่ต้องโหลดไฟล์) ───

let audioCtx: AudioContext | null = null;
let customBuffer: { version: number; buffer: AudioBuffer } | null = null;
let customLoading: number | null = null;

/** โหลดไฟล์เสียงที่ผู้ใช้เลือกมาเตรียมไว้ (ถอดรหัสครั้งเดียว ใช้ซ้ำทุกครั้งที่เล่น) */
async function ensureCustomBuffer(version: number): Promise<AudioBuffer | null> {
  if (customBuffer?.version === version) return customBuffer.buffer;
  if (customLoading === version) return null;
  customLoading = version;
  try {
    const blob = await loadLocalMedia("sound");
    if (!blob) return null;
    audioCtx ??= new AudioContext();
    const buffer = await audioCtx.decodeAudioData(await blob.arrayBuffer());
    customBuffer = { version, buffer };
    return buffer;
  } catch {
    return null;
  } finally {
    customLoading = null;
  }
}

/** เรียกหลังเปลี่ยนไฟล์เสียง — โหลดล่วงหน้าไว้ ครั้งแรกที่มีแจ้งเตือนจะได้ดังทันที */
export function preloadCustomSound(): void {
  const prefs = read();
  if (prefs.sound === "custom") void ensureCustomBuffer(prefs.mediaVersion);
}

/** เบราว์เซอร์ให้เล่นเสียงได้หลังผู้ใช้แตะหน้าเว็บแล้ว — เรียกตอนมีการแตะครั้งแรก */
export function unlockChatAudio(): void {
  try {
    audioCtx ??= new AudioContext();
    void audioCtx.resume();
  } catch {
    // ไม่รองรับเสียง
  }
}

function tone(ctx: AudioContext, freq: number, start: number, dur: number, peak: number, type: OscillatorType = "sine", toFreq?: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, start + dur * 0.4);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** เล่นเสียงแจ้งเตือนตามที่ตั้งไว้ (หรือเสียงที่ระบุ — ใช้ตอนกดลองฟังในหน้าตั้งค่า) */
export function playChatSound(sound?: ChatSound, volume?: number): void {
  const prefs = read();
  const s = sound ?? prefs.sound;
  const v = Math.max(0, Math.min(1, volume ?? prefs.volume));
  if (s === "none" || v === 0) return;
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state !== "running") return;
    const t = audioCtx.currentTime;
    const peak = 0.25 * v;
    if (s === "custom") {
      const version = prefs.mediaVersion;
      const ctx = audioCtx;
      const play = (buffer: AudioBuffer) => {
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = v;
        src.buffer = buffer;
        src.connect(gain).connect(ctx.destination);
        src.start();
        // เสียงแจ้งเตือนไม่ควรยาว — ตัดที่ 5 วิ
        src.stop(ctx.currentTime + Math.min(buffer.duration, 5));
      };
      if (customBuffer?.version === version) play(customBuffer.buffer);
      else void ensureCustomBuffer(version).then((b) => (b ? play(b) : tone(ctx, 880, ctx.currentTime, 0.28, peak, "sine", 1320)));
      return;
    }
    if (s === "ding") tone(audioCtx, 880, t, 0.28, peak, "sine", 1320);
    else if (s === "pop") tone(audioCtx, 520, t, 0.12, peak * 1.2, "triangle", 820);
    else {
      tone(audioCtx, 1046, t, 0.5, peak * 0.8);
      tone(audioCtx, 1568, t + 0.12, 0.6, peak * 0.6);
    }
  } catch {
    // ไม่มีเสียงก็ไม่เป็นไร
  }
}
