"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import type { ChatAttachment } from "../types";

/** ลิงก์ดาวน์โหลดไฟล์ด้วยชื่อเดิม (/api/files รองรับ ?download=<ชื่อไฟล์>) */
export function downloadUrl(a: Pick<ChatAttachment, "url" | "name">): string {
  return `${a.url}${a.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(a.name)}`;
}

/** ดูรูป/วิดีโอเต็มจอ — ปัดซ้าย/ขวา (หรือปุ่มลูกศร) ดูรูปอื่นในชุดเดียวกัน, Esc ปิด */
export function Lightbox({ items, index, onClose }: { items: ChatAttachment[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const [touchX, setTouchX] = useState<number | null>(null);
  const item = items[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
      if (e.key === "ArrowRight") setI((v) => Math.min(items.length - 1, v + 1));
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [items.length, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/92 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="ดูรูปภาพ"
      onTouchStart={(e) => setTouchX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchX == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
        if (dx > 60) setI((v) => Math.max(0, v - 1));
        if (dx < -60) setI((v) => Math.min(items.length - 1, v + 1));
        setTouchX(null);
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="text-sm opacity-80">{items.length > 1 ? `${i + 1} / ${items.length}` : ""}</span>
        <a
          href={downloadUrl(item)}
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"
          aria-label="ดาวน์โหลด"
          title="ดาวน์โหลด"
        >
          <Download className="h-5 w-5" />
        </a>
        <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10" aria-label="ปิด">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-2" onClick={onClose}>
        {item.kind === "video" ? (
          <video src={item.url} controls autoPlay playsInline className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.url}
            src={item.url}
            alt={item.name}
            className="max-h-full max-w-full object-contain"
            style={item.thumbUrl ? { backgroundImage: `url(${item.thumbUrl})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" } : undefined}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {i > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setI(i - 1);
            }}
            className="absolute left-2 hidden h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex"
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
              setI(i + 1);
            }}
            className="absolute right-2 hidden h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex"
            aria-label="รูปถัดไป"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  );
}
