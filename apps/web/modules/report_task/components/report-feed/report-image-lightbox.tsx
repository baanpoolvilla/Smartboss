"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/modules/report_task/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import type { ReportPostImage } from "@/modules/report_task/store/report-feed-store";
import { ReportFileChip } from "@/modules/report_task/components/report-feed/report-file-chip";
import { fileKindOf, isDocAttachment, isVideoAttachment } from "@/modules/report_task/lib/report-attachment-kind";
import { getUser } from "@/modules/report_task/lib/directory";
import { formatDateTimeFull, formatDateTimeShort } from "@/modules/report_task/lib/format";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Link2, Minus, Plus, X } from "lucide-react";

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
  imageMeta,
}: {
  images: ReportPostImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** ใครเป็นคนโพสต์รูปนี้ + โพสต์เมื่อไหร่ — โชว์เป็นชิปมุมซ้ายบนแบบ Discord
   * (avatar+ชื่อ+เวลา) เรียกต่อรูป ไม่ใช่ครั้งเดียวต่อ lightbox เพราะบาง caller
   * (แท็บ "ไฟล์" ของห้อง) เปิดหลายรูปจากคนละโพสต์ไว้ในอัลบั้มเดียวกัน — ไม่ใส่
   * มา (undefined) = ไม่โชว์ชิปนี้เลย เหมือนของเดิม (เช่น ไฟล์แนบของงาน Kanban
   * ที่ไม่มีแนวคิด "โพสต์" ให้ผูก). */
  imageMeta?: (image: ReportPostImage, index: number) => { authorId: string; at: string } | null | undefined;
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
      // Ctrl+Plus/Minus/0 is the keyboard route to the same native page-zoom
      // this lightbox otherwise blocks via wheel+ctrlKey below — same reason
      // (a zoomed page drags the fixed toolbar off past the screen edge).
      if (e.ctrlKey && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")) e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [index, images.length, hasMultiple, onIndexChange, onClose]);

  // Block native browser/OS page zoom (Ctrl+wheel — also how Windows/Chrome
  // report trackpad pinch) for as long as this lightbox is open, everywhere
  // inside it, not just over the image itself. Left alone, that zooms the
  // whole PAGE instead of just the picture, and since page zoom rescales
  // where a `position: fixed` element actually lands on screen, the close/
  // zoom/download buttons can end up scrolled past the edge entirely
  // ("หายไปเลยตรง%") — a different, uncontrolled zoom from the in-app
  // scale/pan above the image, which never touches the page itself.
  useEffect(() => {
    function blockPageZoom(e: WheelEvent) {
      if (e.ctrlKey) e.preventDefault();
    }
    window.addEventListener("wheel", blockPageZoom, { passive: false });
    return () => window.removeEventListener("wheel", blockPageZoom);
  }, []);

  const image = images[index];
  if (!image) return null;

  const meta = imageMeta?.(image, index);
  const author = meta ? getUser(meta.authorId) : undefined;

  const imageUrl = image.url;
  function copyImageLink() {
    if (!imageUrl) return; // data: URL (ไฟล์เก่าก่อนย้าย object storage) ไม่มีลิงก์สาธารณะให้คัดลอก
    const href = imageUrl.startsWith("http") ? imageUrl : `${window.location.origin}${imageUrl}`;
    if (!navigator.clipboard) {
      toast.error("คัดลอกลิงก์ไม่สำเร็จ");
      return;
    }
    navigator.clipboard.writeText(href).then(() => toast.success("คัดลอกลิงก์รูปแล้ว")).catch(() => toast.error("คัดลอกลิงก์ไม่สำเร็จ"));
  }

  const isVideo = isVideoAttachment(image.mime);
  const isDoc = isDocAttachment(image.mime);
  // มีแค่ pdf ที่ browser ทุกตัวโชว์เนื้อในได้เองแบบฝังในหน้า (iframe) —
  // word/excel/ppt/zip ไม่มีตัวเรนเดอร์ในตัว ต้องดาวน์โหลดไปเปิดในโปรแกรมจริง
  // อยู่ดี ("มันต้องขึ้นแบบ... กดเข้าไปดูก่อนได้" ใช้ได้จริงแค่กับ pdf)
  const isPreviewablePdf = isDoc && fileKindOf(image.mime ?? "") === "pdf";
  const src = image.url ?? image.dataUrl;
  // ปุ่มดาวน์โหลดจริง (แยกจากการเปิดดู) — ต่อ query ให้ /api/files ตอบกลับ
  // Content-Disposition: attachment แทนที่จะปล่อยให้ browser ตัดสินใจเอง
  // (เดิมกดปุ่มเดียวกันแล้วบาง browser เปิดแท็บใหม่เฉย ๆ ไม่ดาวน์โหลดให้)
  // data: URL (ไฟล์เก่าก่อนย้ายไป object storage) ไม่มี query ให้ต่อ — ใช้
  // download attribute ของ browser เองแทน ซึ่งก็ทำงานได้กับ data: URL อยู่แล้ว
  const downloadHref = image.url ? `${image.url}${image.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(image.name)}` : src;

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
        // touch-action:none on the whole overlay (not just the image) — a
        // pinch that lands with a finger even slightly off the picture (near
        // an edge, or right over a toolbar button) would otherwise still
        // trigger the OS/browser's own native pinch-zoom-the-page gesture,
        // same class of bug the ctrl+wheel guard above stops for
        // trackpad/mouse pinch. The image's own pointer handlers implement
        // pinch-to-zoom themselves already — this only turns off the
        // browser's *default* gesture handling, not our own JS.
        style={{ touchAction: "none" }}
        className="inset-0 top-0 left-0 right-0 bottom-0 translate-x-0 translate-y-0 max-w-none sm:max-w-none w-screen h-screen max-h-screen bg-black/95 border-none ring-0 rounded-none p-0 gap-0 flex items-center justify-center cursor-zoom-out overflow-hidden"
      >
        {/* Discord-style identity chip, top-left — who posted this image and
            when, so the picture doesn't lose its context once it fills the
            whole screen ("อยากได้แบบของ discord เลยอะ"). Purely informational,
            no jump-to-post — `imageMeta` is per-image (not per-lightbox) since
            some callers (the room's "ไฟล์" tab) open an album mixing images
            from several different posts/authors into one lightbox. Omitted
            entirely when the caller has no author to give (e.g. a task's
            attachment lightbox, which has no "post" concept). */}
        {author && (
          <div
            className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full bg-black/40 py-1 pl-1 pr-3"
            onClick={(e) => e.stopPropagation()}
          >
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={author.avatarUrl ?? undefined} alt={author.name} />
              <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{author.avatar}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-start leading-tight">
              <span className="text-[12.5px] font-semibold text-white">{author.name}</span>
              <span className="text-[10px] text-white/60" title={meta ? formatDateTimeFull(meta.at) : undefined}>
                {meta ? formatDateTimeShort(meta.at) : ""}
              </span>
            </div>
          </div>
        )}

        {/* แถบปุ่มรวม มุมขวาบน แบบ Discord — เรียงจากซ้ายไปขวา: ซูม (เฉพาะรูป
            ไม่ใช่วิดีโอ/เอกสาร) · คัดลอกลิงก์ (เฉพาะไฟล์ที่มี url จริง ไม่ใช่
            data: URL เก่า) · ดาวน์โหลด · ปิด — ย้ายปุ่มปิดมาจากมุมซ้ายบนเดิม
            เพื่อเปิดที่ให้ชิปคนโพสต์ด้านซ้าย ("มุมขวาบน" ของจริงใน discord ก็มี
            ปุ่มปิดอยู่ท้ายแถบเดียวกันนี้เหมือนกัน). Zoom %/+/- ของเดิมยังอยู่
            ครบ ไม่ตัดออก แค่ย้ายมารวมพวงเดียวกับปุ่มอื่น. */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {!isVideo && !isDoc && (
            <div className="flex items-center gap-0.5 rounded-full bg-white/10 p-0.5">
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
          {!isVideo && !isDoc && image.url && (
            <button
              onClick={copyImageLink}
              className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              aria-label="คัดลอกลิงก์รูป"
            >
              <Link2 className="h-5 w-5" />
            </button>
          )}
          {!isVideo && !isDoc && (
            <a
              href={downloadHref}
              download={image.url ? undefined : image.name}
              className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              aria-label="ดาวน์โหลด"
            >
              <Download className="h-5 w-5" />
            </a>
          )}
          {/* isDoc (pdf/word/excel/ppt) gets its own close button inside its
              white panel's header below — this white/10-on-black styling
              reads fine over the black backdrop, but a pdf's panel is
              97vw/94vh, leaving barely any backdrop around it, so this
              button ends up sitting on the panel's white background instead
              — a white icon on white is effectively invisible
              ("กากบาทเวลากดเปิดไฟล์และมันไม่ชัดเจนอะ"). */}
          {!isDoc && (
            <button
              onClick={onClose}
              className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              aria-label="ปิด"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {hasMultiple && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index - 1 + images.length) % images.length);
            }}
            className="absolute left-4 top-1/2 z-10 -translate-y-1/2 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
            aria-label="รูปก่อนหน้า"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {isPreviewablePdf ? (
          /* pdf จริงมีตัวเรนเดอร์ในตัว browser เอง — ฝังตรงนี้เลยแทนที่จะ
             บังคับเปิดแท็บใหม่ก่อนถึงจะเห็นเนื้อไฟล์ ("ใน pc มันต้องโหลดก่อน
             ถึงจะดู") ปุ่มดาวน์โหลดยังแยกไว้ต่างหากสำหรับคนที่อยากได้ไฟล์
             ไปเก็บในเครื่องจริง ๆ */
          <div
            onClick={(e) => e.stopPropagation()}
            // เกือบเต็มจอ — ก่อนหน้านี้จำกัดกว้างไว้แค่ 56rem แม้จอกว้างแค่ไหน
            // ทำให้เหลือพื้นที่ดำโล่งซ้ายขวาเยอะทั้งที่เนื้อหาคือเอกสารที่
            // ควรได้พื้นที่อ่านมากสุด ("แสดงให้เต็มหน้าหน่อยสิ")
            className="flex h-[94vh] w-[97vw] cursor-default flex-col overflow-hidden rounded-2xl bg-white"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
              <span className="min-w-0 truncate text-sm font-medium text-[var(--ink)]" title={image.name}>
                {image.name}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={downloadHref}
                  download={image.url ? undefined : image.name}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--brand-green-dark)] hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  ดาวน์โหลด
                </a>
                {/* Dark icon on this panel's own white header — the global
                    black-backdrop close button (white-on-white here) was the
                    "มันไม่ชัดเจน" close button this replaces for pdf/doc panels. */}
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] cursor-pointer"
                  aria-label="ปิด"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* #zoom=page-width — "open parameters" ที่ Chrome/Edge/Firefox
                ตัว viewer ในตัวรองรับ (มาตรฐานเดิมของ Adobe Acrobat) สั่งให้
                เปิดมาแล้วพอดีความกว้างเลย ไม่ต้องมาไล่ซูมเองทุกครั้งที่เปิด
                ("ให้เวลาเปิดมาเริ่มมาแบบจอประมาณนี้เลย อ่านง่าย ไม่ต้องขยาย") */}
            <iframe src={src ? `${src}#zoom=page-width` : src} title={image.name} className="min-h-0 flex-1" />
          </div>
        ) : isDoc && image.thumbUrl ? (
          /* word/excel/ppt ไม่มีตัวเรนเดอร์ live ในตัว browser แต่มี thumbUrl
             (ภาพหน้าแรกจริงที่ server สร้างไว้ตอนอัปโหลด — ดู
             generate-doc-thumbnail.ts) ก็โชว์ภาพนิ่งนั้นขยายใหญ่แทนการ์ด
             ไอคอนเฉย ๆ — ดีกว่าเดิมชัดเจนแม้จะไม่ใช่เอกสารที่เลื่อนดูได้จริง
             แบบ pdf ก็ตาม */
          <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-[min(92vw,32rem)] cursor-default flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
              <span className="min-w-0 truncate text-sm font-medium text-[var(--ink)]" title={image.name}>
                {image.name}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={downloadHref}
                  download={image.url ? undefined : image.name}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--brand-green-dark)] hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  ดาวน์โหลด
                </a>
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] cursor-pointer"
                  aria-label="ปิด"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.thumbUrl} alt={image.name} className="min-h-0 flex-1 object-contain bg-[var(--bg-soft)]" />
          </div>
        ) : isDoc ? (
          /* ไม่มีทั้ง live renderer และ thumbUrl (แปลงไม่สำเร็จ/ไม่ติดตั้ง
             soffice บนเซิร์ฟเวอร์/zip ที่ดูเป็นภาพไม่ได้จริง) — เหลือแค่การ์ด
             ไอคอน + ปุ่มดาวน์โหลดเหมือนเดิม */
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-[min(86vw,26rem)] cursor-default flex-col items-center gap-4 rounded-2xl bg-white px-6 py-7 text-center sm:px-8"
          >
            {/* This card is small enough to leave real backdrop around it, so
                unlike the pdf/thumb panels above it doesn't need its own
                close button purely for contrast — but the global one was
                removed for every isDoc case, so it still needs one of its
                own to stay closeable at all. */}
            <button
              onClick={onClose}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] cursor-pointer"
              aria-label="ปิด"
            >
              <X className="h-4 w-4" />
            </button>
            {/* Width-capped so a long filename truncates inside the card
                instead of stretching it past a phone's screen. */}
            <ReportFileChip media={image} className="w-full border-0 p-0" />
            <a
              href={downloadHref}
              download={image.url ? undefined : image.name}
              className="flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--brand-green-dark)] hover:text-white"
            >
              <Download className="h-4 w-4" />
              ดาวน์โหลดไฟล์
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
            className="absolute right-4 top-1/2 z-10 -translate-y-1/2 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
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
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 flex items-center gap-2.5 max-w-[92vw]"
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
                      <img src={img.url ?? img.dataUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
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
