"use client";

import type { WorkOrderScoreChip } from "@/modules/maintenance/data/work-order-score-chips";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useIsMobile } from "@/modules/report_task/hooks/use-is-mobile";
import { ASSIGNED_BY_ME, ASSIGNED_TO_ME, PersonFilter, UNASSIGNED } from "./person-filter";
import { createPortal } from "react-dom";
import Link from "next/link";
import { InitialAvatar, WoCard } from "./wo-card";
import { RefreshCw, ReceiptText, Check, CheckCircle2, Clock, MessageCircle, Search, X } from "lucide-react";
import { useUnreadCommentCounts } from "@/modules/notifications/pending-for-you";
import type { NotifCategory } from "@/modules/notifications/types";
import { groupByPriority } from "@/modules/maintenance/lib/priority";


export interface BoardOrder {
  id: string;
  /** เลขที่ให้คนอ่าน เช่น WO-2569-0001 — ใช้อ้างถึงกันทางโทรศัพท์/LINE */
  code: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  propertyId: string;
  additionalPropertyIds: string[];
  createdBy: string | null;
  /** ผู้ได้รับมอบหมาย (core.users.id) · null = ยังไม่มอบหมาย */
  assignedTo: string | null;
  /** ใบกลุ่ม: คนที่เหลือ */
  groupMemberIds?: string[];
  autoCreated: boolean;
  createdAtLabel: string;
  /** ใช้เรียง "ล่าสุด" บนบอร์ด */
  createdAtIso?: string;
  hasExpense: boolean;
  /**
   * false = ใบงานนี้ตั้งไว้ว่าไม่ต้องกรอกค่าใช้จ่าย (เช่น PM ตรวจเช็คที่ไม่มีของ
   * ต้องซื้อ) ⇒ ปิดงานแล้วถือว่าจบเลย ไม่ต้องรอบันทึกค่าใช้จ่ายก่อน
   */
  requiresExpense: boolean;
  /** ใบรอบ PM (แบบนับรอบ) เท่านั้น — รอบไหน + เหลือ/เลยกี่วัน · ใบอื่นไม่มี การ์ดหน้าตาเดิม */
  pmRound?: { label: string; due: string | null; late: boolean } | null;
  /** ใบส่วนตัว (กันลืม) — เห็นแค่คนเปิดกับ CEO */
  isPrivate?: boolean;
  /** ผูกแผน PM (ป้าย PM บนหัวการ์ด) */
  isPm?: boolean;
  /** กำหนดส่ง — "ครบ 28/11/2569" / "เลยกำหนด 3 วัน" (ใบที่ไม่มีกำหนดส่ง = null) */
  due?: { text: string; late: boolean } | null;
  /** การ์ดแบบการ์ดงาน (wo-card.tsx) */
  dueDateIso?: string | null;
  /** กำหนดบันทึกค่าใช้จ่าย (เปิดใช้แล้ว + ใบรอบันทึก) — lib/expense-deadline.ts */
  expenseDeadlineIso?: string | null;
  /** ยอดค่าใช้จ่ายที่บันทึกแล้ว (เปิดใช้กำหนดบันทึกแล้ว + ใบปิดแล้ว) */
  expenseRecordedTotal?: number | null;
  /** ยังมี PR/PO หรือใบเบิกไม่จบ — ต้นทางจะลงยอดให้เอง ยังไม่เป็นงานของผู้บันทึก */
  expenseHeld?: boolean;
  commentCount?: number;
  photoCount?: number;
  pendingDue?: number;
  /** ป้ายคะแนนแบบการ์ดงาน */
  score?: WorkOrderScoreChip;
  /** ขอเลื่อนเป็นวันไหน (YYYY-MM-DD) เมื่อมีคำขอเดียว */
  pendingDueTo?: string | null;
  /** คนที่ดูอยู่ต้องอนุมัติ — แถบแดงค้างจนกว่าจะตัดสิน */
  pendingDueWaitsMe?: boolean;
  /** ตรวจงาน (10/11/2569): none | pending | passed | failed */
  reviewState?: string;
  /** คนที่ดูอยู่คือคนเปิดใบ และใบรอตรวจ */
  reviewWaitsMe?: boolean;
}

/** แถวเบาของใบในคอลัมน์เสร็จแล้ว — พอสำหรับนับและกรอง ข้อมูลการ์ดโหลดตอนจะแสดง */
export type BoardStub = Pick<BoardOrder, "id" | "propertyId" | "additionalPropertyIds" | "assignedTo" | "groupMemberIds" | "createdBy"> &
  /** ค้นหาบนบอร์ด — ไม่มี (ข้อมูลเก่าในแคช) = ค้นไม่เจอใบนั้นเท่านั้น ไม่พัง */
  Partial<Pick<BoardOrder, "code" | "title">>;


const NO_STUBS: BoardStub[] = [];
const NO_CARDS: BoardOrder[] = [];
/** จอคอมคอลัมน์ละ 10 ใบเท่าบอร์ดงาน กดเพิ่มทีละ 10 · มือถือ 12 ใบ กดเพิ่มทีละ 12 (ผู้ใช้ 4/11/2569 "กดเลื่อนสัก 3 รอบ" "สัก 12 อัน") */
const PAGE_SIZE = 10;
const MOBILE_PAGE_SIZE = 12;

/*
 * กดเข้าใบงานแล้วกดกลับ ต้องเห็นจำนวนใบที่กด "แสดงเพิ่มเติม" ไว้ และอยู่ตำแหน่งเลื่อนเดิม
 * (เดิมกลับมาทีไรเหลือ 10 ใบแรก เด้งขึ้นบนสุด ต้องไล่กดหาใบเดิมใหม่) — จำไว้ใน sessionStorage ของแท็บ
 * ผูกกับตัวกรองที่ใช้อยู่ (pagingKey) เปลี่ยนตัวกรองแล้วเริ่มใหม่จากบนสุดตามเดิม
 */
const VIEW_KEY = "sb-wo-board-view";
type SavedView = { k: string; clicks: Record<string, number>; scroll: Record<string, number> };

function readView(pagingKey: string): SavedView | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null") as SavedView | null;
    return v && v.k === pagingKey ? v : null;
  } catch {
    return null;
  }
}

function patchView(pagingKey: string, patch: (v: SavedView) => void) {
  const v = readView(pagingKey) ?? { k: pagingKey, clicks: {}, scroll: {} };
  patch(v);
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // โหมดส่วนตัว — ไม่จำ
  }
}

function useColumnPaging(col: string, pagingKey: string) {
  const isMobile = useIsMobile();
  const [clicks, setClicks] = useState(0);
  const step = isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE;
  // คืนค่าหลังโหลดหน้า (sessionStorage ไม่มีฝั่ง server) · คอมโพเนนต์นี้ถูก key ด้วยตัวกรอง จึงอ่านครั้งเดียวพอ
  useEffect(() => {
    const saved = readView(pagingKey)?.clicks[col] ?? 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved > 0) setClicks(saved);
  }, [col, pagingKey]);
  const set = (n: number) => {
    setClicks(n);
    patchView(pagingKey, (v) => {
      v.clicks[col] = n;
    });
  };
  return {
    step,
    shown: step + clicks * step,
    canLess: clicks > 0,
    more: () => set(clicks + 1),
    less: () => set(0),
  };
}

/**
 * ตำแหน่งเลื่อนของกล่องรายการ — คืนตำแหน่งเดิมเมื่อกลับเข้าหน้า (รอการ์ดที่ต้องโหลดเพิ่มได้ไม่เกิน ~3 วิ)
 * บันทึกเฉพาะการเลื่อนที่ผู้ใช้ทำเอง การ์ดโหลดเข้ามา/ตัวกรองเปลี่ยนแล้วกล่องขยับเองไม่นับ ไม่งั้นทับค่าที่จำไว้
 */
function useRememberedScroll(slot: string, pagingKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let touched = false;
    let raf = 0;
    const target = readView(pagingKey)?.scroll[slot] ?? 0;
    const until = Date.now() + 3000;
    const tick = () => {
      if (touched) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 2 || Date.now() > until) return;
      raf = requestAnimationFrame(tick);
    };
    if (target > 0) tick();
    const mark = () => {
      touched = true;
      cancelAnimationFrame(raf);
    };
    let pending = 0;
    const onScroll = () => {
      if (!touched || pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        patchView(pagingKey, (v) => {
          v.scroll[slot] = Math.round(el.scrollTop);
        });
      });
    };
    const gestures = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    gestures.forEach((g) => el.addEventListener(g, mark, { passive: true }));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(pending);
      gestures.forEach((g) => el.removeEventListener(g, mark));
      el.removeEventListener("scroll", onScroll);
    };
  }, [slot, pagingKey]);
  return ref;
}

/** กล่องเลื่อนของแต่ละคอลัมน์/แท็บ — ใช้ hook ได้ต่อกล่อง (คอลัมน์จอใหญ่วนลูปอยู่) */
function RememberedScroll({ slot, pagingKey, className, children }: { slot: string; pagingKey: string; className: string; children: ReactNode }) {
  const ref = useRememberedScroll(slot, pagingKey);
  return (
    <div ref={ref} className={className} data-testid={`wo-scroll-${slot}`}>
      {children}
    </div>
  );
}

/** ใบถูกตัดออกจากหน้าได้ แต่ใบที่มีความคิดเห็นยังไม่อ่านหรือคำขอเลื่อนรออนุมัติต้องเห็นเสมอ */
function pageOf<T extends { id: string; pendingDue?: number }>(rows: T[], shown: number, unread: Map<string, number>): T[] {
  return rows.filter((w, i) => i < shown || (unread.get(w.id) ?? 0) > 0 || (w.pendingDue ?? 0) > 0);
}

function ColumnMore({ remaining, step, canLess, onMore, onLess }: { remaining: number; step: number; canLess: boolean; onMore: () => void; onLess: () => void }) {
  if (remaining <= 0 && !canLess) return null;
  const pill = "inline-flex items-center rounded-full border border-(--line) bg-white px-3.5 py-1.5 text-xs font-medium text-(--ink-soft) hover:bg-(--bg-soft)";
  return (
    <div className="mt-2.5 flex flex-wrap justify-center gap-2">
      {remaining > 0 && (
        <button type="button" data-testid="wo-show-more" onClick={onMore} className={pill}>
          แสดงเพิ่มเติม {Math.min(step, remaining)} รายการ (เหลือ {remaining})
        </button>
      )}
      {canLess && (
        <button type="button" data-testid="wo-show-less" onClick={onLess} className={pill}>
          แสดงน้อยลง
        </button>
      )}
    </div>
  );
}

const noopSubscribe = () => () => {};

/** สีสถานะ = ค่าจริงของ Material palette ที่ ChangYai ใช้ */
const M = {
  red: "#F44336",
  redShade400: "#EF5350",
  orange: "#FF9800",
  deepOrange: "#FF5722",
  green: "#4CAF50",
  blue: "#2196F3",
  grey: "#9E9E9E",
};

const WO_COMMENT_NOTIF: NotifCategory[] = ["work_order"];

/** ป้ายของกลุ่มบ้านที่ยังไม่ถูกจัดหมวด — ต้องตรงกับหน้ารายชื่อบ้าน */
export const NO_CATEGORY = "ยังไม่จัดหมวด";


/** หัวกลุ่มบาง ๆ คั่นระหว่างระดับความเร่งด่วน */

/** ไอคอน fiber_new ของ Material — กรอบมน + ตัวอักษร NEW */
function FiberNew({ color }: { color: string }) {
  return (
    <span
      className="inline-flex h-[18px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border text-[8px] font-bold leading-none tracking-tight"
      style={{ borderColor: color, color }}
      aria-hidden
    >
      NEW
    </span>
  );
}

function OrderCard({
  wo,
  propertyName,
  assigneeName,
  assigneeMore = 0,
}: {
  wo: BoardOrder;
  propertyName: string;
  creatorName?: string;
  assigneeName?: string;
  /** ใบกลุ่ม: จำนวนคนที่เหลือ */
  assigneeMore?: number;
}) {
  // การ์ดแบบการ์ดงาน ตัวเดียวกับบอร์ดงาน (ผู้ใช้ 3/11/2569) — wo-card.tsx
  const settled = wo.hasExpense || !wo.requiresExpense;
  return (
    <WoCard
      id={wo.id}
      href={`/maintenance/work-orders/${wo.id}`}
      code={wo.code}
      title={wo.title}
      place={propertyName || null}
      tags={[
        ...(wo.isPm ? [{ label: "PM", bg: "#7c3aed" }] : []),
        ...(wo.autoCreated ? [{ label: "อัตโนมัติ", bg: "#475569" }] : []),
        ...(wo.isPrivate ? [{ label: "ส่วนตัว", bg: "#1b2537" }] : []),
      ]}
      priority={wo.priority}
      autoCreated={wo.autoCreated}
      status={wo.status}
      doneLabel={
        wo.status === "cancelled" ? "ยกเลิก" : !wo.requiresExpense ? "เสร็จแล้ว · ไม่มีค่าใช้จ่าย" : settled ? "เสร็จแล้ว" : wo.expenseHeld ? "รอ PR/PO หรือใบเบิกจบ" : "ยังไม่บันทึกค่าใช้จ่าย"
      }
      doneTone={wo.status === "cancelled" ? "gray" : settled ? "green" : "orange"}
      dueDate={wo.dueDateIso ?? null}
      expenseDeadline={settled ? null : wo.expenseDeadlineIso}
      expenseRecorded={wo.expenseRecordedTotal}
      commentCount={wo.commentCount ?? 0}
      photoCount={wo.photoCount ?? 0}
      pendingDue={wo.pendingDue ?? 0}
      pendingDueTo={wo.pendingDueTo}
      pendingDueWaitsMe={wo.pendingDueWaitsMe}
      awaitingReview={wo.status === "completed" && wo.reviewState === "pending"}
      reviewWaitsMe={wo.reviewWaitsMe}
      reviewFailed={wo.reviewState === "failed"}
      score={wo.score}
      isPrivate={wo.isPrivate}
      subline={wo.pmRound ? <>รอบ {wo.pmRound.label}</> : undefined}
      avatar={
        assigneeName ? (
          <span className="flex items-center gap-1">
            <InitialAvatar name={assigneeName} />
            {assigneeMore > 0 && <span className="text-[11px] font-semibold text-(--ink-soft)" data-testid="card-more">+{assigneeMore}</span>}
          </span>
        ) : undefined
      }
    />
  );
}

/** โหมดกรอง (งานวันนี้ / งานด่วน / ยังไม่บันทึกค่าใช้จ่าย) = รายการเดียวเรียงตามเวลา */
export function WorkOrderFilteredList({
  orders,
  propertyNames,
  creatorNames,
  moreCount = 0,
  moreHref,
}: {
  orders: BoardOrder[];
  propertyNames: Record<string, string>;
  creatorNames: Record<string, string>;
  /** ผู้บันทึก: ใบรอบันทึกที่ยังไม่ได้แสดง */
  moreCount?: number;
  moreHref?: string;
}) {
  return (
    /*
     * ต้องมี scroll ของตัวเองเหมือนกัน — โหมดกรอง (วันนี้/ด่วน/ยังไม่บันทึก) อยู่
     * ใน AppScaffold แบบ `fill` ตัวเดียวกับกระดาน ซึ่งห่อด้วย overflow-hidden
     * ⇒ เดิมรายการยาว ๆ ถูกตัดที่ขอบจอแล้วเลื่อนไม่ได้ ทั้งบนมือถือและจอใหญ่
     */
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex flex-col gap-3 p-4 sm:p-5">
        {orders.map((wo) => (
          <OrderCard
            key={wo.id}
            wo={wo}
            propertyName={propertyNames[wo.propertyId] ?? ""}
            creatorName={wo.createdBy ? creatorNames[wo.createdBy] : undefined}
            assigneeName={wo.assignedTo ? creatorNames[wo.assignedTo] : undefined}
              assigneeMore={wo.groupMemberIds?.length ?? 0}
          />
        ))}
        {moreCount > 0 && moreHref && <MoreExpenseLink href={moreHref} count={moreCount} />}
      </div>
    </div>
  );
}

function MoreExpenseLink({ href, count }: { href: string; count: number }) {
  return (
    <Link href={href} data-testid="expense-more" className="block rounded-(--radius) border border-(--line) bg-white px-3 py-2.5 text-center text-sm font-semibold text-(--app-strong)">
      ดูอีก {count} ใบ
    </Link>
  );
}

/**
 * byPriority = จัดกลุ่มตามความเร่งด่วน
 *
 * เปิดเฉพาะสองคอลัมน์แรกที่ยังต้องลงมือทำ — งานที่ปิดไปแล้วหรือรอแค่ลงตัวเลข
 * ค่าใช้จ่าย ความเร่งด่วนหมดความหมาย เรียงใหม่ก่อนเก่ามีประโยชน์กว่า
 */
const COLUMNS = [
  { key: "open", title: "ยังไม่ทำ", short: "🔴 ยังไม่ทำ", color: M.red, byPriority: true },
  { key: "in_progress", title: "กำลังทำ", short: "🟡 กำลังทำ", color: M.orange, byPriority: true },
  // ส่งงานแล้ว รอคนเปิดใบตรวจ (10/11/2569 แบบคอลัมน์ "รอตรวจสอบ" ของบอร์ดงาน) — ผ่านแล้วถึงไปขั้นค่าใช้จ่าย
  { key: "review", title: "รอตรวจ", short: "🟢 รอตรวจ", color: "#16a34a", byPriority: false },
  {
    key: "no_expense",
    title: "ยังไม่บันทึกค่าใช้จ่าย",
    short: "🟠 ยังไม่บันทึก",
    color: M.deepOrange,
    byPriority: false,
  },
  { key: "done", title: "เสร็จแล้ว", short: "✅ เสร็จแล้ว", color: M.green, byPriority: false },
] as const;

/**
 * หัวคอลัมน์แบบบอร์ดงาน (ผู้ใช้ 2/11/2569 "กรอบบนนี้ด้วย"): กล่องขาวมุมมน · ป้ายจำนวนสีทึบ · ชื่อ · % ของบอร์ด
 * พื้นจาง = สัดส่วนในคอลัมน์ (ตรงเวลา = สีคอลัมน์ · เลยกำหนด = แดง) + เส้นสีเข้มที่ขอบล่าง — แบบ kanban-column.tsx ของงาน
 */
function ColumnHeader({
  col,
  orders,
  boardTotal,
  extra = 0,
}: {
  col: (typeof COLUMNS)[number];
  orders: (BoardStub & Partial<BoardOrder>)[];
  boardTotal: number;
  /** ใบในคอลัมน์นี้ที่ไม่ได้ส่งมาแสดง (นับรวมให้ตรงของจริง) */
  extra?: number;
}) {
  const total = orders.length + extra;
  const percent = boardTotal > 0 ? Math.round((total / boardTotal) * 100) : 0;
  const dueRequests = orders.filter((w) => (w.pendingDue ?? 0) > 0).length;
  // ความคิดเห็นที่ยังไม่อ่านในคอลัมน์นี้ — ป้ายแดงขวาสุด แบบบอร์ดงาน
  const unreadMap = useUnreadCommentCounts(WO_COMMENT_NOTIF);
  const unreadComments = orders.reduce((n, w) => n + (unreadMap.get(w.id) ?? 0), 0);
  const late = col.key === "open" || col.key === "in_progress" ? orders.filter((w) => w.due?.late || w.pmRound?.late).length : 0;
  const segments = total === 0 ? [] : [
    ...(total - late > 0 ? [{ pct: ((total - late) / total) * 100, color: col.color }] : []),
    ...(late > 0 ? [{ pct: (late / total) * 100, color: M.red }] : []),
  ];
  return (
    <div
      className="relative mb-2.5 h-[42px] w-full shrink-0 overflow-hidden rounded-xl border border-(--line) bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
      title={`${col.title} ${total} ใบ · ${percent}% ของบอร์ด${late > 0 ? `
ตรงเวลา ${total - late} · เลยกำหนด ${late}` : ""}`}
    >
      {segments.length > 0 && (
        <>
          <span className="absolute inset-0 flex" aria-hidden>
            {segments.map((seg, i) => (
              <span
                key={i}
                className="h-full"
                style={{ width: `${seg.pct}%`, backgroundColor: `color-mix(in srgb, ${seg.color} 18%, white)`, boxShadow: i > 0 ? "inset 1.5px 0 0 white" : undefined }}
              />
            ))}
          </span>
          <span className="absolute inset-x-0 bottom-0 flex h-[3px]" aria-hidden>
            {segments.map((seg, i) => (
              <span key={i} className="h-full" style={{ width: `${seg.pct}%`, backgroundColor: seg.color }} />
            ))}
          </span>
        </>
      )}
      <span className="relative flex h-full items-center gap-2 px-2">
        <span
          className="flex h-6 min-w-[26px] shrink-0 items-center justify-center rounded-[7px] px-1.5 text-[13px] font-bold tabular-nums text-white"
          style={{ backgroundColor: `color-mix(in srgb, ${col.color} 82%, black)` }}
        >
          {total}
        </span>
        <span className="min-w-0 truncate text-sm font-bold tracking-tight text-(--ink)">{col.title}</span>
        <span className="-ml-0.5 shrink-0 text-xs font-semibold tabular-nums text-(--ink-soft)">{percent}%</span>
        {/* แบบบอร์ดงาน: ใบที่เลยกำหนดบอกด้วยพื้นแดงอย่างเดียว · ป้ายแดงขวา = คำขอเลื่อนที่รออนุมัติ (ผู้ใช้ 3/11/2569) */}
        {dueRequests > 0 && (
          <span
            className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[var(--chart-red)] px-2 text-xs font-bold tabular-nums text-white shadow-[0_1px_3px_rgba(229,72,77,0.35)]"
            title={`มี ${dueRequests} ใบในคอลัมน์นี้ที่ขอเลื่อนกำหนดส่ง รออนุมัติ`}
          >
            <Clock className="h-3.5 w-3.5" />
            {dueRequests}
          </span>
        )}
        {unreadComments > 0 && (
          <span
            className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[var(--chart-red)] px-2 text-xs font-bold tabular-nums text-white shadow-[0_1px_3px_rgba(229,72,77,0.35)] ${dueRequests === 0 ? "ml-auto" : ""}`}
            title={`มีความคิดเห็นที่ยังไม่ได้อ่าน ${unreadComments} รายการ ในคอลัมน์นี้`}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {unreadComments}
          </span>
        )}
      </span>
    </div>
  );
}

/** รายการการ์ดในคอลัมน์เดียว — จัดกลุ่มหรือไม่ก็ได้ */
/** งานที่ยังไม่ปิดเรียงตามวันครบกำหนด เลยกำหนดจึงขึ้นก่อน (ผู้ใช้ 4/11/2569) · ใบไม่มีวันไปท้ายตามลำดับเดิม · คอลัมน์ที่ปิดแล้วไม่แตะ */
function byDueDate(orders: BoardOrder[]): BoardOrder[] {
  const open = (w: BoardOrder) => w.status === "open" || w.status === "in_progress";
  const dated = orders.filter((w) => open(w) && w.dueDateIso).sort((a, b) => a.dueDateIso!.localeCompare(b.dueDateIso!));
  return dated.length > 0 ? [...dated, ...orders.filter((w) => !(open(w) && w.dueDateIso))] : orders;
}

/**
 * ตัวเลือกจัดเรียงบนแถบหัว (ผู้ใช้ 9/11/2569) — due = ใกล้ครบกำหนด (ค่าเริ่มต้น ลำดับเดิมของบอร์ด) · latest = เปิดใหม่ก่อน
 * มีผลกับสามคอลัมน์แรก · คอลัมน์เสร็จแล้วเรียงปิดล่าสุดก่อนจากเซิร์ฟเวอร์อยู่แล้ว
 */
type BoardSort = "due" | "latest";

function byNewest(orders: BoardOrder[]): BoardOrder[] {
  return [...orders].sort((a, b) => (b.createdAtIso ?? "").localeCompare(a.createdAtIso ?? ""));
}

function ColumnList({
  orders,
  propertyNames,
  creatorNames,
  byPriority,
  sort,
  gap,
  emptyClass,
  col,
  pagingKey,
}: {
  orders: BoardOrder[];
  propertyNames: Record<string, string>;
  creatorNames: Record<string, string>;
  byPriority: boolean;
  sort: BoardSort;
  gap: string;
  emptyClass: string;
  col: string;
  pagingKey: string;
}) {
  const paging = useColumnPaging(col, pagingKey);
  const unread = useUnreadCommentCounts(WO_COMMENT_NOTIF);
  if (orders.length === 0) {
    return <p className={emptyClass}>ไม่มีใบงาน</p>;
  }

  const card = (wo: BoardOrder) => (
    <OrderCard
      key={wo.id}
      wo={wo}
      propertyName={propertyNames[wo.propertyId] ?? ""}
      creatorName={wo.createdBy ? creatorNames[wo.createdBy] : undefined}
      assigneeName={wo.assignedTo ? creatorNames[wo.assignedTo] : undefined}
              assigneeMore={wo.groupMemberIds?.length ?? 0}
    />
  );

  const groups = byPriority ? groupByPriority(orders) : [];
  // กลุ่มเดียวไม่ต้องขึ้นหัวกลุ่ม — หัวข้อที่คลุมทั้งคอลัมน์ไม่ได้บอกอะไรเพิ่ม
  const sorted = sort === "latest" ? byNewest(orders) : groups.length <= 1 ? byDueDate(orders) : byDueDate(groups.flatMap((g) => g.orders));
  const page = pageOf(sorted, paging.shown, unread);
  return (
    <>
      <div className={`flex flex-col ${gap}`}>{page.map(card)}</div>
      <ColumnMore remaining={sorted.length - page.length} step={paging.step} canLess={paging.canLess} onMore={paging.more} onLess={paging.less} />
    </>
  );
}

/** คอลัมน์เสร็จแล้ว — มีแค่แถวเบา การ์ดของหน้าที่แสดงโหลดเมื่อถึงคิว */
function DoneColumnList({
  stubs,
  cards,
  failed,
  onNeed,
  propertyNames,
  creatorNames,
  gap,
  emptyClass,
  pagingKey,
}: {
  stubs: BoardStub[];
  /** null = เซิร์ฟเวอร์ไม่ส่งการ์ดนี้ให้ (เช่น ถูกลบ/ไม่มีสิทธิ์แล้ว) */
  cards: Map<string, BoardOrder | null>;
  failed: boolean;
  onNeed: (ids: string[]) => void;
  propertyNames: Record<string, string>;
  creatorNames: Record<string, string>;
  gap: string;
  emptyClass: string;
  pagingKey: string;
}) {
  const paging = useColumnPaging("done", pagingKey);
  const unread = useUnreadCommentCounts(WO_COMMENT_NOTIF);
  const page = pageOf(stubs, paging.shown, unread);
  const missing = page.filter((w) => !cards.has(w.id)).map((w) => w.id);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (missingKey) onNeed(missingKey.split(","));
  }, [missingKey, onNeed]);

  if (stubs.length === 0) return <p className={emptyClass}>ไม่มีใบงาน</p>;
  return (
    <>
      <div className={`flex flex-col ${gap}`}>
        {page.map((w) => {
          if (!cards.has(w.id)) {
            return failed ? null : <div key={w.id} data-testid="wo-card-loading" className="h-28 animate-pulse rounded-xl bg-(--bg-soft)" />;
          }
          const wo = cards.get(w.id);
          return wo ? (
            <OrderCard
              key={w.id}
              wo={wo}
              propertyName={propertyNames[wo.propertyId] ?? ""}
              creatorName={wo.createdBy ? creatorNames[wo.createdBy] : undefined}
              assigneeName={wo.assignedTo ? creatorNames[wo.assignedTo] : undefined}
              assigneeMore={wo.groupMemberIds?.length ?? 0}
            />
          ) : null;
        })}
      </div>
      {failed && missing.length > 0 && (
        <div className="mt-2.5 text-center text-xs text-(--ink-soft)">
          โหลดไม่สำเร็จ{" "}
          <button type="button" className="underline" onClick={() => onNeed(missing)}>
            ลองอีกครั้ง
          </button>
        </div>
      )}
      <ColumnMore remaining={stubs.length - page.length} step={paging.step} canLess={paging.canLess} onMore={paging.more} onLess={paging.less} />
    </>
  );

}

function ColumnIcon({ col, color }: { col: string; color: string }) {
  if (col === "open") return <FiberNew color={color} />;
  if (col === "in_progress")
    return <RefreshCw className="h-[18px] w-[18px]" style={{ color }} />;
  if (col === "no_expense")
    return <ReceiptText className="h-[18px] w-[18px]" style={{ color }} />;
  return <CheckCircle2 className="h-[18px] w-[18px]" style={{ color }} />;
}

/** FilterChip ของ Material — มุมโค้ง 10 ติ๊กถูกเมื่อเลือก */
/*
 * บ้าน/หมวดที่เลือกไว้ต้องอยู่รอดตอนกดเข้าใบงานแล้วกดกลับ — เดิมเป็น useState ล้วน
 * กลับมาทีไรเด้งไป "ทุกบ้าน" ต้องเลือกใหม่ทุกครั้ง ปุ่มกลับของหน้ารายละเอียดเป็นลิงก์ตายตัว
 * (/maintenance/work-orders) จึงจำไว้สองที่: URL (รีเฟรช/แชร์ลิงก์ได้) + sessionStorage
 * (กลับมาจากลิงก์ที่ไม่มี query) · sessionStorage = ต่อแท็บ ปิดแท็บแล้วลืมเอง
 */
const FILTER_KEY = "sb-wo-board-filter";
type BoardFilter = { group: string | null; house: string | null; tab: number; who?: string | null; sort?: BoardSort };

function readSavedFilter(): BoardFilter | null {
  const q = new URLSearchParams(window.location.search);
  if (q.has("group") || q.has("house") || q.has("tab") || q.has("sort")) {
    return { group: q.get("group"), house: q.get("house"), tab: Number(q.get("tab")) || 0, who: q.get("who"), sort: q.get("sort") === "latest" ? "latest" : "due" };
  }
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    return raw ? (JSON.parse(raw) as BoardFilter) : null;
  } catch {
    return null;
  }
}

function saveFilter(f: BoardFilter) {
  const url = new URL(window.location.href);
  for (const [k, v] of [["group", f.group], ["house", f.house], ["tab", f.tab ? String(f.tab) : null], ["who", f.who ?? null], ["sort", f.sort === "latest" ? "latest" : null]] as const) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  // replaceState ไม่ทำให้ Next โหลดหน้าใหม่ และไม่เพิ่มประวัติ (กดกลับไม่ต้องไล่ทีละชิป)
  window.history.replaceState(window.history.state, "", url);
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch {
    // โหมดส่วนตัว — จำได้แค่ใน URL
  }
}

export function WorkOrderBoard({
  orders,
  doneStubs = NO_STUBS,
  doneFirst = NO_CARDS,
  loadDoneCards,
  propertyNames,
  propertyCategories,
  creatorNames,
  currentUserId,
  canPickPeople = true,
  expenseFirst = false,
  expenseMore = 0,
}: {
  /** ใบในคอลัมน์ยังไม่ทำ/กำลังทำ/ยังไม่บันทึกค่าใช้จ่าย */
  orders: BoardOrder[];
  /** คอลัมน์เสร็จแล้ว: แถวเบาของทุกใบ + การ์ดชุดแรก + ตัวโหลดการ์ดที่เหลือ */
  doneStubs?: BoardStub[];
  doneFirst?: BoardOrder[];
  loadDoneCards?: (ids: string[]) => Promise<BoardOrder[]>;
  propertyNames: Record<string, string>;
  /**
   * propertyId → ชื่อหมวดที่ถูกจัดไว้ · ไม่มีคีย์ = ยังไม่จัดหมวด
   *
   * เดิมหมวดถูกเดาจากชื่อบ้าน (BS-M4 → BS-M) ตรงนี้เอง ⇒ ย้ายบ้านข้ามหมวดที่หน้า
   * "บ้าน" แล้วชิปกรองบนบอร์ดยังบอกหมวดเดิมอยู่ ตอนนี้อ่านจากที่เดียวกันทั้งระบบ
   */
  propertyCategories: Record<string, string>;
  creatorNames: Record<string, string>;
  /** ผู้ใช้ที่ล็อกอิน — ใช้กับตัวเลือก "งานที่ฉันได้รับมอบหมาย / ฉันมอบหมาย" */
  currentUserId?: string;
  /** true = ผู้ดูแล/เห็นทั้งบริษัท — เลือกดูงานรายคนได้ · false = พนักงานทั่วไป มีแค่ "ของฉัน" */
  canPickPeople?: boolean;
  /** ผู้บันทึกค่าใช้จ่าย: คอลัมน์ "ยังไม่บันทึก" ขึ้นก่อน (ผู้ใช้ 3/11/2569 "ต้องขึ้นมาอยู่บนเลย") */
  expenseFirst?: boolean;
  /** ผู้บันทึก: ใบรอบันทึกที่ไม่ได้แสดงบนบอร์ด */
  expenseMore?: number;
}) {
  // ช่องบนแถบหัว (หน้าใบงานส่ง leading = <div id="wo-board-toolbar">) — หาเจอหลังเมาท์ แล้ววางตัวกรองผ่าน portal
  // เซิร์ฟเวอร์ = null (วาดตัวกรองไว้ในบอร์ดก่อน ตรงกับ HTML ที่ส่งมา) · ฝั่งเครื่อง = ช่องจริง แล้วย้ายขึ้นแถบหัว
  const isMobile = useIsMobile();
  const toolbarSlot = useSyncExternalStore(
    noopSubscribe,
    () => document.getElementById("wo-board-toolbar"),
    () => null,
  );
  const [group, setGroup] = useState<string | null>(null);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  // กรองตามผู้ได้รับมอบหมาย — null = ทุกคน · UNASSIGNED = ใบที่ยังไม่มอบหมายให้ใคร
  const [assignee, setAssignee] = useState<string | null>(null);
  const [sort, setSort] = useState<BoardSort>("due");
  // ค้นหาชื่อหัวข้อ / เลขใบ / ชื่อบ้าน (ผู้ใช้ 12/11/2569) — ซ่อนเป็นไอคอนไว้ กดแล้วค่อยกาง ไม่ให้แถบหัวรก
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const everyRow = useMemo<BoardStub[]>(() => [...orders, ...doneStubs], [orders, doneStubs]);
  const assigneeOptions = useMemo(() => {
    const ids = new Set(everyRow.flatMap((w) => [w.assignedTo, ...(w.groupMemberIds ?? [])]).filter((id): id is string => !!id));
    return [...ids]
      .map((id) => ({ id, name: creatorNames[id] ?? "ไม่ทราบชื่อ" }))
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [everyRow, creatorNames]);
  const hasUnassigned = everyRow.some((w) => !w.assignedTo);

  // การ์ดคอลัมน์เสร็จแล้วที่โหลดมาแล้ว — หน้ารีเฟรชจากเซิร์ฟเวอร์ให้เริ่มใหม่ ข้อมูลจะได้ไม่ค้าง
  const [seenFirst, setSeenFirst] = useState(doneFirst);
  const [doneCards, setDoneCards] = useState(() => new Map<string, BoardOrder | null>(doneFirst.map((w) => [w.id, w])));
  const [doneFailed, setDoneFailed] = useState(false);
  if (seenFirst !== doneFirst) {
    setSeenFirst(doneFirst);
    setDoneCards(new Map(doneFirst.map((w) => [w.id, w])));
  }
  const inflight = useRef(new Set<string>());
  const needDone = useCallback(
    (ids: string[]) => {
      const want = ids.filter((id) => !inflight.current.has(id));
      if (!loadDoneCards || want.length === 0) return;
      want.forEach((id) => inflight.current.add(id));
      setDoneFailed(false);
      loadDoneCards(want)
        .then((rows) => {
          const got = new Map(rows.map((w) => [w.id, w]));
          setDoneCards((prev) => {
            const next = new Map(prev);
            for (const id of want) next.set(id, got.get(id) ?? null);
            return next;
          });
        })
        .catch(() => setDoneFailed(true))
        .finally(() => want.forEach((id) => inflight.current.delete(id)));
    },
    [loadDoneCards],
  );
  const restored = useRef(false);

  // เฉพาะบ้านที่มีใบงานจริง
  const groups = useMemo(() => {
    const used = new Set<string>();
    for (const w of everyRow) {
      used.add(w.propertyId);
      for (const p of w.additionalPropertyIds) used.add(p);
    }
    const entries = Object.entries(propertyNames)
      .filter(([id]) => used.has(id))
      .sort((a, b) => a[1].localeCompare(b[1]));
    const map = new Map<string, [string, string][]>();
    for (const e of entries) {
      const g = propertyCategories[e[0]] ?? NO_CATEGORY;
      const list = map.get(g) ?? [];
      list.push(e);
      map.set(g, list);
    }
    // "ยังไม่จัดหมวด" ไปท้ายสุดเสมอ ไม่ปนไปตามลำดับตัวอักษร — มันไม่ใช่หมวดจริง
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_CATEGORY) return 1;
      if (b === NO_CATEGORY) return -1;
      return a.localeCompare(b, "th");
    });
    return keys;
  }, [everyRow, propertyNames, propertyCategories]);

  // คืนค่าที่เลือกไว้ — อ่านได้หลังโหลดหน้าเท่านั้น (URL/sessionStorage ไม่มีฝั่ง server)
  // ข้ามหมวด/บ้านที่ไม่มีบนกระดานนี้แล้ว (เช่น เปิดจากแดชบอร์ดแบบกรอง) ไม่งั้นกระดานว่างเปล่า
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = readSavedFilter();
    if (!saved) return;
    const g = saved.group && groups.includes(saved.group) ? saved.group : null;
    const h = g && saved.house && propertyNames[saved.house] && (propertyCategories[saved.house] ?? NO_CATEGORY) === g ? saved.house : null;
    /* eslint-disable react-hooks/set-state-in-effect */
    setGroup(g);
    setHouseId(h);
    setTab(saved.tab >= 0 && saved.tab < COLUMNS.length ? saved.tab : 0);
    setAssignee(saved.who ?? null);
    setSort(saved.sort === "latest" ? "latest" : "due");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [groups, propertyNames, propertyCategories]);

  useEffect(() => {
    if (restored.current) saveFilter({ group, house: houseId, tab, who: assignee, sort });
  }, [group, houseId, tab, assignee, sort]);

  const { visible, visibleDone } = useMemo(() => {
    const pick = <T extends BoardStub,>(rows: T[]): T[] => {
    const byPerson =
      assignee === null
        ? rows
        : rows.filter((w) => {
            if (assignee === UNASSIGNED) return !w.assignedTo;
            // ได้รับมอบหมาย = เป็นผู้รับผิดชอบ · ฉันมอบหมาย = เปิดใบงานแล้วให้คนอื่นรับผิดชอบ
            if (assignee === ASSIGNED_TO_ME) return !!currentUserId && (w.assignedTo === currentUserId || !!w.groupMemberIds?.includes(currentUserId));
            if (assignee === ASSIGNED_BY_ME)
              return !!currentUserId && w.createdBy === currentUserId && !!w.assignedTo && w.assignedTo !== currentUserId;
            return w.assignedTo === assignee || !!w.groupMemberIds?.includes(assignee);
          });
    const q = query.trim().toLowerCase();
    const byText = !q
      ? byPerson
      : byPerson.filter((w) =>
          [w.title, w.code, ...[w.propertyId, ...w.additionalPropertyIds].map((id) => propertyNames[id])].some((t) => !!t && t.toLowerCase().includes(q)),
        );
    if (houseId) {
      return byText.filter(
        (w) => w.propertyId === houseId || w.additionalPropertyIds.includes(houseId)
      );
    }
    if (!group) return byText;
    return byText.filter((w) =>
      [w.propertyId, ...w.additionalPropertyIds].some(
        (id) => (propertyCategories[id] ?? NO_CATEGORY) === group
      )
    );
    };
    return { visible: pick(orders), visibleDone: pick(doneStubs) };
  }, [orders, doneStubs, group, houseId, propertyCategories, propertyNames, assignee, currentUserId, query]);

  const buckets: Record<string, BoardOrder[]> = {
    open: visible.filter((w) => w.status === "open"),
    in_progress: visible.filter((w) => w.status === "in_progress"),
    // รอคนเปิดใบตรวจ — คนตรวจเห็นของตัวเองก่อน
    review: visible
      .filter((w) => w.status === "completed" && w.reviewState === "pending")
      .sort((a, b) => Number(!!b.reviewWaitsMe) - Number(!!a.reviewWaitsMe)),
    /*
     * "ยังไม่บันทึกค่าใช้จ่าย" = ปิดงานแล้ว ต้องกรอกค่าใช้จ่าย แต่ยังไม่ได้กรอก
     *
     * ใบที่ตั้งไว้ว่า requiresExpense = false ไม่มีอะไรให้กรอกตั้งแต่แรก ⇒ ปิดงาน
     * แล้วต้องไปอยู่ "เสร็จแล้ว" เลย · เดิมเช็คแค่ !hasExpense ใบพวกนี้เลยไปค้าง
     * ในคอลัมน์ทวงค่าใช้จ่ายตลอดกาล ทั้งที่หน้ารายละเอียดบอกเองว่า "งานนี้ไม่มี
     * ค่าใช้จ่าย — ปิดงานได้โดยไม่ต้องกรอก" (ตัวเตือนทาง LINE ใน data/cron.ts
     * กรองด้วย requiresExpense ถูกอยู่แล้ว ตกหล่นเฉพาะฝั่งหน้าจอ)
     */
    no_expense: visible
      .filter((w) => w.status === "completed" && w.reviewState !== "pending" && w.requiresExpense && !w.hasExpense)
      // ครบกำหนดบันทึกใกล้สุดขึ้นก่อน (ใบที่ไม่มีกำหนดคงลำดับเดิม)
      .sort((a, b) => (a.expenseDeadlineIso && b.expenseDeadlineIso ? a.expenseDeadlineIso.localeCompare(b.expenseDeadlineIso) : 0)),
  };
  const columns: (typeof COLUMNS)[number][] = expenseFirst ? [...COLUMNS.filter((c) => c.key === "no_expense"), ...COLUMNS.filter((c) => c.key !== "no_expense")] : [...COLUMNS];
  // กรองบ้าน/คนอยู่ ไม่รู้ว่าใบที่ไม่ได้แสดงเข้าเงื่อนไขกี่ใบ — ตัวเลขนับเฉพาะที่เห็น ลิงก์ดูต่อยังอยู่
  const hiddenCount = visible.length === orders.length && visibleDone.length === doneStubs.length ? expenseMore : 0;
  const rowsOf = (key: string): (BoardStub & Partial<BoardOrder>)[] => (key === "done" ? visibleDone : (buckets[key] ?? []));
  const boardTotal = columns.reduce((n, c) => n + rowsOf(c.key).length, 0) + hiddenCount;
  const countOf = (key: string) => rowsOf(key).length + (key === "no_expense" ? hiddenCount : 0);
  // มือถือเห็นทีละแท็บ — ค้นแล้วแท็บที่เปิดอยู่ไม่มีผล ให้ไปแท็บแรกที่มีผล ไม่งั้นเห็น "ไม่มีใบงาน" ทั้งที่เจอ
  const firstHit = query.trim() ? columns.findIndex((c) => countOf(c.key) > 0) : -1;
  const tabEmpty = query.trim() !== "" && countOf(columns[tab]?.key ?? "") === 0;
  const [jumpedFor, setJumpedFor] = useState("");
  if (tabEmpty && firstHit >= 0 && firstHit !== tab && jumpedFor !== query) {
    setJumpedFor(query);
    setTab(firstHit);
  }
  // เปลี่ยนการเรียงแล้วเริ่มจากบนสุด — ใบที่เคยกดแสดงเพิ่มไว้ไม่ใช่ชุดเดิมแล้ว
  const pagingKey = `${group}|${houseId}|${assignee}|${sort}|${query.trim().toLowerCase()}`;
  const listFor = (c: (typeof COLUMNS)[number], gap: string, emptyClass: string) =>
    c.key === "done" ? (
      <DoneColumnList
        key={`done|${pagingKey}`}
        stubs={visibleDone}
        cards={doneCards}
        failed={doneFailed}
        onNeed={needDone}
        propertyNames={propertyNames}
        creatorNames={creatorNames}
        gap={gap}
        emptyClass={emptyClass}
        pagingKey={pagingKey}
      />
    ) : (
      <ColumnList
        key={`${c.key}|${pagingKey}`}
        orders={buckets[c.key]!}
        propertyNames={propertyNames}
        creatorNames={creatorNames}
        byPriority={c.byPriority}
        sort={sort}
        gap={gap}
        emptyClass={emptyClass}
        col={c.key}
        pagingKey={pagingKey}
      />
    );
  const moreLink = expenseMore > 0 ? <div className="mt-2.5"><MoreExpenseLink href="/maintenance/work-orders?filter=no-expense" count={expenseMore} /></div> : null;

  // ช่องเลือกบ้านบนแถบหัว — ทุกบ้าน / ทั้งหมวด / รายหลัง ในช่องเดียว แบบช่องผู้รับผิดชอบ (ผู้ใช้ 3/11/2569 แบบ B)
  // มือถือใช้ช่องนี้ด้วย แถวปุ่มบ้านเดิมกินที่ดูการ์ด (ผู้ใช้ 4/11/2569 "ลกเกินไป เอาไปไว้ข้างบน")
  const houseSelect =
    groups.length > 1 ? (
      <label className="relative inline-flex h-8 min-w-0 items-center rounded-(--radius) border border-(--line) bg-(--bg) pl-2 pr-6 text-[13px] sm:shrink-0 lg:h-9 lg:pl-3 lg:pr-8 lg:text-sm">
        <span className="mr-1 shrink-0 text-(--ink-soft)">🏠<span className="hidden sm:inline"> บ้าน:</span></span>
        <select
          aria-label="กรองตามบ้าน"
          className="min-w-0 max-w-[5.5rem] appearance-none truncate bg-transparent pr-1 font-medium text-(--ink) outline-none sm:max-w-none"
          value={houseId ? `h:${houseId}` : group ? `g:${group}` : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              setGroup(null);
              setHouseId(null);
            } else if (v.startsWith("g:")) {
              setGroup(v.slice(2));
              setHouseId(null);
            } else {
              const id = v.slice(2);
              setGroup(propertyCategories[id] ?? NO_CATEGORY);
              setHouseId(id);
            }
          }}
        >
          <option value="">ทุกบ้าน</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              <option value={`g:${g}`}>ทุกหลังใน {g}</option>
              {Object.entries(propertyNames)
                .filter(([id]) => (propertyCategories[id] ?? NO_CATEGORY) === g)
                .sort((a, b) => a[1].localeCompare(b[1], "th"))
                .map(([id, name]) => (
                  <option key={id} value={`h:${id}`}>
                    {name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <span className="pointer-events-none absolute right-1.5 text-(--ink-soft) lg:right-2.5" aria-hidden="true">▾</span>
      </label>
    ) : null;

  const sortSelect = (
    <label className="relative inline-flex h-8 min-w-0 items-center rounded-(--radius) border border-(--line) bg-(--bg) pl-2 pr-6 text-[13px] sm:shrink-0 lg:h-9 lg:pl-3 lg:pr-8 lg:text-sm">
      <span className="mr-1 shrink-0 text-(--ink-soft)">↕<span className="hidden sm:inline"> เรียง:</span></span>
      <select
        aria-label="จัดเรียงใบงาน"
        data-testid="wo-board-sort"
        className="min-w-0 max-w-[5.5rem] appearance-none truncate bg-transparent pr-1 font-medium text-(--ink) outline-none sm:max-w-none"
        value={sort}
        onChange={(e) => setSort(e.target.value === "latest" ? "latest" : "due")}
      >
        <option value="due">ใกล้ครบกำหนด</option>
        <option value="latest">ล่าสุด</option>
      </select>
      <span className="pointer-events-none absolute right-1.5 text-(--ink-soft) lg:right-2.5" aria-hidden="true">▾</span>
    </label>
  );

  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };
  const searchBox =
    searchOpen || query ? (
      <label className="relative inline-flex h-8 w-36 min-w-0 shrink items-center rounded-(--radius) border border-(--brand-navy) bg-(--bg) pl-2 pr-7 text-[13px] sm:w-52 lg:h-9 lg:text-sm">
        <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-(--ink-soft)" aria-hidden="true" />
        <input
          autoFocus
          type="search"
          data-testid="wo-board-search"
          aria-label="ค้นหาใบงาน"
          placeholder="ค้นชื่องาน เลขใบ บ้าน"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && closeSearch()}
          onBlur={() => !query.trim() && setSearchOpen(false)}
          className="min-w-0 flex-1 bg-transparent text-(--ink) outline-none placeholder:text-(--ink-faint) [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="button"
          aria-label="ล้างคำค้น"
          onMouseDown={(e) => e.preventDefault()}
          onClick={closeSearch}
          className="absolute right-1.5 rounded p-0.5 text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </label>
    ) : (
      <button
        type="button"
        data-testid="wo-board-search-open"
        aria-label="ค้นหาใบงาน"
        title="ค้นหาใบงาน"
        onClick={() => setSearchOpen(true)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius) border border-(--line) bg-(--bg) text-(--ink-soft) hover:text-(--ink) lg:h-9 lg:w-9"
      >
        <Search className="h-4 w-4" />
      </button>
    );

  const personFilter =
    (canPickPeople && assigneeOptions.length > 0) || !!currentUserId ? (
      <PersonFilter
        label="ผู้รับผิดชอบ"
        value={assignee}
        onChange={setAssignee}
        people={assigneeOptions}
        showUnassigned={hasUnassigned}
        showMine={!!currentUserId}
        showPeople={canPickPeople}
        compact={isMobile}
      />
    ) : null;

  return (
    /*
     * h-full ทั้งสองขนาดจอ ไม่ใช่แค่ lg
     *
     * หน้านี้ใช้ AppScaffold แบบ `fill` ซึ่งบนมือถือเป็น `fixed inset-0` แล้วห่อ
     * เนื้อหาด้วย `overflow-hidden` โดยตกลงกันว่า "ผู้ใช้ต้องมี overflow-y-auto
     * ของตัวเอง" — ฝั่งมือถือของกระดานนี้ไม่เคยมี ⇒ รายการใบงานถูกตัดที่ขอบจอ
     * แล้วเลื่อนไม่ได้เลย เห็นแค่ไม่กี่ใบแรก
     */
    <div className="flex h-full flex-col">
      {toolbarSlot &&
        createPortal(
          <div className="flex min-w-0 items-center gap-2">
            {personFilter}
            {houseSelect}
            {sortSelect}
            {searchBox}
          </div>,
          toolbarSlot,
        )}
      {/* ─── มือถือ: แท็บ 4 สถานะ ─── */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-(--line)">
          {columns.map((c, i) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setTab(i)}
              className="flex shrink-0 items-center gap-1 border-b-2 px-3 py-3 text-xs"
              style={{
                borderColor: tab === i ? "var(--app)" : "transparent",
                color: tab === i ? "var(--app-strong)" : "var(--ink-soft)",
                fontWeight: tab === i ? 700 : 400,
              }}
            >
              {c.short}
              {countOf(c.key) > 0 && (
                <span
                  className="rounded-[10px] px-1.5 py-px text-[10px] font-bold text-white"
                  style={{ backgroundColor: c.color }}
                >
                  {countOf(c.key)}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* แถบแท็บอยู่กับที่ เลื่อนเฉพาะรายการ — แบบเดียวกับคอลัมน์ฝั่งจอใหญ่ */}
        <RememberedScroll slot={`m-${columns[tab]!.key}`} pagingKey={pagingKey} className="min-h-0 flex-1 overflow-y-auto p-3">
          {listFor(columns[tab]!, "gap-3", "py-10 text-center text-sm text-(--ink-soft)")}
          {columns[tab]!.key === "no_expense" && moreLink}
        </RememberedScroll>
      </div>

      {/* ─── จอใหญ่: Kanban 4 คอลัมน์ คั่นด้วยเส้นตั้ง แต่ละคอลัมน์เลื่อนแยกกัน ─── */}
      <div className="hidden min-h-0 flex-1 lg:flex">
        {columns.map((c, i) => (
          <div
            key={c.key}
            // แบบบอร์ดงาน: คอลัมน์มีระยะห่างกัน หัวเป็นกล่องลอย (ไม่ใช่แถบเต็มความกว้างคั่นเส้นตั้ง)
            className={`flex min-w-0 flex-1 flex-col px-1.5 pt-2.5 ${i === 0 ? "pl-2.5" : ""} ${i === columns.length - 1 ? "pr-2.5" : ""}`}
          >
            <ColumnHeader col={c} orders={rowsOf(c.key)} boardTotal={boardTotal} extra={c.key === "no_expense" ? hiddenCount : 0} />

            <RememberedScroll slot={`d-${c.key}`} pagingKey={pagingKey} className="min-h-0 flex-1 overflow-y-auto pb-2.5">
              {listFor(c, "gap-2.5", "px-2 py-8 text-center text-sm text-[#B0BEC5]")}
              {c.key === "no_expense" && moreLink}
            </RememberedScroll>
          </div>
        ))}
      </div>
    </div>
  );
}
