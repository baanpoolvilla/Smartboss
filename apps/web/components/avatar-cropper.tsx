"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Minus, Plus, X } from "lucide-react";

/**
 * ปรับรูปก่อนตั้งเป็นรูปโปรไฟล์/รูปกลุ่ม — ลากเลื่อนตำแหน่ง · ซูมด้วยแถบเลื่อน ล้อเมาส์ หรือสองนิ้ว
 * ("ตอนนี้คือเลือกแล้วลงเลย บางทีรูปมันใหญ่ไป" ผู้ใช้ 21/10/2569) แล้วตัดเป็นสี่เหลี่ยมจัตุรัส 512px
 * ส่งต่อผ่าน onDone เป็นไฟล์ JPEG ให้ผู้เรียกอัปโหลดตามทางเดิม (ย่อซ้ำได้ ไม่เสียอะไร)
 */
const OUT = 512;
const MAX_ZOOM = 4;

export function AvatarCropper({ file, title = "ปรับรูป", onCancel, onDone }: { file: File; title?: string; onCancel: () => void; onDone: (out: File) => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [stage, setStage] = useState(280);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const measure = () => setStage(Math.min(320, (stageRef.current?.parentElement?.clientWidth ?? 320) - 8));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const baseScale = img ? Math.max(stage / img.naturalWidth, stage / img.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const w = img ? img.naturalWidth * scale : stage;
  const h = img ? img.naturalHeight * scale : stage;

  /** ไม่ให้รูปเลื่อนจนมีช่องว่างในวงกลม */
  const clamp = useCallback((x: number, y: number, ww: number, hh: number) => ({ x: Math.min(0, Math.max(stage - ww, x)), y: Math.min(0, Math.max(stage - hh, y)) }), [stage]);

  // เปิดรูปใหม่ / เปลี่ยนขนาดกรอบ → จัดกลางรูป
  useEffect(() => {
    if (!img) return;
    const s = Math.max(stage / img.naturalWidth, stage / img.naturalHeight);
    setZoom(1);
    setPos({ x: (stage - img.naturalWidth * s) / 2, y: (stage - img.naturalHeight * s) / 2 });
  }, [img, stage]);

  /** ซูมโดยให้จุดกลางกรอบยังชี้ที่เดิมของรูป */
  const zoomTo = useCallback(
    (next: number) => {
      if (!img) return;
      const z = Math.min(MAX_ZOOM, Math.max(1, next));
      const s0 = baseScale * zoom;
      const s1 = baseScale * z;
      const cx = (stage / 2 - pos.x) / s0;
      const cy = (stage / 2 - pos.y) / s0;
      setZoom(z);
      setPos(clamp(stage / 2 - cx * s1, stage / 2 - cy * s1, img.naturalWidth * s1, img.naturalHeight * s1));
    },
    [img, baseScale, zoom, stage, pos, clamp],
  );

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom };
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      zoomTo(pinch.current.zoom * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.current.dist));
      return;
    }
    setPos((p) => clamp(p.x + e.clientX - prev.x, p.y + e.clientY - prev.y, w, h));
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  async function confirm() {
    if (!img) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, OUT, OUT);
      ctx.drawImage(img, -pos.x / scale, -pos.y / scale, stage / scale, stage / scale, 0, 0, OUT, OUT);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
      if (!blob) throw new Error("ตัดรูปไม่สำเร็จ");
      onDone(new File([blob], "avatar.jpg", { type: "image/jpeg" }));
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-t-[20px] bg-(--bg) sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-(--line) px-4 py-3">
          <h2 className="text-base font-bold text-(--ink)">{title}</h2>
          <button type="button" onClick={onCancel} aria-label="ปิด" className="rounded-full p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 px-4 py-4">
          <div
            ref={stageRef}
            className="relative touch-none select-none overflow-hidden rounded-xl bg-slate-900"
            style={{ width: stage, height: stage, cursor: "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: pos.x, top: pos.y, width: w, height: h }} />
            ) : (
              <div className="flex h-full items-center justify-center text-white/70">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
            {/* วงกลม = ส่วนที่จะเห็นเป็นรูปโปรไฟล์ · นอกวงมืดลง */}
            <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(0,0,0,0.5)] ring-2 ring-white/80" />
          </div>
          <p className="text-xs text-(--ink-soft)">ลากเพื่อเลื่อนรูป · ซูมด้วยแถบด้านล่าง ล้อเมาส์ หรือสองนิ้ว</p>
          <div className="flex w-full items-center gap-3">
            <button type="button" aria-label="ซูมออก" onClick={() => zoomTo(zoom - 0.25)} className="rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft)">
              <Minus className="h-4 w-4" />
            </button>
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="ซูม" className="flex-1 accent-(--brand-navy)" />
            <button type="button" aria-label="ซูมเข้า" onClick={() => zoomTo(zoom + 0.25)} className="rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft)">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex gap-2 border-t border-(--line) px-4 py-3">
          <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-xl border border-(--line) text-sm font-medium text-(--ink) hover:bg-(--bg-soft)">
            ยกเลิก
          </button>
          <button type="button" onClick={() => void confirm()} disabled={!img || busy} className="h-11 flex-1 rounded-xl bg-(--brand-navy) text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
            {busy ? "กำลังบันทึก…" : "ใช้รูปนี้"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
