"use client";

import { useEffect, useState } from "react";
import { BookImage, ChevronLeft, ChevronRight, Download, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { fileForEditing, openAnnotator } from "@/lib/annotate/annotate";
import type { ChatAttachment } from "../types";
import { daysUntilExpiry } from "../lib/retention";
import { useBackToClose } from "@/lib/back-to-close";
import { slideStyle, useSwipePager } from "@/lib/swipe-pager";

/** รูปในหน้าดูเต็มจอ — messageId มีเมื่อเปิดจากแชท (ใช้ตอนบันทึกลงอัลบั้ม) */
export type LightboxItem = ChatAttachment & { messageId?: string };

/** ลิงก์ดาวน์โหลดไฟล์ด้วยชื่อเดิม (/api/files รองรับ ?download=<ชื่อไฟล์>) */
export function downloadUrl(a: Pick<ChatAttachment, "url" | "name">): string {
  return `${a.url}${a.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(a.name)}`;
}

/** ดูรูป/วิดีโอเต็มจอ — ปัดซ้าย/ขวา (หรือปุ่มลูกศร) ดูรูปอื่นในชุดเดียวกัน, Esc ปิด */
export function Lightbox({
  items,
  index,
  onClose,
  onSaveToAlbum,
  onEditImage,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  /** ไม่ส่ง = ไม่มีปุ่มบันทึกลงอัลบั้ม (เช่น ดูรูปที่อยู่ในอัลบั้มอยู่แล้ว) */
  onSaveToAlbum?: (item: LightboxItem) => void;
  /** ดินสอ: วาด/เขียนบนรูปนี้ แล้วส่งไฟล์ใหม่ให้ผู้เรียกแนบเข้าช่องพิมพ์ (รูปเดิมไม่เปลี่ยน) */
  onEditImage?: (file: File) => void;
}) {
  const [i, setI] = useState(index);
  useBackToClose(true, onClose);
  const item = items[i];
  // ปัดซ้าย/ขวา — รูปเลื่อนตามนิ้ว/เมาส์ รูปข้าง ๆ โหลดรอไว้ (ดู lib/swipe-pager.ts)
  const {
    viewportRef,
    onPointerDown: swipeDown,
    onPointerMove: swipeMove,
    onPointerUp: swipeUp,
    onClickCapture: swipeClickCapture,
    onWheel: swipeWheel,
    trackStyle,
    slides,
    go,
  } = useSwipePager({ count: items.length, index: i, onIndexChange: setI });
  const [editing, setEditing] = useState(false);
  async function editImage() {
    if (!item || !onEditImage) return;
    setEditing(true);
    try {
      const edited = await openAnnotator(await fileForEditing(item.url, item.name));
      if (!edited) return;
      onClose();
      onEditImage(edited);
      toast.success("แนบรูปที่วาดแล้วในช่องพิมพ์ — กดส่งได้เลย");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "วาดบนรูปนี้ไม่ได้");
    } finally {
      setEditing(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/92 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="ดูรูปภาพ"
    >
      <div className="flex items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="text-sm opacity-80">{items.length > 1 ? `${i + 1} / ${items.length}` : ""}</span>
        {item.expiresAt && (
          <span className="text-xs opacity-70">
            {daysUntilExpiry(item.expiresAt) === 0 ? "หมดอายุวันนี้" : `หมดอายุใน ${daysUntilExpiry(item.expiresAt)} วัน`}
          </span>
        )}
        {onSaveToAlbum && (
          <button
            type="button"
            onClick={() => onSaveToAlbum(item)}
            className="ml-auto flex h-10 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-white/10"
            title="บันทึกลงอัลบั้ม — ไม่หมดอายุ"
          >
            <BookImage className="h-5 w-5" /> <span className="hidden sm:inline">บันทึกลงอัลบั้ม</span>
          </button>
        )}
        {onEditImage && item.kind === "image" && (
          <button
            type="button"
            onClick={() => void editImage()}
            disabled={editing}
            className={`${onSaveToAlbum ? "" : "ml-auto "}flex h-10 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-white/10 disabled:opacity-50`}
            title="วาด/เขียนบนรูปนี้ แล้วแนบส่ง"
          >
            {editing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Pencil className="h-5 w-5" />}
            <span className="hidden sm:inline">วาด</span>
          </button>
        )}
        <a
          href={downloadUrl(item)}
          className={`${onSaveToAlbum || (onEditImage && item.kind === "image") ? "" : "ml-auto "}flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10`}
          aria-label="ดาวน์โหลด"
          title="ดาวน์โหลด"
        >
          <Download className="h-5 w-5" />
        </a>
        <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10" aria-label="ปิด">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={swipeDown}
        onPointerMove={swipeMove}
        onPointerUp={swipeUp}
        onPointerCancel={swipeUp}
        onClickCapture={swipeClickCapture}
        onWheel={swipeWheel}
        className="relative min-h-0 flex-1 select-none overflow-hidden"
        style={{ touchAction: "none", cursor: items.length > 1 ? "grab" : undefined }}
      >
        <div className="absolute inset-0" style={trackStyle}>
          {slides.map((sl) => {
            const it = items[sl.index]!;
            return (
              <div key={sl.key} className="absolute inset-0 flex items-center justify-center p-2" style={slideStyle(sl.rel)} onClick={onClose}>
                {it.kind === "video" ? (
                  sl.rel === 0 ? (
                    <video src={it.url} controls autoPlay playsInline className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
                  ) : it.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumbUrl} alt="" draggable={false} className="max-h-full max-w-full object-contain opacity-80" />
                  ) : (
                    <div className="h-40 w-64 max-w-full rounded-xl bg-white/10" />
                  )
                ) : (
                  // <img> ตัวเดิมตามสไลด์ — เลื่อนเข้ากลางแล้วไม่ต้องโหลด/วาดใหม่
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.url}
                    alt={it.name}
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                    style={it.thumbUrl ? { backgroundImage: `url(${it.thumbUrl})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" } : undefined}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
            );
          })}
        </div>
        {i > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex"
            aria-label="รูปก่อนหน้า"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {i < items.length - 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex"
            aria-label="รูปถัดไป"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  );
}
