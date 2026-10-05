"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ChatStickerDTO, ChatStickerPackDTO } from "@/modules/chat/types";

/**
 * ชุดสติกเกอร์ของบริษัทฝั่งเบราว์เซอร์ — โหลดครั้งเดียวต่อแท็บ ใช้ร่วมกันทุกช่องพิมพ์ (แชท/รายงาน)
 * และหน้าจัดการ (components/sticker-manager.tsx) เพิ่ม/ลบ/เรียงแล้วทุกที่ที่เปิดอยู่เห็นทันที
 */

export type Sticker = ChatStickerDTO;
export type StickerPack = ChatStickerPackDTO;

/** ขนาดที่ย่อให้ก่อนอัปโหลด (ด้านยาวสุด) — คมบนจอมือถือ 2–3x ของที่แสดงจริง ~128px */
export const STICKER_SIDE = 320;
export const STICKER_MAX_BYTES = 1024 * 1024;

interface StickerState {
  packs: StickerPack[];
  stickers: Sticker[];
  canManage: boolean;
  loaded: boolean;
}

let state: StickerState = { packs: [], stickers: [], canManage: false, loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Partial<StickerState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function loadStickers(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = fetch("/api/chat/stickers", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((r: Partial<StickerState> | null) => {
      emit({ packs: r?.packs ?? [], stickers: r?.stickers ?? [], canManage: Boolean(r?.canManage), loaded: true });
    })
    .catch(() => emit({ loaded: true }));
  return loading;
}

export function useStickers(): StickerState {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
  useEffect(() => {
    void loadStickers();
  }, []);
  return snap;
}

/** สติกเกอร์ของหมวดหนึ่ง (null = "ทั่วไป") ตามลำดับที่จัดไว้ */
export function stickersIn(stickers: Sticker[], packId: string | null): Sticker[] {
  return stickers.filter((s) => s.packId === packId);
}

async function call<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : fallback);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/**
 * ย่อรูปนิ่งให้ด้านยาวสุดไม่เกิน STICKER_SIDE เป็น WebP (เก็บพื้นใสไว้) — ปกติเหลือ 20–80KB
 * GIF/WebP เคลื่อนไหวส่งตามจริง ไม่งั้นภาพหยุดนิ่ง (เซิร์ฟเวอร์จำกัด 1MB)
 */
async function prepareStickerFile(file: File): Promise<{ file: File; width?: number; height?: number }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { file };
  const animated = file.type === "image/gif" || (file.type === "image/webp" && (await isAnimatedWebp(file)));
  const scale = Math.min(1, STICKER_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  if (animated) {
    bitmap.close();
    return { file, width, height };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob || blob.type !== "image/webp") return { file, width, height };
  return { file: new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" }), width, height };
}

async function isAnimatedWebp(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  // ส่วนหัว VP8X: บิต animation อยู่ที่ไบต์ 20 (0x02)
  return String.fromCharCode(...head.slice(12, 16)) === "VP8X" && (head[20]! & 0x02) !== 0;
}

/**
 * เลือกรูปแล้วจบ — อัปทีละไฟล์เข้าหมวดที่ระบุ ไม่ต้องตั้งชื่อ (ใช้ชื่อไฟล์ แก้ทีหลังได้)
 * คืนจำนวนที่สำเร็จ + ข้อความของไฟล์ที่ไม่ผ่าน
 */
export async function addStickers(files: File[], packId: string | null): Promise<{ added: number; errors: string[] }> {
  let added = 0;
  const errors: string[] = [];
  for (const original of files) {
    try {
      const prepared = await prepareStickerFile(original);
      if (prepared.file.size > STICKER_MAX_BYTES) throw new Error("ใหญ่เกิน 1 MB");
      const form = new FormData();
      // ชื่อไฟล์ต้นฉบับ — เซิร์ฟเวอร์ตั้งชื่อสติกเกอร์จากตรงนี้ (เนื้อไฟล์เป็นตัวที่ย่อแล้ว)
      form.set("file", new File([prepared.file], original.name, { type: prepared.file.type }));
      if (packId) form.set("packId", packId);
      if (prepared.width) form.set("width", String(prepared.width));
      if (prepared.height) form.set("height", String(prepared.height));
      const { sticker } = await call<{ sticker: Sticker }>("/api/chat/stickers", { method: "POST", body: form }, "เพิ่มไม่สำเร็จ");
      emit({ stickers: [...state.stickers, sticker] });
      added++;
    } catch (err) {
      errors.push(`${original.name}: ${err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ"}`);
    }
  }
  return { added, errors };
}

export async function updateSticker(id: string, patch: { name?: string; keywords?: string; packId?: string | null }): Promise<void> {
  const { sticker } = await call<{ sticker: Sticker }>(`/api/chat/stickers/${encodeURIComponent(id)}`, json("PATCH", patch), "บันทึกไม่สำเร็จ");
  const rest = state.stickers.filter((s) => s.id !== id);
  // ย้ายหมวด = ไปต่อท้ายหมวดใหม่ (ตรงกับฝั่งเซิร์ฟเวอร์)
  emit({ stickers: patch.packId !== undefined ? [...rest, sticker] : state.stickers.map((s) => (s.id === id ? sticker : s)) });
}

export async function removeSticker(id: string): Promise<void> {
  await call(`/api/chat/stickers/${encodeURIComponent(id)}`, { method: "DELETE" }, "ลบสติกเกอร์ไม่สำเร็จ");
  emit({ stickers: state.stickers.filter((s) => s.id !== id) });
}

/** ลบหลายตัวรวด — ทีละตัวผ่าน endpoint เดิม (ตัวไหนพลาดไม่ทำให้ตัวอื่นค้าง) คืนจำนวนที่สำเร็จ/ไม่สำเร็จ */
export async function removeStickers(ids: string[]): Promise<{ done: number; failed: number }> {
  let done = 0;
  for (const id of ids) {
    await removeSticker(id).then(
      () => done++,
      () => undefined
    );
  }
  return { done, failed: ids.length - done };
}

/** ย้ายหลายตัวไปหมวดเดียวกัน (null = "ทั่วไป") — ไปต่อท้ายหมวดปลายทางตามลำดับที่เรียงอยู่ */
export async function moveStickers(ids: string[], packId: string | null): Promise<{ done: number; failed: number }> {
  let done = 0;
  for (const id of ids) {
    await updateSticker(id, { packId }).then(
      () => done++,
      () => undefined
    );
  }
  return { done, failed: ids.length - done };
}

export async function createPack(name: string): Promise<StickerPack> {
  const { pack } = await call<{ pack: StickerPack }>("/api/chat/sticker-packs", json("POST", { name }), "สร้างหมวดไม่สำเร็จ");
  emit({ packs: [...state.packs, pack] });
  return pack;
}

export async function renamePack(id: string, name: string): Promise<void> {
  await call(`/api/chat/sticker-packs/${encodeURIComponent(id)}`, json("PATCH", { name }), "เปลี่ยนชื่อไม่สำเร็จ");
  emit({ packs: state.packs.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)) });
}

/** ลบหมวด — สติกเกอร์ข้างในย้ายไป "ทั่วไป" */
export async function deletePack(id: string): Promise<void> {
  await call(`/api/chat/sticker-packs/${encodeURIComponent(id)}`, { method: "DELETE" }, "ลบหมวดไม่สำเร็จ");
  emit({
    packs: state.packs.filter((p) => p.id !== id),
    stickers: state.stickers.map((s) => (s.packId === id ? { ...s, packId: null } : s)),
  });
}

/** เรียงหมวดใหม่ — แสดงผลทันที บันทึกตามหลัง (บันทึกพลาด = โหลดใหม่จากเซิร์ฟเวอร์) */
export async function reorderPacks(packIds: string[]): Promise<void> {
  const byId = new Map(state.packs.map((p) => [p.id, p]));
  emit({ packs: packIds.map((id) => byId.get(id)).filter((p): p is StickerPack => Boolean(p)) });
  await call("/api/chat/stickers/order", json("PUT", { packIds }), "บันทึกลำดับไม่สำเร็จ").catch((err) => {
    void loadStickers(true);
    throw err;
  });
}

/** เรียงสติกเกอร์ในหมวดเดียวกันใหม่ */
export async function reorderStickersIn(packId: string | null, stickerIds: string[]): Promise<void> {
  const byId = new Map(state.stickers.map((s) => [s.id, s]));
  const reordered = stickerIds.map((id) => byId.get(id)).filter((s): s is Sticker => Boolean(s));
  emit({ stickers: [...state.stickers.filter((s) => s.packId !== packId), ...reordered] });
  await call("/api/chat/stickers/order", json("PUT", { stickerIds }), "บันทึกลำดับไม่สำเร็จ").catch((err) => {
    void loadStickers(true);
    throw err;
  });
}

// ─── ใช้ล่าสุด (รายเครื่อง แบบเดียวกับอิโมจิ) ───
const RECENT_KEY = "sb_sticker_recent_v1";
const RECENT_MAX = 16;

export function readRecentStickers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberSticker(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecentStickers().filter((e) => e !== id)].slice(0, RECENT_MAX)));
  } catch {
    // จำไม่ได้ก็ไม่เป็นไร
  }
}
