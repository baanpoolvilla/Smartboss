"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Clock } from "lucide-react";
import { CLOCK_CHANGED_EVENT, clockState } from "@/modules/hr/lib/clock-state";

/**
 * ไอคอน "ลงเวลา" บนหน้าแรก — กดแล้วเปิดหน้าลงเวลา (/clock) ที่มีปุ่มใหญ่ให้กดอีกที
 * (สองแตะโดยตั้งใจ — แตะไอคอนพลาดต้องไม่กลายเป็นลงเวลาไปแล้ว)
 *
 * สี/ข้อความใต้ไอคอนบอกว่าเข้าไปแล้วจะได้กดอะไร: เขียว "เข้างาน" · ส้ม "ออกงาน" (เข้าแล้ว)
 * · เทา "ออกงานแล้ว" — อ่านจาก /api/m/today ตัวเดียวกับหน้าลงเวลาใน LINE Mini App
 *
 * โชว์เฉพาะคนที่ "ต้องลงเวลา": ไม่โชว์เมื่อบัญชีนี้ไม่ได้อยู่ในทะเบียนพนักงาน (NO_EMPLOYMENT — เช่น ผู้ดูแลระบบ)
 * หรืออยู่ในทะเบียนแต่ไม่ได้ผูกกะทำงาน (mustClock = false จาก /api/m/today) · โหลดไม่สำเร็จด้วยเหตุอื่นยังโชว์ไอคอนเฉย ๆ ให้เข้าไปลองได้
 */

export type ClockState =
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

/**
 * จำไว้ในเครื่องด้วย — ปัดแอปทิ้งแล้วเปิดใหม่ หน่วยความจำข้างบนหายหมด ปุ่มเลยหายไปแวบหนึ่ง
 * จนกว่า /api/m/today จะตอบ ("ออกแอปปัดทิ้งเข้ามา มีแปปนึงไม่เห็น")
 * สถานะเข้า/ออกใช้ได้เฉพาะวันเดียวกัน — ข้ามวันแล้วรู้แค่ว่า "คนนี้ต้องลงเวลา" ขึ้นปุ่มกลาง ๆ ไว้ก่อน
 */
const STORAGE_PREFIX = "smartboss:clock-state:";

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function readStoredRaw(userId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userId);
  } catch {
    return null;
  }
}

function parseStored(raw: string | null): ClockState | null {
  try {
    if (!raw) return null;
    const { day, state } = JSON.parse(raw) as { day: string; state: ClockState };
    if (state.kind === "hidden") return state;
    return day === todayKey() ? state : { kind: "unknown" };
  } catch {
    return null;
  }
}

function writeStored(userId: string, state: ClockState) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify({ day: todayKey(), state }));
  } catch {
    // เก็บไม่ได้ (โหมดส่วนตัว ฯลฯ) — แค่กลับไปรอคำตอบเหมือนเดิม
  }
}

/**
 * ยิงถาม /api/m/today ครั้งเดียวต่อรอบ แม้ไอคอนในหน้าแรกกับปุ่มกลางของแถบเมนูล่างจะขอพร้อมกัน
 * (คำขอที่ยังค้างอยู่ใช้ร่วมกัน · เสร็จแล้วรอบถัดไปค่อยถามใหม่)
 * null = ถามไม่สำเร็จด้วยเหตุชั่วคราว
 */
const inflight = new Map<string, Promise<ClockState | null>>();

function loadClockState(userId: string): Promise<ClockState | null> {
  const pending = inflight.get(userId);
  if (pending) return pending;
  const run = (async (): Promise<ClockState | null> => {
    try {
      const response = await fetch("/api/m/today", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as TodayPayload;
      if (!response.ok) return payload.code === "NO_EMPLOYMENT" ? { kind: "hidden" } : { kind: "unknown" };
      if (payload.mustClock === false) return { kind: "hidden" };
      // ตรรกะเดียวกับปุ่มในหน้าลงเวลา (นับสแกนนิ้ว + กะข้ามคืน) — modules/hr/lib/clock-state.ts
      const { open, firstIn, lastOut } = clockState(payload.events ?? [], payload.carriedIn ?? null);
      if (open) return { kind: "out", since: firstIn ? hhmm(firstIn.capturedAt) : "" };
      if (lastOut) return { kind: "done", since: firstIn ? hhmm(firstIn.capturedAt) : null, at: hhmm(lastOut.capturedAt) };
      return { kind: "in" };
    } catch {
      return null;
    } finally {
      inflight.delete(userId);
    }
  })();
  inflight.set(userId, run);
  return run;
}

/** สถานะลงเวลาของวันนี้ — ใช้ทั้งไอคอนในหน้าแรกและปุ่มกลางของแถบเมนูล่าง (HomeBottomNav ใน components/shell/shell.tsx) */
const noopSubscribe = () => () => {};

export function useClockState(userId: string): ClockState {
  const [fetched, setState] = useState<ClockState>(() => lastKnown.get(userId) ?? { kind: "loading" });
  // ยังไม่มีคำตอบ (เพิ่งเปิดแอป) → ใช้ที่จำไว้ในเครื่องไปก่อน
  // useSyncExternalStore: ฝั่งเซิร์ฟเวอร์ไม่มี localStorage (null) แล้วเครื่องค่อยสลับเป็นค่าที่จำไว้ก่อนวาดจอ
  const storedRaw = useSyncExternalStore(
    noopSubscribe,
    () => readStoredRaw(userId),
    () => null,
  );
  const stored = useMemo(() => parseStored(storedRaw), [storedRaw]);
  const state: ClockState = fetched.kind === "loading" && stored ? stored : fetched;

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      loadClockState(userId).then((next) => {
        if (cancelled) return;
        if (next === null) {
          // มีคำตอบเดิมอยู่แล้วก็คงไว้ — เน็ตสะดุดไม่ควรทำให้ไอคอนเปลี่ยนเป็นสีเทา
          if (!lastKnown.has(userId) && !parseStored(readStoredRaw(userId))) setState({ kind: "unknown" });
          return;
        }
        // โหลดพลาดชั่วคราว (unknown) ไม่ทับคำตอบดีที่จำไว้
        if (next.kind !== "unknown") {
          lastKnown.set(userId, next);
          writeStored(userId, next);
        }
        setState(next);
      });
    load();
    // เพิ่งกดลงเวลาในหน้าลงเวลา — แถบล่างอยู่บนจอต่อ ไม่ได้โหลดใหม่ ต้องถามสถานะใหม่เอง
    window.addEventListener(CLOCK_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CLOCK_CHANGED_EVENT, load);
    };
  }, [userId]);

  return state;
}

export function ClockTile({ userId }: { userId: string }) {
  const state = useClockState(userId);
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
    // มือถือ: ซ่อน — ปุ่มกลางของแถบเมนูล่างทำหน้าที่เดียวกันแล้ว ("ถ้ามีล่างแล้วข้างบนไม่มีก็ได้")
    // จอใหญ่ไม่มีแถบล่าง (lg:hidden) เลยยังต้องมีไอคอนนี้
    <Link prefetch={false} href="/clock" className="group hidden flex-col items-center lg:flex">
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
