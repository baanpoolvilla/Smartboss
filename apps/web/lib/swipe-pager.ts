"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ปัดดูรูปทีละรูปแบบแอปรูปในมือถือ — ใช้ร่วมกันทุกหน้าดูรูปเต็มจอ
 *
 * - รูปก่อน/ถัดไปวางรอไว้ข้าง ๆ (โหลดล่วงหน้า) — ปัดแล้วไม่กระพริบ
 * - รูปเลื่อนตามนิ้ว/เมาส์ทันที ปล่อยแล้วเลื่อนต่อจนสุด (หรือเด้งกลับถ้าปัดไม่ถึง)
 * - สะบัดเร็ว ๆ สั้น ๆ ก็ไปรูปถัดไปได้ · ปัดแนวตั้งไม่นับ · สุดทางแล้วยืดหนืด ๆ
 * - ปุ่มลูกศร/คีย์บอร์ดเรียก go() เลื่อนแบบเดียวกัน · ทัชแพดปัดสองนิ้วแนวนอนก็ได้
 *
 * วิธีใช้: ผูก handler ทั้งหลาย + viewportRef ไว้ที่กรอบ (overflow-hidden), track ข้างในใช้ trackStyle,
 * แล้ววาด slides แต่ละอันเป็น absolute inset-0 ด้วย slideStyle(rel)
 */

const GAP = 16;
const DURATION = 280;
const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

export type PagerSlide = { key: number; index: number; rel: -1 | 0 | 1 };

type Drag = {
  id: number;
  x0: number;
  y0: number;
  axis: "x" | "y" | null;
  px: number;
  pt: number;
  vx: number;
};

const mod = (n: number, c: number) => ((n % c) + c) % c;

export function useSwipePager({
  count,
  index,
  onIndexChange,
  loop = false,
  enabled = true,
}: {
  count: number;
  index: number;
  onIndexChange: (i: number) => void;
  /** รูปสุดท้าย → รูปแรก */
  loop?: boolean;
  /** false = ไม่รับการปัด (เช่น ตอนซูมรูปอยู่) */
  enabled?: boolean;
}) {
  // v = ตำแหน่งแบบไม่วน (ใช้เป็น key ของสไลด์ ให้ DOM รูปเดิมอยู่ต่อหลังเลื่อน) · synced = index ล่าสุดที่รู้
  const [pos, setPos] = useState({ v: index, synced: index });
  if (pos.synced !== index) setPos({ v: index, synced: index }); // กระโดดจากข้างนอก (กดรูปย่อ)
  const [offset, setOffset] = useState(0);
  const [animate, setAnimate] = useState(false);

  // กรอบเก็บเป็น state (callback ref) ไม่ใช่ useRef — ให้ส่งออกไปใช้ใน JSX ได้โดย lint ไม่ฟ้อง
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Set<number>());
  const suppressClick = useRef(false);
  const wheel = useRef({ acc: 0, until: 0 });
  const latest = useRef({ v: pos.v, count, loop, onIndexChange });
  useEffect(() => {
    latest.current = { v: pos.v, count, loop, onIndexChange };
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function canGo(dir: 1 | -1): boolean {
    const { v, count: c, loop: l } = latest.current;
    if (c < 2) return false;
    const i = mod(v, c);
    return l || (dir === 1 ? i < c - 1 : i > 0);
  }

  /** เลื่อนไปรูปถัดไป (1) / ก่อนหน้า (-1) แบบมีแอนิเมชัน */
  function go(dir: 1 | -1) {
    if (busy.current) return;
    setAnimate(true);
    if (!canGo(dir)) {
      setOffset(0);
      return;
    }
    busy.current = true;
    const w = (viewport?.clientWidth ?? window.innerWidth) + GAP;
    setOffset(-dir * w);
    timer.current = setTimeout(() => {
      busy.current = false;
      const nv = latest.current.v + dir;
      const ni = mod(nv, latest.current.count);
      // ทั้งหมดนี้ render รอบเดียว — สไลด์ย้ายตำแหน่งพร้อม offset กลับเป็น 0 ไม่เห็นกระตุก
      setAnimate(false);
      setOffset(0);
      setPos({ v: nv, synced: ni });
      latest.current.onIndexChange(ni);
    }, DURATION);
  }

  function snapBack() {
    setAnimate(true);
    setOffset(0);
  }

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    pointers.current.add(e.pointerId);
    suppressClick.current = false;
    if (pointers.current.size > 1) {
      // นิ้วที่สองลง = ถ่างซูม ไม่ใช่ปัด
      if (drag.current?.axis === "x") snapBack();
      drag.current = null;
      return;
    }
    if (!enabled || busy.current || latest.current.count < 2) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // วิดีโอ (แถบเลื่อนเวลา) / pdf / ปุ่ม — ปล่อยให้ทำงานของมันเอง
    if (
      (e.target as HTMLElement).closest(
        "video, iframe, button, a, input, textarea, [data-no-swipe]",
      )
    )
      return;
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      axis: null,
      px: e.clientX,
      pt: e.timeStamp,
      vx: 0,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "y") {
        drag.current = null;
        return;
      }
      setAnimate(false);
      if (e.target === e.currentTarget) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* บางเครื่องไม่ยอม — ไม่เป็นไร */
        }
      }
    }
    const dt = e.timeStamp - d.pt;
    if (dt > 0) d.vx = (e.clientX - d.px) / dt;
    d.px = e.clientX;
    d.pt = e.timeStamp;
    // สุดทางแล้ว: ยืดได้นิดเดียว (หนืด) ให้รู้ว่าไม่มีรูปต่อ
    setOffset(canGo(dx > 0 ? -1 : 1) ? dx : dx * 0.3);
  }

  function onPointerUp(e: React.PointerEvent<HTMLElement>) {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.axis !== "x") return;
    suppressClick.current = true; // ปัดจบแล้วอย่าให้นับเป็นคลิก (คลิกพื้นหลัง = ปิด)
    const dx = e.clientX - d.x0;
    const w = viewport?.clientWidth ?? window.innerWidth;
    const vx = e.timeStamp - d.pt > 80 ? 0 : d.vx; // หยุดนิ่งก่อนยกนิ้ว = ไม่ใช่สะบัด
    const flick =
      Math.abs(vx) > 0.45 &&
      Math.abs(dx) > 24 &&
      Math.sign(vx) === Math.sign(dx);
    if (dx < 0 && (dx < -w * 0.2 || flick)) go(1);
    else if (dx > 0 && (dx > w * 0.2 || flick)) go(-1);
    else snapBack();
  }

  function onClickCapture(e: React.MouseEvent) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  }

  // ทัชแพดปัดสองนิ้วแนวนอน — กันแรงเฉื่อยของทัชแพดพาข้ามไปหลายรูป
  function onWheel(e: React.WheelEvent) {
    if (!enabled || e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY))
      return;
    const w = wheel.current;
    if (busy.current || e.timeStamp < w.until) return;
    w.acc += e.deltaX;
    if (Math.abs(w.acc) > 60) {
      go(w.acc > 0 ? 1 : -1);
      w.acc = 0;
      w.until = e.timeStamp + 600;
    }
  }

  const slides: PagerSlide[] = [];
  if (count > 0) {
    const i = mod(pos.v, count);
    for (const rel of [-1, 0, 1] as const) {
      if (
        rel !== 0 &&
        (count < 2 || (!loop && (i + rel < 0 || i + rel >= count)))
      )
        continue;
      slides.push({ key: pos.v + rel, index: mod(pos.v + rel, count), rel });
    }
  }

  return {
    /** ใส่เป็น ref ของกรอบ */
    viewportRef: setViewport,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onClickCapture,
    onWheel,
    trackStyle: {
      transform: `translate3d(${offset}px, 0, 0)`,
      transition: animate ? `transform ${DURATION}ms ${EASE}` : "none",
      willChange: "transform",
    } as React.CSSProperties,
    slides,
    go,
  };
}

/** ตำแหน่งของสไลด์ข้าง ๆ (-1 ซ้าย, 1 ขวา) */
export function slideStyle(rel: -1 | 0 | 1): React.CSSProperties {
  return { transform: rel === 0 ? undefined : `translate3d(calc(${rel * 100}% + ${rel * GAP}px), 0, 0)` };
}
