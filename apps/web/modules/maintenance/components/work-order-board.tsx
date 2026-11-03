"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ASSIGNED_BY_ME, ASSIGNED_TO_ME, PersonFilter, UNASSIGNED } from "./person-filter";
import { createPortal } from "react-dom";
import { InitialAvatar, WoCard } from "./wo-card";
import { RefreshCw, ReceiptText, Check, CheckCircle2 } from "lucide-react";
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
  autoCreated: boolean;
  createdAtLabel: string;
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
  commentCount?: number;
  photoCount?: number;
  pendingDue?: number;
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
}: {
  wo: BoardOrder;
  propertyName: string;
  creatorName?: string;
  assigneeName?: string;
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
        wo.status === "cancelled" ? "ยกเลิก" : !wo.requiresExpense ? "เสร็จแล้ว · ไม่มีค่าใช้จ่าย" : settled ? "เสร็จแล้ว" : "ยังไม่บันทึกค่าใช้จ่าย"
      }
      doneTone={wo.status === "cancelled" ? "gray" : settled ? "green" : "orange"}
      dueDate={wo.dueDateIso ?? null}
      commentCount={wo.commentCount ?? 0}
      photoCount={wo.photoCount ?? 0}
      pendingDue={wo.pendingDue ?? 0}
      isPrivate={wo.isPrivate}
      subline={wo.pmRound ? <>รอบ {wo.pmRound.label}</> : undefined}
      avatar={assigneeName ? <InitialAvatar name={assigneeName} /> : undefined}
    />
  );
}

/** โหมดกรอง (งานวันนี้ / งานด่วน / ยังไม่บันทึกค่าใช้จ่าย) = รายการเดียวเรียงตามเวลา */
export function WorkOrderFilteredList({
  orders,
  propertyNames,
  creatorNames,
}: {
  orders: BoardOrder[];
  propertyNames: Record<string, string>;
  creatorNames: Record<string, string>;
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
          />
        ))}
      </div>
    </div>
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
}: {
  col: (typeof COLUMNS)[number];
  orders: BoardOrder[];
  boardTotal: number;
}) {
  const total = orders.length;
  const percent = boardTotal > 0 ? Math.round((total / boardTotal) * 100) : 0;
  const late = col.key === "open" || col.key === "in_progress" ? orders.filter((w) => w.due?.late || w.pmRound?.late).length : 0;
  const segments = total === 0 ? [] : [
    ...(total - late > 0 ? [{ pct: ((total - late) / total) * 100, color: col.color }] : []),
    ...(late > 0 ? [{ pct: (late / total) * 100, color: M.red }] : []),
  ];
  return (
    <div
      className="relative mb-2.5 h-[42px] w-full shrink-0 overflow-hidden rounded-xl border border-(--line) bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
      title={`${col.title} ${total} ใบ · ${percent}% ของบอร์ด${late > 0 ? ` · เลยกำหนด ${late}` : ""}`}
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
        {late > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">เลย {late}</span>
        )}
      </span>
    </div>
  );
}

/** รายการการ์ดในคอลัมน์เดียว — จัดกลุ่มหรือไม่ก็ได้ */
function ColumnList({
  orders,
  propertyNames,
  creatorNames,
  byPriority,
  gap,
  emptyClass,
}: {
  orders: BoardOrder[];
  propertyNames: Record<string, string>;
  creatorNames: Record<string, string>;
  byPriority: boolean;
  gap: string;
  emptyClass: string;
}) {
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
    />
  );

  const groups = byPriority ? groupByPriority(orders) : [];
  // กลุ่มเดียวไม่ต้องขึ้นหัวกลุ่ม — หัวข้อที่คลุมทั้งคอลัมน์ไม่ได้บอกอะไรเพิ่ม
  if (groups.length <= 1) {
    return <div className={`flex flex-col ${gap}`}>{orders.map(card)}</div>;
  }

  // ไม่มีหัวกลุ่มความสำคัญแล้ว (ผู้ใช้ 3/11/2569 "เอาออกเลย") — ยังเรียงด่วนก่อน ความสำคัญดูจากจุดสีบนการ์ด แบบบอร์ดงาน
  return <div className={`flex flex-col ${gap}`}>{groups.flatMap((g) => g.orders).map(card)}</div>;
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
function FilterChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[10px] border px-3 text-[13px] transition-colors"
      style={
        selected
          ? {
              backgroundColor: "var(--app-soft)",
              borderColor: "var(--line)",
              color: "#365B55",
            }
          : {
              backgroundColor: "var(--bg)",
              borderColor: "var(--line)",
              color: "#365B55",
            }
      }
    >
      {selected && (
        <Check
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: "var(--app-strong)" }}
        />
      )}
      {children}
    </button>
  );
}

/*
 * บ้าน/หมวดที่เลือกไว้ต้องอยู่รอดตอนกดเข้าใบงานแล้วกดกลับ — เดิมเป็น useState ล้วน
 * กลับมาทีไรเด้งไป "ทุกบ้าน" ต้องเลือกใหม่ทุกครั้ง ปุ่มกลับของหน้ารายละเอียดเป็นลิงก์ตายตัว
 * (/maintenance/work-orders) จึงจำไว้สองที่: URL (รีเฟรช/แชร์ลิงก์ได้) + sessionStorage
 * (กลับมาจากลิงก์ที่ไม่มี query) · sessionStorage = ต่อแท็บ ปิดแท็บแล้วลืมเอง
 */
const FILTER_KEY = "sb-wo-board-filter";
type BoardFilter = { group: string | null; house: string | null; tab: number; who?: string | null };

function readSavedFilter(): BoardFilter | null {
  const q = new URLSearchParams(window.location.search);
  if (q.has("group") || q.has("house") || q.has("tab")) {
    return { group: q.get("group"), house: q.get("house"), tab: Number(q.get("tab")) || 0, who: q.get("who") };
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
  for (const [k, v] of [["group", f.group], ["house", f.house], ["tab", f.tab ? String(f.tab) : null], ["who", f.who ?? null]] as const) {
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
  propertyNames,
  propertyCategories,
  creatorNames,
  currentUserId,
  canPickPeople = true,
}: {
  orders: BoardOrder[];
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
}) {
  // ช่องบนแถบหัว (หน้าใบงานส่ง leading = <div id="wo-board-toolbar">) — หาเจอหลังเมาท์ แล้ววางตัวกรองผ่าน portal
  // เซิร์ฟเวอร์ = null (วาดตัวกรองไว้ในบอร์ดก่อน ตรงกับ HTML ที่ส่งมา) · ฝั่งเครื่อง = ช่องจริง แล้วย้ายขึ้นแถบหัว
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
  const assigneeOptions = useMemo(() => {
    const ids = new Set(orders.map((w) => w.assignedTo).filter((id): id is string => !!id));
    return [...ids]
      .map((id) => ({ id, name: creatorNames[id] ?? "ไม่ทราบชื่อ" }))
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [orders, creatorNames]);
  const hasUnassigned = orders.some((w) => !w.assignedTo);
  const restored = useRef(false);

  // เฉพาะบ้านที่มีใบงานจริง
  const { groups, housesInGroup } = useMemo(() => {
    const used = new Set<string>();
    for (const w of orders) {
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
    return {
      groups: keys,
      housesInGroup: group ? (map.get(group) ?? []) : [],
    };
  }, [orders, propertyNames, propertyCategories, group]);

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
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [groups, propertyNames, propertyCategories]);

  useEffect(() => {
    if (restored.current) saveFilter({ group, house: houseId, tab, who: assignee });
  }, [group, houseId, tab, assignee]);

  const visible = useMemo(() => {
    const byPerson =
      assignee === null
        ? orders
        : orders.filter((w) => {
            if (assignee === UNASSIGNED) return !w.assignedTo;
            // ได้รับมอบหมาย = เป็นผู้รับผิดชอบ · ฉันมอบหมาย = เปิดใบงานแล้วให้คนอื่นรับผิดชอบ
            if (assignee === ASSIGNED_TO_ME) return !!currentUserId && w.assignedTo === currentUserId;
            if (assignee === ASSIGNED_BY_ME)
              return !!currentUserId && w.createdBy === currentUserId && !!w.assignedTo && w.assignedTo !== currentUserId;
            return w.assignedTo === assignee;
          });
    if (houseId) {
      return byPerson.filter(
        (w) => w.propertyId === houseId || w.additionalPropertyIds.includes(houseId)
      );
    }
    if (!group) return byPerson;
    return byPerson.filter((w) =>
      [w.propertyId, ...w.additionalPropertyIds].some(
        (id) => (propertyCategories[id] ?? NO_CATEGORY) === group
      )
    );
  }, [orders, group, houseId, propertyCategories, assignee, currentUserId]);

  const buckets: Record<string, BoardOrder[]> = {
    open: visible.filter((w) => w.status === "open"),
    in_progress: visible.filter((w) => w.status === "in_progress"),
    /*
     * "ยังไม่บันทึกค่าใช้จ่าย" = ปิดงานแล้ว ต้องกรอกค่าใช้จ่าย แต่ยังไม่ได้กรอก
     *
     * ใบที่ตั้งไว้ว่า requiresExpense = false ไม่มีอะไรให้กรอกตั้งแต่แรก ⇒ ปิดงาน
     * แล้วต้องไปอยู่ "เสร็จแล้ว" เลย · เดิมเช็คแค่ !hasExpense ใบพวกนี้เลยไปค้าง
     * ในคอลัมน์ทวงค่าใช้จ่ายตลอดกาล ทั้งที่หน้ารายละเอียดบอกเองว่า "งานนี้ไม่มี
     * ค่าใช้จ่าย — ปิดงานได้โดยไม่ต้องกรอก" (ตัวเตือนทาง LINE ใน data/cron.ts
     * กรองด้วย requiresExpense ถูกอยู่แล้ว ตกหล่นเฉพาะฝั่งหน้าจอ)
     */
    no_expense: visible.filter(
      (w) => w.status === "completed" && w.requiresExpense && !w.hasExpense
    ),
    done: visible.filter(
      (w) =>
        w.status === "cancelled" ||
        (w.status === "completed" && (w.hasExpense || !w.requiresExpense))
    ),
  };
  const boardTotal = COLUMNS.reduce((n, c) => n + (buckets[c.key]?.length ?? 0), 0);

  // ช่องเลือกบ้านบนแถบหัว (จอใหญ่) — ทุกบ้าน / ทั้งหมวด / รายหลัง ในช่องเดียว แบบช่องผู้รับผิดชอบ (ผู้ใช้ 3/11/2569 แบบ B)
  // มือถือแถบหัวแคบ ไม่พอใส่ ⇒ ยังใช้แถวปุ่มบ้านใต้แถบหัวเหมือนเดิม (ซ่อนช่องนี้ใต้ lg)
  const houseSelect =
    groups.length > 1 ? (
      <label className="relative hidden h-9 shrink-0 items-center rounded-(--radius) border border-(--line) bg-(--bg) pl-3 pr-8 text-sm lg:inline-flex">
        <span className="mr-1 text-(--ink-soft)">🏠 บ้าน:</span>
        <select
          aria-label="กรองตามบ้าน"
          className="appearance-none bg-transparent pr-1 font-medium text-(--ink) outline-none"
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
        <span className="pointer-events-none absolute right-2.5 text-(--ink-soft)" aria-hidden="true">▾</span>
      </label>
    ) : null;

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
        (personFilter || houseSelect) &&
        createPortal(
          <div className="flex min-w-0 items-center gap-2">
            {personFilter}
            {houseSelect}
          </div>,
          toolbarSlot,
        )}
      {/* ─── กรองตามบ้าน: แถวบน = หมวด, แถวล่าง = บ้านในหมวด ─── */}
      {/* ตัวกรองผู้รับผิดชอบขึ้นแถบหัวแล้ว — แถวนี้เหลือแค่ปุ่มบ้าน ไม่มีบ้านให้เลือกก็ไม่ต้องมีแถวว่าง */}
      {(groups.length > 1 || (!toolbarSlot && personFilter !== null)) && (
        // มีช่องบนแถบหัวแล้ว: แถวปุ่มบ้านเหลือแค่มือถือ (จอใหญ่ใช้ช่องเลือกบ้านบนแถบหัว)
        <div className={`shrink-0 ${toolbarSlot && groups.length > 1 ? "lg:hidden" : ""}`}>
          <div className="flex gap-2 overflow-x-auto px-3 py-1.5">
            {/* ตัวกรองผู้รับผิดชอบอยู่บนแถบหัวซ้าย แบบบอร์ดงาน (ผู้ใช้ 2/11/2569) — ไม่มีช่องบนแถบหัว ค่อยวางตรงนี้ */}
            {!toolbarSlot && personFilter}
            {groups.length > 1 && (
            <FilterChip
              selected={group === null && houseId === null}
              onClick={() => {
                setGroup(null);
                setHouseId(null);
              }}
            >
              ทุกบ้าน
            </FilterChip>
            )}
            {groups.length > 1 && groups.map((g) => (
              <FilterChip
                key={g}
                selected={group === g}
                onClick={() => {
                  setGroup(group === g ? null : g);
                  setHouseId(null);
                }}
              >
                {g}
              </FilterChip>
            ))}
          </div>

          {housesInGroup.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-3 py-1.5">
              <FilterChip
                selected={houseId === null}
                onClick={() => setHouseId(null)}
              >
                ทุกหลังในหมวด
              </FilterChip>
              {housesInGroup.map(([id, name]) => (
                <FilterChip
                  key={id}
                  selected={houseId === id}
                  onClick={() => setHouseId(houseId === id ? null : id)}
                >
                  {name}
                </FilterChip>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── มือถือ: แท็บ 4 สถานะ ─── */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-(--line)">
          {COLUMNS.map((c, i) => (
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
              {buckets[c.key]!.length > 0 && (
                <span
                  className="rounded-[10px] px-1.5 py-px text-[10px] font-bold text-white"
                  style={{ backgroundColor: c.color }}
                >
                  {buckets[c.key]!.length}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* แถบแท็บอยู่กับที่ เลื่อนเฉพาะรายการ — แบบเดียวกับคอลัมน์ฝั่งจอใหญ่ */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ColumnList
            orders={buckets[COLUMNS[tab]!.key]!}
            propertyNames={propertyNames}
            creatorNames={creatorNames}
            byPriority={COLUMNS[tab]!.byPriority}
            gap="gap-3"
            emptyClass="py-10 text-center text-sm text-(--ink-soft)"
          />
        </div>
      </div>

      {/* ─── จอใหญ่: Kanban 4 คอลัมน์ คั่นด้วยเส้นตั้ง แต่ละคอลัมน์เลื่อนแยกกัน ─── */}
      <div className="hidden min-h-0 flex-1 lg:flex">
        {COLUMNS.map((c, i) => (
          <div
            key={c.key}
            // แบบบอร์ดงาน: คอลัมน์มีระยะห่างกัน หัวเป็นกล่องลอย (ไม่ใช่แถบเต็มความกว้างคั่นเส้นตั้ง)
            className={`flex min-w-0 flex-1 flex-col px-1.5 pt-2.5 ${i === 0 ? "pl-2.5" : ""} ${i === COLUMNS.length - 1 ? "pr-2.5" : ""}`}
          >
            <ColumnHeader col={c} orders={buckets[c.key]!} boardTotal={boardTotal} />

            <div className="min-h-0 flex-1 overflow-y-auto pb-2.5">
              <ColumnList
                orders={buckets[c.key]!}
                propertyNames={propertyNames}
                creatorNames={creatorNames}
                byPriority={c.byPriority}
                gap="gap-2.5"
                emptyClass="px-2 py-8 text-center text-sm text-[#B0BEC5]"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
