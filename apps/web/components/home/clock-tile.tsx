"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { clockState } from "@/modules/hr/lib/clock-state";

/**
 * ไอคอน "ลงเวลา" บนหน้าแรก — กดแล้วเปิดหน้าลงเวลา (/hr/clock) ที่มีปุ่มใหญ่ให้กดอีกที
 * (สองแตะโดยตั้งใจ — แตะไอคอนพลาดต้องไม่กลายเป็นลงเวลาไปแล้ว)
 *
 * สี/ข้อความใต้ไอคอนบอกว่าเข้าไปแล้วจะได้กดอะไร: เขียว "เข้างาน" · ส้ม "ออกงาน" (เข้าแล้ว)
 * · เทา "ออกงานแล้ว" — อ่านจาก /api/m/today ตัวเดียวกับหน้าลงเวลาใน LINE Mini App
 *
 * โชว์เฉพาะคนที่ "ต้องลงเวลา": ไม่โชว์เมื่อบัญชีนี้ไม่ได้อยู่ในทะเบียนพนักงาน (NO_EMPLOYMENT — เช่น ผู้ดูแลระบบ)
 * หรืออยู่ในทะเบียนแต่ไม่ได้ผูกกะทำงาน (mustClock = false จาก /api/m/today) · โหลดไม่สำเร็จด้วยเหตุอื่นยังโชว์ไอคอนเฉย ๆ ให้เข้าไปลองได้
 */

type ClockState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "unknown" }
  | { kind: "in" }
  | { kind: "out"; since: string }
  | { kind: "done"; since: string | null; at: string };

interface TodayPayload {
  code?: string;
  events?: { capturedAt: string; intent: string }[];
  carriedIn?: { capturedAt: string; intent: string } | null;
  /** false = อยู่ในทะเบียนพนักงานแต่ไม่ได้ผูกกะ (ไม่ต้องลงเวลา) — ไม่โชว์ไอคอน */
  mustClock?: boolean;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

/**
 * คำตอบล่าสุดของแต่ละคน (จำในหน้าต่างนี้) — กลับมาหน้าแรกแล้วไอคอนขึ้นทันทีเหมือนเดิม แล้วค่อยอัปเดตเงียบ ๆ
 * เดิมเริ่มจาก "ยังไม่รู้" ทุกครั้งที่เปิดหน้าแรก ไอคอนเลยหายไปแวบหนึ่งแล้วโผล่ ดันไอคอนอื่นขยับไปมา
 * (ผูกกับ userId — สลับบัญชีในหน้าต่างเดิมต้องไม่เห็นของคนก่อน)
 */
const lastKnown = new Map<string, ClockState>();

export function ClockTile({ userId }: { userId: string }) {
  const [state, setStateRaw] = useState<ClockState>(() => lastKnown.get(userId) ?? { kind: "loading" });
  const setState = (next: ClockState) => {
    // โหลดพลาดชั่วคราว (unknown) ไม่ทับคำตอบดีที่จำไว้
    if (next.kind !== "unknown") lastKnown.set(userId, next);
    setStateRaw(next);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/m/today", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as TodayPayload;
        if (cancelled) return;
        if (!response.ok) {
          setState(payload.code === "NO_EMPLOYMENT" ? { kind: "hidden" } : { kind: "unknown" });
          return;
        }
        if (payload.mustClock === false) {
          setState({ kind: "hidden" });
          return;
        }
        // ตรรกะเดียวกับปุ่มในหน้าลงเวลา (นับสแกนนิ้ว + กะข้ามคืน) — modules/hr/lib/clock-state.ts
        const { open, firstIn, lastOut } = clockState(payload.events ?? [], payload.carriedIn ?? null);
        if (open) setState({ kind: "out", since: firstIn ? hhmm(firstIn.capturedAt) : "" });
        else if (lastOut) setState({ kind: "done", since: firstIn ? hhmm(firstIn.capturedAt) : null, at: hhmm(lastOut.capturedAt) });
        else setState({ kind: "in" });
      } catch {
        // มีคำตอบเดิมอยู่แล้วก็คงไว้ — เน็ตสะดุดไม่ควรทำให้ไอคอนเปลี่ยนเป็นสีเทา
        if (!cancelled && !lastKnown.has(userId)) setState({ kind: "unknown" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // setState เป็นฟังก์ชันธรรมดาที่อ้าง userId ตัวเดียวกับ dependency ข้างล่าง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ยังไม่รู้ว่าต้องลงเวลาไหม = ยังไม่โชว์ — ไม่ให้คนที่ไม่ต้องลงเห็นไอคอนแวบขึ้นมาแล้วหายไป
  if (state.kind === "hidden" || state.kind === "loading") return null;

  const look =
    state.kind === "in"
      ? { bg: "var(--tone-ok, #16a34a)", label: "เข้างาน", sub: "ยังไม่ลงเวลา" }
      : state.kind === "out"
        ? { bg: "var(--tone-warn, #ea580c)", label: "ออกงาน", sub: `เข้า ${state.since}` }
        : state.kind === "done"
          ? { bg: "var(--ink-soft)", label: "ลงเวลาแล้ว", sub: state.since ? `${state.since}–${state.at}` : `ออก ${state.at}` }
          : { bg: "var(--ink-soft)", label: "ลงเวลา", sub: "" };

  return (
    <Link prefetch={false} href="/hr/clock" className="group flex flex-col items-center">
      <span
        className="relative flex h-[80px] w-[80px] items-center justify-center rounded-[26px] shadow-(--shadow-card) ring-1 ring-black/[0.04] transition-transform duration-150 group-hover:-translate-y-0.5 group-active:scale-95 sm:h-[92px] sm:w-[92px]"
        style={{ backgroundColor: look.bg }}
      >
        <Clock className="h-9 w-9 text-white sm:h-11 sm:w-11" />
      </span>
      <span className="mt-2 text-center text-[13px] font-semibold text-(--ink)">{look.label}</span>
      {look.sub && <span className="text-[11px] tabular-nums text-(--ink-soft)">{look.sub}</span>}
    </Link>
  );
}
