"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/modules/report_task/components/ui/dialog";
import type { ReportPostImage } from "@/modules/report_task/store/report-feed-store";
import { ReportFileChip } from "@/modules/report_task/components/report-feed/report-file-chip";
import { isDocAttachment, isVideoAttachment } from "@/modules/report_task/lib/report-attachment-kind";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";

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
  const activeThumbRef = useRef<HTMLButtonElement>(null);
  // With 15-20+ attachments the filmstrip scrolls — keep the active
  // thumbnail on screen as the arrows/swipe/keyboard move through them,
  // not just clicks on the strip itself.
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);
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

  const isVideo = isVideoAttachment(image.mime);
  const isDoc = isDocAttachment(image.mime);

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

        {isDoc ? (
          /* A pdf/xlsx has no frame to fill a lightbox with — clicking one in
             a post's attachment grid lands here all the same (the grid holds
             every attachment, not just the pictures), so it gets the file's
             identity plus the one action that makes sense for it. */
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-[min(86vw,26rem)] cursor-default flex-col items-center gap-4 rounded-2xl bg-white px-6 py-7 text-center sm:px-8"
          >
            {/* Width-capped so a long filename truncates inside the card
                instead of stretching it past a phone's screen. */}
            <ReportFileChip media={image} className="w-full border-0 p-0" />
            <a
              href={image.url ?? image.dataUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--brand-green-dark)] hover:text-white"
            >
              <Download className="h-4 w-4" />
              เปิด / ดาวน์โหลดไฟล์
            </a>
          </div>
        ) : isVideo ? (
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
          // Thumbnail filmstrip instead of a row of ~6px dots — with a
          // handful of images the dots were already fiddly to tap, and this
          // feed's posts routinely carry 15-20+ attachments (a dot per image
          // shrinks toward unusable at that count anyway). Each thumbnail is
          // a real 44px tap target and shows which image it actually jumps
          // to, same as Discord's own lightbox strip
          // ("ให้กดง่ายหน่อยได้ไหมใหญ่กว่านี้ หรือแสดงเป็นภาพ").
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2.5 max-w-[92vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs text-white/80 tabular-nums shrink-0">
              {index + 1} / {images.length}
            </span>
            <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 max-w-[70vw] sm:max-w-[60vw]">
              {images.map((img, i) => {
                const active = i === index;
                const thumbIsVideo = img.mime?.startsWith("video/") ?? false;
                return (
                  <button
                    key={img.id}
                    ref={active ? activeThumbRef : undefined}
                    onClick={() => onIndexChange(i)}
                    className={`relative h-11 w-11 shrink-0 rounded-md overflow-hidden transition-opacity cursor-pointer ${active ? "ring-2 ring-white" : "opacity-50 hover:opacity-80"}`}
                    aria-label={`ไปที่รูปที่ ${i + 1}`}
                  >
                    {isDocAttachment(img.mime) ? (
                      <ReportFileChip media={img} variant="icon" className="h-full w-full justify-center bg-white" />
                    ) : thumbIsVideo ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={img.url ?? img.dataUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.url ?? img.dataUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
