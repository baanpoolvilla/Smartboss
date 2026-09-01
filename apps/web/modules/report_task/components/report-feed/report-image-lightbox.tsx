"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/modules/report_task/components/ui/dialog";
import type { ReportPostImage } from "@/modules/report_task/store/report-feed-store";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

const SWIPE_THRESHOLD_PX = 80;

export function ReportImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ReportPostImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const hasMultiple = images.length > 1;
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  // Reset the drag offset whenever the shown image actually changes (drag
  // commit, arrow keys, buttons, or dots) — adjusting state during render
  // rather than an effect, per React's guidance for resetting on prop change.
  const [lastIndex, setLastIndex] = useState(index);
  if (lastIndex !== index) {
    setLastIndex(index);
    setDragOffset(0);
  }

  // Standard lightbox conventions: arrow keys page through, Escape closes.
  // Capture phase: the dialog's own focus trap stops keydown from bubbling
  // back out, so a normal bubble-phase window listener never sees it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" && hasMultiple) onIndexChange((index - 1 + images.length) % images.length);
      if (e.key === "ArrowRight" && hasMultiple) onIndexChange((index + 1) % images.length);
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [index, images.length, hasMultiple, onIndexChange, onClose]);

  const image = images[index];
  if (!image) return null;

  const isVideo = image.mime?.startsWith("video/") ?? false;

  function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
    if (!hasMultiple) return;
    // A video has its own controls (play/seek) to drag-swipe past without
    // hijacking every pointer-down on it as a page-change gesture — same
    // reason it skips the click-to-close/swipe handling entirely below.
    if (isVideo) return;
    e.stopPropagation();
    setDragging(true);
    dragStartX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!dragging) return;
    setDragOffset(e.clientX - dragStartX.current);
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (dragOffset > SWIPE_THRESHOLD_PX) {
      onIndexChange((index - 1 + images.length) % images.length);
    } else if (dragOffset < -SWIPE_THRESHOLD_PX) {
      onIndexChange((index + 1) % images.length);
    } else {
      setDragOffset(0);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        // Clicking the backdrop (anywhere that isn't the image or a control)
        // closes it, same as every other image viewer.
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="inset-0 top-0 left-0 right-0 bottom-0 translate-x-0 translate-y-0 max-w-none sm:max-w-none w-screen h-screen max-h-screen bg-black/95 border-none ring-0 rounded-none p-0 gap-0 flex items-center justify-center cursor-zoom-out overflow-hidden"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
          aria-label="ปิด"
        >
          <X className="h-5 w-5" />
        </button>

        {hasMultiple && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index - 1 + images.length) % images.length);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
            aria-label="รูปก่อนหน้า"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={image.id}
            src={image.url ?? image.dataUrl}
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
            className="max-w-[92vw] max-h-[88vh]"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url ?? image.dataUrl}
            alt={image.name}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              transform: `translateX(${dragOffset}px)`,
              transition: dragging ? "none" : "transform 200ms ease",
              touchAction: "pan-y",
            }}
            className={`max-w-[92vw] max-h-[88vh] object-contain select-none ${hasMultiple ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"}`}
          />
        )}

        {hasMultiple && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index + 1) % images.length);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
            aria-label="รูปถัดไป"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        {hasMultiple && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
            <span className="text-xs text-white/80 tabular-nums">
              {index + 1} / {images.length}
            </span>
            <div className="flex items-center gap-1.5">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    onIndexChange(i);
                  }}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"}`}
                  aria-label={`ไปที่รูปที่ ${i + 1}`}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
