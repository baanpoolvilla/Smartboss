"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Pencil, Trash2, Type, Undo2, X } from "lucide-react";
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

export function ImageAnnotatorHost() {
  const file = useAnnotatorStore((s) => s.file);
  if (!file) return null;
  return <Annotator key={`${file.name}-${file.size}-${file.lastModified}`} file={file} />;
}

function Annotator({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  // ประวัติวาด: ops = ที่เห็นอยู่, redo = ที่เพิ่งย้อนไป (Ctrl+Y คืนได้ วาดใหม่แล้วล้างทิ้ง)
  const [hist, setHist] = useState<{ ops: Op[]; redo: Op[] }>({ ops: [], redo: [] });
  const ops = hist.ops;
  const setOps = (next: Op[] | ((o: Op[]) => Op[])) =>
    setHist((h) => ({ ops: typeof next === "function" ? next(h.ops) : next, redo: [] }));
  const undo = () =>
    setHist((h) => (h.ops.length === 0 ? h : { ops: h.ops.slice(0, -1), redo: [...h.redo, h.ops[h.ops.length - 1]!] }));
  const redoLast = () =>
    setHist((h) => (h.redo.length === 0 ? h : { ops: [...h.ops, h.redo[h.redo.length - 1]!], redo: h.redo.slice(0, -1) }));
  const drawing = useRef<Op | null>(null);
  const [tool, setTool] = useState<"pen" | "text">("pen");
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
    for (const op of extra ? [...ops, extra] : ops) drawOp(ctx, op);
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

  function toCanvas(e: React.PointerEvent): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * width, ((e.clientY - rect.top) / rect.height) * height];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!img) return;
    if (tool === "text") {
      // กันคลิกบนรูปดึงโฟกัสออกจากช่องพิมพ์ที่เพิ่งโผล่ (ไม่งั้นช่องหายทันทีก่อนพิมพ์ได้)
      e.preventDefault();
      if (textAt) commitText();
      const [x, y] = toCanvas(e);
      const rect = canvasRef.current!.getBoundingClientRect();
      setTextAt({ x, y, left: e.clientX - rect.left, top: e.clientY - rect.top });
      setTextValue("");
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { kind: "path", color, width: strokeWidth, points: [toCanvas(e)] };
    redraw(drawing.current);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const op = drawing.current;
    if (!op || op.kind !== "path") return;
    op.points.push(toCanvas(e));
    redraw(op);
  }
  function onPointerUp() {
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
    if (ops.length === 0 && scale === 1) {
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
    <div className="fixed inset-0 z-[1000] flex flex-col bg-black/85" role="dialog" aria-modal="true" aria-label="วาด/เขียนบนรูป">
      {/* แถบเครื่องมือ */}
      <div className="flex flex-wrap items-center gap-2 bg-(--bg) px-3 py-2" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <button
          type="button"
          onClick={() => closeAnnotator(null)}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-(--ink-soft) hover:bg-(--bg-soft)"
        >
          <X className="h-4 w-4" /> ยกเลิก
        </button>
        <span className="mx-1 h-6 w-px bg-(--line)" />
        <ToolButton active={tool === "pen"} onClick={() => setTool("pen")} label="ปากกา" icon={<Pencil className="h-4 w-4" />} />
        <ToolButton active={tool === "text"} onClick={() => setTool("text")} label="ข้อความ" icon={<Type className="h-4 w-4" />} />
        <span className="mx-1 h-6 w-px bg-(--line)" />
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="สี">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`สี ${c}`}
              onClick={() => setColor(c)}
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
              onClick={() => setSizeIdx(i)}
              className={`rounded-md px-2 py-1 text-xs ${sizeIdx === i ? "bg-(--ink) text-(--bg)" : "text-(--ink-soft) hover:bg-(--bg-soft)"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="mx-1 h-6 w-px bg-(--line)" />
        <button
          type="button"
          onClick={undo}
          disabled={ops.length === 0}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-(--ink-soft) hover:bg-(--bg-soft) disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" /> ย้อน
        </button>
        <button
          type="button"
          onClick={() => setOps([])}
          disabled={ops.length === 0}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-(--ink-soft) hover:bg-(--bg-soft) disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" /> ล้าง
        </button>
        <button
          type="button"
          onClick={() => void download()}
          disabled={!img}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-(--line) px-3 py-1.5 text-sm text-(--ink) hover:bg-(--bg-soft) disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> บันทึกลงเครื่อง
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!img || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-(--brand-green) px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Check className="h-4 w-4" /> {saving ? "กำลังบันทึก…" : "เสร็จ"}
        </button>
      </div>

      {/* พื้นที่วาด */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
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
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="block max-h-[calc(100dvh-7rem)] max-w-full bg-white shadow-2xl"
              style={{ touchAction: "none", cursor: tool === "text" ? "text" : "crosshair" }}
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
                className="absolute min-w-40 rounded border-2 bg-white/90 px-1.5 py-0.5 text-sm outline-none"
                style={{ left: textAt.left, top: textAt.top - 14, borderColor: color, color: color === "#ffffff" ? "#111827" : color }}
              />
            )}
          </div>
        )}
      </div>
      <p className="pb-2 text-center text-xs text-white/60" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        {tool === "pen" ? "ลากเพื่อวาด/วงตรงที่ต้องการ" : "แตะบนรูปตรงที่จะเขียนข้อความ"} · Ctrl+Z ย้อน · Ctrl+Y ทำซ้ำ
      </p>
    </div>
  );
}

function ToolButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
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
