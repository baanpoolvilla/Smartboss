"use client";

import { create } from "zustand";

/**
 * ปากกาวาดบนรูปก่อนส่ง — ใช้ได้ทุกช่องพิมพ์ (แชท, คอมเมนต์งาน, รายงาน)
 *
 * `openAnnotator(file)` เปิดหน้าต่างวาด (ImageAnnotatorHost ที่ Shell วางไว้ครั้งเดียว)
 * แล้วคืนไฟล์ที่วาดแล้ว หรือ null ถ้ากดยกเลิก
 *
 * วาดบน "ไฟล์ในเครื่อง" เสมอ ไม่ใช่รูปจาก URL — ไฟล์ที่อัปโหลดแล้วอยู่บนโดเมนไฟล์แยก
 * (FILES_DOMAIN) เบราว์เซอร์ไม่ยอมให้ส่งออกภาพข้ามโดเมนจาก canvas จึงจำไฟล์ต้นฉบับไว้
 * ตอนอัปโหลด (`rememberOriginal`) แล้วปุ่มปากกาบนรูปหยิบมาจากตรงนี้
 */

interface AnnotatorState {
  file: File | null;
  resolve: ((file: File | null) => void) | null;
}

export const useAnnotatorStore = create<AnnotatorState>(() => ({ file: null, resolve: null }));

export function openAnnotator(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const prev = useAnnotatorStore.getState().resolve;
    prev?.(null);
    useAnnotatorStore.setState({ file, resolve });
  });
}

export function closeAnnotator(result: File | null) {
  const { resolve } = useAnnotatorStore.getState();
  useAnnotatorStore.setState({ file: null, resolve: null });
  resolve?.(result);
}

// ─── ไฟล์ต้นฉบับของรูปที่อัปโหลดในแท็บนี้ (key = URL ที่ได้หลังอัปโหลด) ───
const MAX_REMEMBERED = 60;
const originals = new Map<string, File>();

export function rememberOriginal(url: string | undefined | null, file: File) {
  if (!url || !file.type.startsWith("image/") || file.type === "image/gif") return;
  originals.delete(url);
  originals.set(url, file);
  while (originals.size > MAX_REMEMBERED) {
    const oldest = originals.keys().next().value;
    if (oldest === undefined) break;
    originals.delete(oldest);
  }
}

export function originalFor(url: string | undefined | null): File | null {
  return url ? (originals.get(url) ?? null) : null;
}

/**
 * รูปที่ส่งไปแล้ว (URL /api/files/...) → ไฟล์ในเครื่องสำหรับวาด — ขอผ่าน ?proxy=1 ให้เซิร์ฟเวอร์
 * ส่งไบต์มาเอง (โดเมนเดียวกัน) ไม่งั้น canvas ส่งออกไม่ได้ ไฟล์ที่เพิ่งอัปโหลดในแท็บนี้ใช้ต้นฉบับเลย
 */
export async function fileForEditing(url: string, name?: string): Promise<File> {
  const remembered = originalFor(url);
  if (remembered) return remembered;
  const proxied = url.startsWith("/api/files/") ? `${url}${url.includes("?") ? "&" : "?"}proxy=1` : url;
  const res = await fetch(proxied, { cache: "no-store" });
  if (!res.ok) throw new Error("เปิดรูปนี้เพื่อแก้ไขไม่ได้");
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("แก้ไขได้เฉพาะรูปภาพ");
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const base = (name ?? "image").replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

/** ดาวน์โหลดไฟล์ลงเครื่อง (ใช้ตอนแก้รูปจากที่ที่ไม่มีช่องพิมพ์ให้แนบ) */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ไฟล์ที่ลากมาวาง / วางจากคลิปบอร์ด — ใช้ร่วมกันทุกช่องพิมพ์ */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const fromFiles = Array.from(dt.files ?? []);
  if (fromFiles.length > 0) return fromFiles;
  return Array.from(dt.items ?? [])
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f);
}

/** props สำหรับ div ที่รับไฟล์ลากมาวาง — onFiles ได้ไฟล์ทั้งหมดที่ปล่อยลงมา */
export function dropZoneProps(onFiles: (files: File[]) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop: (e: React.DragEvent) => {
      const files = filesFromDataTransfer(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      onFiles(files);
    },
  };
}
