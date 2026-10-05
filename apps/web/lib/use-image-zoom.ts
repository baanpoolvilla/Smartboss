"use client";

import { useRef, useState } from "react";

/**
 * ซูม/เลื่อนรูปในหน้าดูรูปเต็มจอ — ล้อเมาส์, ดับเบิลคลิก/แตะสองครั้ง, ถ่างสองนิ้ว, ลากเลื่อนตอนซูมอยู่
 * พฤติกรรมเดียวกับตัวดูรูปของรายงาน (report-image-lightbox.tsx) เพื่อให้ทุกโมดูลรู้สึกเหมือนกัน
 *
 * ใช้คู่กับตัวปัดเปลี่ยนรูป (lib/swipe-pager.ts): ส่ง `enabled: !zoomed` ให้ตัวปัด — ซูมอยู่ = ลากเลื่อนรูปแทน
 * เปลี่ยนรูปแล้วเรียก reset() (หรือผูก key ของรูป)
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

const clamp = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const centerOf = (el: HTMLElement, x: number, y: number) => {
  const r = el.getBoundingClientRect();
  return { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) };
};

export function useImageZoom() {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomed = scale > 1;
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [panning, setPanning] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef({ dist: 0, scale: 1 });

  function reset() {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  /** center = จุดที่ต้องการให้อยู่นิ่งระหว่างซูม (ตำแหน่งเมาส์) วัดจากกลางรูป — ไม่ส่ง = ซูมจากกลาง */
  function zoomBy(delta: number, center?: { x: number; y: number }) {
    const next = clamp(scale + delta);
    if (next === 1) setPan({ x: 0, y: 0 });
    else if (center) setPan((p) => ({ x: p.x - center.x * (next / scale - 1), y: p.y - center.y * (next / scale - 1) }));
    setScale(next);
  }

  const imageProps = {
    onWheel(e: React.WheelEvent<HTMLElement>) {
      // ทัชแพดปัดสองนิ้วแนวนอน = เปลี่ยนรูป (ตัวปัดที่กรอบรับต่อ) ไม่ใช่ซูม
      if (!e.ctrlKey && !zoomed && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.stopPropagation();
      zoomBy(-e.deltaY * 0.0025 * Math.max(scale, 1), centerOf(e.currentTarget, e.clientX, e.clientY));
    },
    onDoubleClick(e: React.MouseEvent<HTMLElement>) {
      e.stopPropagation();
      if (zoomed) return reset();
      const c = centerOf(e.currentTarget, e.clientX, e.clientY);
      setScale(DOUBLE_TAP_ZOOM);
      setPan({ x: -c.x * (DOUBLE_TAP_ZOOM - 1), y: -c.y * (DOUBLE_TAP_ZOOM - 1) });
    },
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      // ไม่ stopPropagation — ให้ตัวปัดรูปที่กรอบเห็นนิ้วเดียวกันด้วย (นิ้วที่สอง = ซูม มันจะหยุดปัดเอง)
      e.currentTarget.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        setPanning(false);
        const [a, b] = [...pointers.current.values()];
        pinch.current = { dist: dist(a!, b!), scale };
        return;
      }
      if (zoomed) {
        setPanning(true);
        panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      }
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        if (pinch.current.dist > 0) setScale(clamp(pinch.current.scale * (dist(a!, b!) / pinch.current.dist)));
        return;
      }
      if (panning) setPan({ x: panStart.current.panX + (e.clientX - panStart.current.x), y: panStart.current.panY + (e.clientY - panStart.current.y) });
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2 && scale <= 1) reset(); // ถ่างนิ้วกลับจนต่ำกว่า 1x
      if (pointers.current.size > 0) return;
      setPanning(false);
    },
    onPointerCancel(e: React.PointerEvent<HTMLElement>) {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) setPanning(false);
    },
    style: {
      transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
      transition: panning ? "none" : "transform 200ms ease",
      // ซูมอยู่ = เราคุมการลากเอง · 1x = ปล่อยการปัดแนวนอนให้ตัวปัดเปลี่ยนรูป
      touchAction: zoomed ? "none" : "pan-y",
    } as React.CSSProperties,
  };

  return { scale, zoomed, panning, zoomBy, reset, imageProps };
}
