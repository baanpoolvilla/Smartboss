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
