"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Hand, Minus, Pencil, Plus, Trash2, Type, Undo2, X } from "lucide-react";
import { closeAnnotator, useAnnotatorStore } from "@/lib/annotate/annotate";

/**
 * หน้าต่างวาด/เขียนบนรูปก่อนส่ง — วางไว้ครั้งเดียวที่ Shell เปิดด้วย openAnnotator(file)
 * (ดู lib/annotate/annotate.ts) วาดด้วยเมาส์หรือนิ้ว เขียนข้อความ ย้อนกลับ ล้าง แล้ว "เสร็จ"
 * ได้ไฟล์ใหม่กลับไปแทนรูปเดิมในช่องพิมพ์นั้น
 */

type Op =
  | { kind: "path"; color: string; width: number; points: [number, number][] }
  | { kind: "text"; color: string; size: number; x: number; y: number; text: string };

const COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#111827", "#ffffff"];
const SIZES = [
  { label: "เล็ก", factor: 0.004 },
  { label: "กลาง", factor: 0.008 },
  { label: "ใหญ่", factor: 0.016 },
];
/** รูปใหญ่มาก (กล้องมือถือ 4000px) ย่อลงก่อนวาด — ส่งเร็ว วาดลื่น */
const MAX_EDGE = 2560;
/** ซูมได้สุดกี่เท่าของขนาดพอดีจอ */
const MAX_ZOOM = 6;

/**
 * ปุ่มในหน้าต่างวาดทำงานทันทีที่ยกนิ้ว (pointerup แบบสัมผัส) ไม่รอ click — หลังลากนิ้ววาดบน
 * canvas (touch-action: none) บางครั้ง browser ไม่ส่ง click ตามมา กด "เสร็จ" แล้วไม่ไปไหน
 * เมาส์/คีย์บอร์ดยังใช้ click ตามปกติ — click ที่ตามหลังการแตะไม่เกิน 600ms ถูกข้าม (กันทำซ้ำ)
 */
let lastTouchActivation = 0;
function tap(fn: () => void) {
  return {
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      lastTouchActivation = Date.now();
      fn();
    },
    onClick: () => {
      if (Date.now() - lastTouchActivation < 600) return;
      fn();
    },
  };
}

export function ImageAnnotatorHost() {
  const file = useAnnotatorStore((s) => s.file);
  if (!file) return null;
  return <Annotator key={`${file.name}-${file.size}-${file.lastModified}`} file={file} />;
}

function Annotator({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  // ประวัติแบบภาพรวมทั้งชุด — ย้อน/ทำซ้ำได้ทุกอย่าง (วาด เขียน ย้ายข้อความ ล้าง)
  // past = ชุดก่อนหน้า, redo = ชุดที่เพิ่งย้อนไป (ทำอะไรใหม่แล้วล้างทิ้ง)
  const [hist, setHist] = useState<{ past: Op[][]; ops: Op[]; redo: Op[][] }>({ past: [], ops: [], redo: [] });
  const ops = hist.ops;
  const setOps = (next: Op[] | ((o: Op[]) => Op[])) =>
    setHist((h) => ({ past: [...h.past, h.ops], ops: typeof next === "function" ? next(h.ops) : next, redo: [] }));
  const undo = () =>
    setHist((h) => (h.past.length === 0 ? h : { past: h.past.slice(0, -1), ops: h.past[h.past.length - 1]!, redo: [...h.redo, h.ops] }));
  const redoLast = () =>
    setHist((h) => (h.redo.length === 0 ? h : { past: [...h.past, h.ops], ops: h.redo[h.redo.length - 1]!, redo: h.redo.slice(0, -1) }));
  /** กำลังลากย้ายข้อความ: index ของข้อความ + ระยะห่างจากจุดที่จับ */
  const textDrag = useRef<{ i: number; dx: number; dy: number; x: number; y: number } | null>(null);
  const drawing = useRef<Op | null>(null);
  const [tool, setTool] = useState<"pen" | "text" | "hand">("pen");
  // ซูม/เลื่อนมุมมอง (ไม่กระทบรูปที่บันทึก) — z = เท่าของขนาดพอดีจอ, x/y = เลื่อน (px บนจอ)
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const areaRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number; mid0: { x: number; y: number }; t0: { x: number; y: number } } | null>(null);
  const panDrag = useRef<{ sx: number; sy: number; t0: { x: number; y: number } } | null>(null);
  const [color, setColor] = useState(COLORS[0]!);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [textAt, setTextAt] = useState<{ x: number; y: number; left: number; top: number } | null>(null);
  const [textValue, setTextValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // โหลดรูปจากไฟล์ในเครื่อง
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setImg(image);
    image.onerror = () => setFailed(true);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const scale = img ? Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
  const width = img ? Math.round(img.naturalWidth * scale) : 0;
  const height = img ? Math.round(img.naturalHeight * scale) : 0;
  const longEdge = Math.max(width, height);
  const strokeWidth = Math.max(2, Math.round(longEdge * SIZES[sizeIdx]!.factor));
  const fontSize = Math.max(14, Math.round(longEdge * SIZES[sizeIdx]!.factor * 4));

  // วาดใหม่ทั้งหมดทุกครั้งที่เปลี่ยน (ย้อนกลับ = ตัด op สุดท้ายแล้ววาดใหม่)
  function redraw(extra?: Op | null) {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const td = textDrag.current;
    const shown = td ? ops.map((op, i) => (i === td.i && op.kind === "text" ? { ...op, x: td.x, y: td.y } : op)) : ops;
    for (const op of extra ? [...shown, extra] : shown) drawOp(ctx, op);
  }

  /** ข้อความที่อยู่ใต้จุด (x, y บนรูป) — หาจากบนสุดลงมา คืน index หรือ -1 */
  function textAtPoint(x: number, y: number): number {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return -1;
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i]!;
      if (op.kind !== "text") continue;
      ctx.font = `bold ${op.size}px "Noto Sans Thai", "Segoe UI", sans-serif`;
      const w = ctx.measureText(op.text).width;
      const pad = op.size * 0.35;
      if (x >= op.x - pad && x <= op.x + w + pad && y >= op.y - op.size / 2 - pad && y <= op.y + op.size / 2 + pad) return i;
    }
    return -1;
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => redraw(), [img, ops]);

  // Esc = ยกเลิก
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !textAt) closeAnnotator(null);
      if (textAt || !(e.ctrlKey || e.metaKey)) return;
      // ดูตำแหน่งปุ่ม (e.code) ไม่ใช่ตัวอักษร — แป้นภาษาไทย ปุ่ม Z ส่ง e.key = "ผ"
      if (e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey)) {
        e.preventDefault();
        redoLast();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [textAt]);

  function toCanvas(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * width, ((e.clientY - rect.top) / rect.height) * height];
  }

  /** ซูมโดยให้จุด (px, py) บนจอค้างอยู่ที่เดิม — ลูกกลิ้ง/ทัชแพด/ปุ่ม +/- */
  function zoomAt(px: number, py: number, nextZ: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const v = viewRef.current;
    const z = Math.min(MAX_ZOOM, Math.max(1, nextZ));
    if (z === 1) {
      setView({ z: 1, x: 0, y: 0 });
      return;
    }
    const r = canvas.getBoundingClientRect();
    const k = z / v.z;
    setView({ z, x: v.x + (px - (r.left + r.width / 2)) * (1 - k), y: v.y + (py - (r.top + r.height / 2)) * (1 - k) });
  }
  function zoomBy(factor: number) {
    const a = areaRef.current?.getBoundingClientRect();
    if (a) zoomAt(a.left + a.width / 2, a.top + a.height / 2, viewRef.current.z * factor);
  }

  // ลูกกลิ้งเมาส์ / ถ่างนิ้วบนทัชแพด (= wheel + ctrlKey) = ซูม — passive:false ถึงกันหน้าเว็บซูมตามได้
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, viewRef.current.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  function overCanvas(e: { clientX: number; clientY: number }): boolean {
    const r = canvasRef.current?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }
  function twoPointers() {
    return [...pointers.current.values()].slice(0, 2) as [{ x: number; y: number }, { x: number; y: number }];
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!img) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* บางเครื่องไม่ยอม — ไม่เป็นไร */
    }
    // สองนิ้ว = ซูม/เลื่อน — ทิ้งเส้นที่นิ้วแรกเพิ่งเริ่มลาก (ไม่ได้ตั้งใจวาด)
    if (pointers.current.size === 2) {
      drawing.current = null;
      redraw();
      panDrag.current = null;
      const [a, b] = twoPointers();
      pinch.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        z0: viewRef.current.z,
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        t0: { x: viewRef.current.x, y: viewRef.current.y },
      };
      return;
    }
    if (pointers.current.size > 2) return;
    // เครื่องมือ "เลื่อน" หรือปุ่มกลางเมาส์ = ลากเลื่อนรูป
    if (tool === "hand" || e.button === 1) {
      panDrag.current = { sx: e.clientX, sy: e.clientY, t0: { x: viewRef.current.x, y: viewRef.current.y } };
      return;
    }
    if (!overCanvas(e)) return;
    // จับที่ข้อความที่เขียนไว้แล้ว = ลากย้าย (ทั้งตอนใช้ปากกาและข้อความ)
    {
      const [px, py] = toCanvas(e);
      const hit = textAtPoint(px, py);
      if (hit >= 0) {
        e.preventDefault();
        if (textAt) commitText();
        const op = ops[hit] as Extract<Op, { kind: "text" }>;
        textDrag.current = { i: hit, dx: px - op.x, dy: py - op.y, x: op.x, y: op.y };
        return;
      }
    }
    if (tool === "text") {
      // กันคลิกบนรูปดึงโฟกัสออกจากช่องพิมพ์ที่เพิ่งโผล่ (ไม่งั้นช่องหายทันทีก่อนพิมพ์ได้)
      e.preventDefault();
      if (textAt) commitText();
      const [x, y] = toCanvas(e);
      setTextAt({ x, y, left: e.clientX, top: e.clientY });
      setTextValue("");
      return;
    }
    drawing.current = { kind: "path", color, width: strokeWidth, points: [toCanvas(e)] };
    redraw(drawing.current);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && pointers.current.size >= 2) {
      const [a, b] = twoPointers();
      const z = Math.min(MAX_ZOOM, Math.max(1, pz.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pz.d0)));
      if (z === 1) {
        setView({ z: 1, x: 0, y: 0 });
        return;
      }
      // ซูมรอบจุดกึ่งกลางนิ้วตอนเริ่ม แล้วเลื่อนตามที่นิ้วขยับ
      const r = canvasRef.current!.getBoundingClientRect();
      const v = viewRef.current;
      const c0x = r.left + r.width / 2 - v.x + pz.t0.x;
      const c0y = r.top + r.height / 2 - v.y + pz.t0.y;
      const k = z / pz.z0;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      setView({
        z,
        x: pz.t0.x + (pz.mid0.x - c0x) * (1 - k) + (mx - pz.mid0.x),
        y: pz.t0.y + (pz.mid0.y - c0y) * (1 - k) + (my - pz.mid0.y),
      });
      return;
    }
    const pd = panDrag.current;
    if (pd) {
      setView((v) => ({ ...v, x: pd.t0.x + (e.clientX - pd.sx), y: pd.t0.y + (e.clientY - pd.sy) }));
      return;
    }
    const td = textDrag.current;
    if (td) {
      const [px, py] = toCanvas(e);
      td.x = px - td.dx;
      td.y = py - td.dy;
      redraw();
      return;
    }
    const op = drawing.current;
    if (!op || op.kind !== "path") return;
    op.points.push(toCanvas(e));
    redraw(op);
  }
  // เก็บเส้นทุกทางที่นิ้ว/เมาส์หลุด — มือถือบางครั้งส่ง pointercancel / lostpointercapture
  // แทน pointerup เส้นที่เห็นบนจอเลยไม่ถูกเก็บ กดเสร็จแล้วได้รูปเดิม
  function onPointerUp(e?: React.PointerEvent<HTMLDivElement>) {
    if (e) pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      return; // ยกนิ้วหลังซูม ไม่ได้เริ่มวาดต่อ
    }
    panDrag.current = null;
    const td = textDrag.current;
    if (td) {
      textDrag.current = null;
      const moved = ops[td.i];
      if (moved?.kind === "text" && (moved.x !== td.x || moved.y !== td.y)) {
        setOps((o) => o.map((op, i) => (i === td.i && op.kind === "text" ? { ...op, x: td.x, y: td.y } : op)));
      } else {
        redraw();
      }
      return;
    }
    const op = drawing.current;
    drawing.current = null;
    if (op) setOps((o) => [...o, op]);
  }

  function commitText() {
    if (textAt && textValue.trim()) {
      setOps((o) => [...o, { kind: "text", color, size: fontSize, x: textAt.x, y: textAt.y, text: textValue.trim() }]);
    }
    setTextAt(null);
    setTextValue("");
  }

  // บันทึกรูปที่วาดแล้วลงเครื่อง — หน้าต่างยังเปิดอยู่ วาดต่อหรือกด "เสร็จ" ได้ตามปกติ
  async function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.92));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.name.replace(/\.[^.]+$/, "") || "image"}-edited.${type === "image/png" ? "png" : "jpg"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pending = drawing.current; // เส้นที่ยังไม่ถูกเก็บ (นิ้วยังไม่หลุดตามปกติ)
    drawing.current = null;
    if (pending) {
      redraw(pending);
      setOps((o) => [...o, pending]);
    }
    if (ops.length === 0 && !pending && scale === 1) {
      closeAnnotator(null); // ไม่ได้วาดอะไร — ใช้รูปเดิม
      return;
    }
    setSaving(true);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
    setSaving(false);
    if (!blob) {
      closeAnnotator(null);
      return;
    }
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    const ext = type === "image/png" ? "png" : "jpg";
    closeAnnotator(new File([blob], `${base}-edited.${ext}`, { type }));
  }

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="วาด/เขียนบนรูป">
      {/* แถบเครื่องมือ */}
      <div className="flex flex-wrap items-center gap-2 bg-(--bg) px-3 py-2" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <button
          type="button"
          {...tap(() => closeAnnotator(null))}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-(--ink-soft) hover:bg-(--bg-soft)"
        >
          <X className="h-4 w-4" /> ยกเลิก
        </button>
        <span className="mx-1 h-6 w-px bg-(--line)" />
        <ToolButton active={tool === "pen"} onClick={() => setTool("pen")} label="ปากกา" icon={<Pencil className="h-4 w-4" />} />
        <ToolButton active={tool === "text"} onClick={() => setTool("text")} label="ข้อความ" icon={<Type className="h-4 w-4" />} />
        <ToolButton active={tool === "hand"} onClick={() => setTool("hand")} label="เลื่อน" icon={<Hand className="h-4 w-4" />} />
        <div className="flex items-center rounded-lg border border-(--line)" role="group" aria-label="ซูม">
          <button type="button" {...tap(() => zoomBy(1 / 1.25))} disabled={view.z <= 1} aria-label="ซูมออก" className="px-2 py-1.5 text-(--ink-soft) disabled:opacity-40">
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" {...tap(() => setView({ z: 1, x: 0, y: 0 }))} title="พอดีจอ" className="min-w-12 px-1 py-1.5 text-xs tabular-nums text-(--ink)">
            {Math.round(view.z * 100)}%
          </button>
          <button type="button" {...tap(() => zoomBy(1.25))} disabled={view.z >= MAX_ZOOM} aria-label="ซูมเข้า" className="px-2 py-1.5 text-(--ink-soft) disabled:opacity-40">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <span className="mx-1 h-6 w-px bg-(--line)" />
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="สี">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`สี ${c}`}
              {...tap(() => setColor(c))}
              className="h-6 w-6 rounded-full border-2 transition-transform"
              style={{ backgroundColor: c, borderColor: color === c ? "var(--ink)" : "var(--line)", transform: color === c ? "scale(1.15)" : undefined }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="ขนาด">
          {SIZES.map((s, i) => (
            <button
              key={s.label}
              type="button"
              role="radio"
              aria-checked={sizeIdx === i}
              {...tap(() => setSizeIdx(i))}
              className={`rounded-md px-2 py-1 text-xs ${sizeIdx === i ? "bg-(--ink) text-(--bg)" : "text-(--ink-soft) hover:bg-(--bg-soft)"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="mx-1 h-6 w-px bg-(--line)" />
        <button
          type="button"
          {...tap(undo)}
          disabled={hist.past.length === 0}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-(--ink-soft) hover:bg-(--bg-soft) disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" /> ย้อน
        </button>
        <button
          type="button"
          {...tap(() => setOps([]))}
          disabled={ops.length === 0}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-(--ink-soft) hover:bg-(--bg-soft) disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" /> ล้าง
        </button>
        <button
          type="button"
          {...tap(() => void download())}
          disabled={!img}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-(--line) px-3 py-1.5 text-sm text-(--ink) hover:bg-(--bg-soft) disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> บันทึกลงเครื่อง
        </button>
        <button
          type="button"
          {...tap(() => void save())}
          disabled={!img || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-(--brand-green) px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Check className="h-4 w-4" /> {saving ? "กำลังบันทึก…" : "เสร็จ"}
        </button>
      </div>

      {/* พื้นที่วาด */}
      <div
        ref={areaRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
        style={{ touchAction: "none", cursor: tool === "hand" ? "grab" : tool === "text" ? "text" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
      >
        {failed ? (
          <p className="text-sm text-white">เปิดรูปนี้ไม่ได้</p>
        ) : !img ? (
          <p className="text-sm text-white/70">กำลังเปิดรูป…</p>
        ) : (
          <div className="relative max-h-full max-w-full">
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              className="block max-h-[calc(100dvh-9rem)] max-w-full bg-white shadow-2xl"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
                transformOrigin: "center center",
                willChange: "transform",
              }}
            />
            {textAt && (
              <input
                autoFocus
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) commitText();
                  if (e.key === "Escape") setTextAt(null);
                }}
                onBlur={commitText}
                placeholder="พิมพ์ข้อความ แล้วกด Enter"
                className="fixed z-10 min-w-40 rounded border-2 bg-white/90 px-1.5 py-0.5 text-sm outline-none"
                style={{ left: textAt.left, top: textAt.top - 14, borderColor: color, color: color === "#ffffff" ? "#111827" : color }}
              />
            )}
          </div>
        )}
      </div>
      <p className="pb-2 text-center text-xs text-white/60" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        {tool === "pen" ? "ลากเพื่อวาด/วง" : tool === "text" ? "แตะบนรูปตรงที่จะเขียนข้อความ" : "ลากเพื่อเลื่อนรูป"} · ซูม: ลูกกลิ้ง / ถ่าง 2 นิ้ว · Ctrl+Z ย้อน · Ctrl+Y ทำซ้ำ
      </p>
    </div>
  );
}

function ToolButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...tap(onClick)}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm ${active ? "bg-(--ink) text-(--bg)" : "text-(--ink-soft) hover:bg-(--bg-soft)"}`}
    >
      {icon} {label}
    </button>
  );
}

function drawOp(ctx: CanvasRenderingContext2D, op: Op) {
  if (op.kind === "path") {
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const [first, ...rest] = op.points;
    if (!first) return;
    ctx.moveTo(first[0], first[1]);
    if (rest.length === 0) ctx.lineTo(first[0] + 0.1, first[1] + 0.1);
    for (const [x, y] of rest) ctx.lineTo(x, y);
    ctx.stroke();
    return;
  }
  ctx.font = `bold ${op.size}px "Noto Sans Thai", "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  // ขอบตัวหนังสือสีตรงข้าม — อ่านออกทั้งบนพื้นสว่างและพื้นมืด
  ctx.lineWidth = Math.max(2, op.size / 7);
  ctx.strokeStyle = op.color === "#ffffff" || op.color === "#facc15" ? "#111827" : "#ffffff";
  ctx.strokeText(op.text, op.x, op.y);
  ctx.fillStyle = op.color;
  ctx.fillText(op.text, op.x, op.y);
}

/** ปุ่มปากกาเล็ก ๆ วางทับมุมรูปที่แนบ — กดแล้วเปิดหน้าต่างวาด */
export function AnnotateButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-label="วาด/เขียนบนรูปนี้"
      title="วาด/เขียนบนรูปนี้"
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 ${className}`}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}
