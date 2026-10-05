"use client";

import { useEffect, useState } from "react";
import { BookImage, ChevronLeft, ChevronRight, Download, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { fileForEditing, openAnnotator } from "@/lib/annotate/annotate";
import type { ChatAttachment } from "../types";
import { daysUntilExpiry } from "../lib/retention";
import { useBackToClose } from "@/lib/back-to-close";
import { useBlackSystemBars } from "@/lib/black-system-bars";
import { ChatAvatar } from "./chat-avatar";
import { slideStyle, useSwipePager } from "@/lib/swipe-pager";

/** รูปในหน้าดูเต็มจอ — messageId มีเมื่อเปิดจากแชท (ใช้ตอนบันทึกลงอัลบั้ม) */
export type LightboxItem = ChatAttachment & { messageId?: string };

export interface LightboxInfo {
  name: string;
  avatarUrl?: string | null;
  colorKey: string;
  /** เวลาที่แสดง (จัดรูปแบบมาแล้ว) */
  when: string;
  text?: string | null;
}

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
  infoFor,
  onTop = false,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  /** ไม่ส่ง = ไม่มีปุ่มบันทึกลงอัลบั้ม (เช่น ดูรูปที่อยู่ในอัลบั้มอยู่แล้ว) */
  onSaveToAlbum?: (item: LightboxItem) => void;
  /** วางเหนือหน้าต่างป๊อปอัปอื่น (เปิดจากในป๊อปอัป เช่น รูปในใบงานซ่อม) — ปกติอยู่ใต้ป๊อปอัปของแชท (เลือกอัลบั้ม) */
  onTop?: boolean;
  /** ข้อมูลใต้รูปแบบ Discord — ใครส่ง เมื่อไร และข้อความที่ส่งมาด้วย (ไม่ส่ง/คืน null = ไม่แสดง) */
  infoFor?: (item: LightboxItem) => LightboxInfo | null;
  /** ดินสอ: วาด/เขียนบนรูปนี้ แล้วส่งไฟล์ใหม่ให้ผู้เรียกแนบเข้าช่องพิมพ์ (รูปเดิมไม่เปลี่ยน) */
  onEditImage?: (file: File) => void;
}) {
  const [i, setI] = useState(index);
  useBackToClose(true, onClose);
  const item = items[i];
  const info = item && infoFor ? infoFor(item) : null;
  useBlackSystemBars();
  // กรอบนอกสุด — ระบบปัดใช้จางพื้นดำตอนลากเพื่อปิด (callback ref เป็น state ส่งเข้า hook ได้)
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  // มือถือ: แตะรูป = ซ่อน/โชว์ปุ่ม แบบแอปรูป/Discord (ปิดด้วย ✕, ปุ่มย้อนกลับ หรือปัดขึ้น/ลง)
  const [chromeHidden, setChromeHidden] = useState(false);
  // ปัดซ้าย/ขวา — รูปเลื่อนตามนิ้ว/เมาส์ รูปข้าง ๆ โหลดรอไว้ (ดู lib/swipe-pager.ts)
  const {
    viewportRef,
    onPointerDown: swipeDown,
    onPointerMove: swipeMove,
    onPointerUp: swipeUp,
    onClickCapture: swipeClickCapture,
    onWheel: swipeWheel,
    trackRef,
    trackStyle,
    slides,
    go,
  } = useSwipePager({ count: items.length, index: i, onIndexChange: setI, onSwipeDismiss: onClose, dismissBackdrop: rootEl });
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
      ref={setRootEl}
      data-chrome-hidden={chromeHidden || undefined}
      className={`group fixed inset-0 ${onTop ? "z-[110]" : "z-[80]"} flex flex-col bg-black text-white`}
      role="dialog"
      aria-modal="true"
      aria-label="ดูรูปภาพ"
    >
      {/* แถบบน: ลำดับรูปซ้าย · ปุ่มอื่น ๆ ขวา · ✕ ขวาสุด (ที่เดียวกันทุกหน้าดูรูป) — ปุ่มพื้นเข้มมุมมน ลอยทับรูป
          (อ่านออกทั้งบนรูปสว่าง/มืด) */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] [&>*]:pointer-events-auto group-data-[chrome-hidden]:[&>*]:pointer-events-none transition-opacity duration-200 group-data-[dismissing]:opacity-0 group-data-[chrome-hidden]:opacity-0 group-data-[chrome-hidden]:pointer-events-none"
      >
        {items.length > 1 && (
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-xs tabular-nums backdrop-blur-sm">
            {i + 1} / {items.length}
          </span>
        )}
        <span className="ml-auto" />
        {onSaveToAlbum && (
          <button type="button" onClick={() => onSaveToAlbum(item)} className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-2xl bg-black/55 px-2.5 text-sm text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-50" title="บันทึกลงอัลบั้ม — ไม่หมดอายุ" aria-label="บันทึกลงอัลบั้ม">
            <BookImage className="h-5 w-5" /> <span className="hidden sm:inline">บันทึกลงอัลบั้ม</span>
          </button>
        )}
        {onEditImage && item.kind === "image" && (
          <button type="button" onClick={() => void editImage()} disabled={editing} className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-2xl bg-black/55 px-2.5 text-sm text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-50" title="วาด/เขียนบนรูปนี้ แล้วแนบส่ง" aria-label="วาดบนรูป">
            {editing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Pencil className="h-5 w-5" />}
            <span className="hidden sm:inline">วาด</span>
          </button>
        )}
        <a href={downloadUrl(item)} className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-2xl bg-black/55 px-2.5 text-sm text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-50" aria-label="ดาวน์โหลด" title="ดาวน์โหลด">
          <Download className="h-5 w-5" />
        </a>
        <button type="button" onClick={onClose} className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-2xl bg-black/55 px-2.5 text-sm text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-50" aria-label="ปิด">
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* แถบล่างแบบ Discord: ใครส่ง · เมื่อไร · ข้อความที่ส่งมากับรูป — ไล่เงาดำให้อ่านออกบนรูป */}
      {(info || item.expiresAt) && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-12 transition-opacity duration-200 group-data-[dismissing]:opacity-0 group-data-[chrome-hidden]:opacity-0 group-data-[chrome-hidden]:pointer-events-none"
        >
          <div className="mx-auto flex max-w-3xl items-start gap-3">
            {info && <ChatAvatar name={info.name} src={info.avatarUrl} colorKey={info.colorKey} className="h-10 w-10 shrink-0" />}
            <div className="min-w-0 flex-1">
              {info && (
                <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold leading-tight">
                  <span className="truncate">{info.name}</span>
                  <span className="text-xs font-normal text-white/65">{info.when}</span>
                </p>
              )}
              {info?.text && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[15px] leading-snug text-white/90">{info.text}</p>}
              {item.expiresAt && (
                <p className="mt-1 text-xs text-white/60">
                  {daysUntilExpiry(item.expiresAt) === 0 ? "หมดอายุวันนี้" : `หมดอายุใน ${daysUntilExpiry(item.expiresAt)} วัน`}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

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
        <div ref={trackRef} className="absolute inset-0" style={trackStyle}>
          {slides.map((sl) => {
            const it = items[sl.index]!;
            return (
              <div
                key={sl.key}
                className="absolute inset-0 flex items-center justify-center"
                style={slideStyle(sl.rel)}
                onClick={(e) => {
                  // จอสัมผัส: แตะตรงไหนก็ได้ = ซ่อน/โชว์ปุ่ม · เมาส์: คลิกพื้นนอกรูป = ปิด (แบบ Discord บนเว็บ)
                  if (window.matchMedia("(pointer: coarse)").matches) setChromeHidden((v) => !v);
                  else if (e.target === e.currentTarget) onClose();
                }}
              >
                {it.kind === "video" ? (
                  sl.rel === 0 ? (
                    <video src={it.url} controls autoPlay playsInline className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
                  ) : it.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumbUrl} alt="" draggable={false} decoding="async" className="max-h-full max-w-full object-contain opacity-80" />
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
                    decoding="async"
                    className="max-h-full max-w-full object-contain [@media(pointer:coarse)]:h-full [@media(pointer:coarse)]:w-full"
                    style={it.thumbUrl ? { backgroundImage: `url(${it.thumbUrl})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" } : undefined}
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
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex transition-opacity duration-200 group-data-[dismissing]:opacity-0 group-data-[chrome-hidden]:opacity-0 group-data-[chrome-hidden]:pointer-events-none"
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
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex transition-opacity duration-200 group-data-[dismissing]:opacity-0 group-data-[chrome-hidden]:opacity-0 group-data-[chrome-hidden]:pointer-events-none"
            aria-label="รูปถัดไป"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  );
}
