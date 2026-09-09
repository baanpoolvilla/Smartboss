"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/modules/report_task/components/ui/dialog";
import type { ReportPostImage } from "@/modules/report_task/store/report-feed-store";
import { ReportFileChip } from "@/modules/report_task/components/report-feed/report-file-chip";
import { isDocAttachment, isVideoAttachment } from "@/modules/report_task/lib/report-attachment-kind";
import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from "lucide-react";

const SWIPE_THRESHOLD_PX = 80;
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

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

  // Zoom — double-click/double-tap, scroll wheel, and pinch all land here
  // ("zoom in / zoom out รูปภาพได้ด้วย ทั้งหมดที่เป็นรูปภาพเลย") since this
  // one component is what every "รูปภาพ" click across the module opens into.
  // `pan` only ever matters while `scale > 1` — reset together whenever the
  // image resets (index change, zooming back out to 1x).
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomed = scale > 1;
  // Single-pointer drag-to-pan while zoomed; the existing swipe-to-next-image
  // drag above only makes sense at 1x, where there's nothing to pan.
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const isPanning = useRef(false);
  // Two-finger pinch — tracks every active pointer by id so the second
  // finger's own pointerdown/move can be told apart from the first's.
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef({ dist: 0, scale: 1 });

  function resetZoom() {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  function zoomBy(delta: number, center?: { x: number; y: number }) {
    setScale((s) => {
      const next = clampScale(s + delta);
      if (next === 1) setPan({ x: 0, y: 0 });
      else if (center) {
        // Keep the point under the cursor/pinch-center visually still as the
        // scale changes, instead of always zooming toward the image's own
        // center — same feel as a map or photo app's zoom.
        setPan((p) => ({
          x: p.x - center.x * (next / s - 1),
          y: p.y - center.y * (next / s - 1),
        }));
      }
      return next;
    });
  }
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
    setScale(1);
    setPan({ x: 0, y: 0 });
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

  function handleWheel(e: React.WheelEvent<HTMLElement>) {
    if (isVideo || isDoc) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const center = { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
    zoomBy(-e.deltaY * 0.0025 * Math.max(scale, 1), center);
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLElement>) {
    if (isVideo || isDoc) return;
    e.stopPropagation();
    if (zoomed) {
      resetZoom();
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const center = { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
      setScale(DOUBLE_TAP_SCALE);
      setPan({ x: -center.x * (DOUBLE_TAP_SCALE - 1), y: -center.y * (DOUBLE_TAP_SCALE - 1) });
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
    // A video has its own controls (play/seek) to drag-swipe/pinch past
    // without hijacking every pointer-down on it — same reason it skips the
    // click-to-close/swipe/zoom handling entirely below.
    if (isVideo || isDoc) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2) {
      // Second finger landed — this becomes a pinch, not a pan/swipe.
      isPanning.current = false;
      setDragging(false);
      const [p1, p2] = [...activePointers.current.values()];
      pinchStart.current = { dist: distanceBetween(p1!, p2!), scale };
      return;
    }

    if (zoomed) {
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    } else if (hasMultiple) {
      setDragging(true);
      dragStartX.current = e.clientX;
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2) {
      const [p1, p2] = [...activePointers.current.values()];
      const dist = distanceBetween(p1!, p2!);
      if (pinchStart.current.dist > 0) {
        setScale(clampScale(pinchStart.current.scale * (dist / pinchStart.current.dist)));
      }
      return;
    }

    if (isPanning.current) {
      setPan({ x: panStart.current.panX + (e.clientX - panStart.current.x), y: panStart.current.panY + (e.clientY - panStart.current.y) });
    } else if (dragging) {
      setDragOffset(e.clientX - dragStartX.current);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLElement>) {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2 && scale <= 1) resetZoom(); // pinched back below 1x
    if (activePointers.current.size > 0) return; // one finger still down mid-pinch

    isPanning.current = false;
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

        {/* +/- buttons for discoverability — double-click, scroll wheel, and
            pinch all zoom too (see the img's own handlers), but none of
            those are obvious just by looking at the screen. Hidden for a
            video/doc, which have no zoom of their own. */}
        {!isVideo && !isDoc && (
          <div
            className="absolute top-4 left-4 flex items-center gap-0.5 rounded-full bg-white/10 p-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => zoomBy(-0.75)}
              disabled={scale <= MIN_SCALE}
              className="h-9 w-9 rounded-full text-white flex items-center justify-center hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              aria-label="ย่อรูป"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-11 text-center text-xs tabular-nums text-white/80 select-none">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => zoomBy(0.75)}
              disabled={scale >= MAX_SCALE}
              className="h-9 w-9 rounded-full text-white flex items-center justify-center hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              aria-label="ขยายรูป"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}

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
            onWheel={handleWheel}
            onDoubleClick={handleDoubleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              // Pan/zoom compose with the swipe-to-next-image offset — at 1x
              // pan is always {0,0} so this collapses to the old
              // translateX-only behavior exactly.
              transform: `translate(${pan.x + dragOffset}px, ${pan.y}px) scale(${scale})`,
              transition: dragging || isPanning.current ? "none" : "transform 200ms ease",
              // "none" while zoomed — the browser's own native pinch/pan
              // would otherwise fight the pointer-based zoom/pan above.
              // "pan-y" at 1x keeps vertical scroll gestures (nothing to
              // scroll here, but this matches the pre-existing behavior)
              // while letting our own handlers own horizontal swipe.
              touchAction: zoomed ? "none" : "pan-y",
            }}
            className={`max-w-[92vw] max-h-[88vh] object-contain select-none ${
              zoomed ? (isPanning.current ? "cursor-grabbing" : "cursor-zoom-out") : hasMultiple ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
            }`}
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
