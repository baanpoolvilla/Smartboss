"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import {
  Home as HomeIcon,
  User,
  RefreshCw,
  ReceiptText,
  Check,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import {
  AUTO_GROUP_KEY,
  groupByPriority,
  priorityLabel,
  type PriorityGroup,
} from "@/modules/maintenance/lib/priority";

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
  autoCreated: boolean;
  createdAtLabel: string;
  hasExpense: boolean;
}

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

/** สีของแต่ละความเร่งด่วน — label กับลำดับมาจาก lib/priority.ts */
const PRIORITY_COLOR: Record<string, string> = {
  urgent: M.red,
  high: M.orange,
  medium: M.blue,
  low: M.grey,
};

function priorityColor(p: string): string {
  return PRIORITY_COLOR[p] ?? M.blue;
}

/** สีของหัวกลุ่ม — งานอัตโนมัติใช้สีของโมดูล ไม่ใช่แดง/ส้มที่แปลว่าเร่งด่วน */
function groupColor(key: string): string {
  return key === AUTO_GROUP_KEY ? "#0D9488" : priorityColor(key);
}

/** หมวดบ้านจากชื่อ เช่น "BS-M4" → "BS-M" (ตรงกับ _getPropertyGroup เดิม) */
export function propertyGroup(name: string): string {
  const m = /^([A-Za-z]+-[A-Za-z]+)/.exec(name);
  if (m) return m[1]!.toUpperCase();
  const fb = /^(.+?)\d+$/.exec(name);
  if (fb) return fb[1]!.toUpperCase();
  return name.toUpperCase();
}

function PriorityBadge({ priority }: { priority: string }) {
  const color = priorityColor(priority);
  return (
    <span
      className="shrink-0 rounded px-2 py-0.5 text-[11px] font-bold"
      style={{
        color,
        backgroundColor: `${color}1a`,
        border: `1px solid ${color}4d`,
      }}
    >
      {priorityLabel(priority)}
    </span>
  );
}

/** หัวกลุ่มบาง ๆ คั่นระหว่างระดับความเร่งด่วน */
function GroupHeader({ group }: { group: PriorityGroup<BoardOrder> }) {
  const color = groupColor(group.key);
  return (
    <div className="flex items-center gap-1.5 px-1 pt-1">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="text-[11px] font-bold tracking-wide" style={{ color }}>
        {group.label}
      </span>
      <span className="text-[11px] text-(--ink-soft)">{group.orders.length}</span>
      <span className="ml-1 h-px flex-1 bg-(--line)" />
    </div>
  );
}

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
  creatorName,
}: {
  wo: BoardOrder;
  propertyName: string;
  creatorName?: string;
}) {
  const isNew = wo.status === "open";
  return (
    <Link href={`/maintenance/work-orders/${wo.id}`} className="block">
      <Card
        className="p-3 pl-[11px] transition-colors hover:bg-(--app-pale)"
        style={{
          borderLeft: `3px solid ${isNew ? M.redShade400 : "transparent"}`,
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] tracking-tight text-(--ink-soft)">
              {wo.code}
            </p>
            <p className="line-clamp-2 text-sm font-bold text-(--ink)">
              {wo.title}
            </p>
          </div>
          {/*
            งานอัตโนมัติไม่แสดงความเร่งด่วน — cron ใส่ medium ให้ทุกใบโดยไม่มีใคร
            ประเมิน ป้าย "ปานกลาง" จึงเป็นข้อมูลลวง งานพวกนี้ถึงกำหนดก็ต้องทำอยู่แล้ว
          */}
          {wo.autoCreated ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{ color: "var(--app)", backgroundColor: "#0D94881f" }}
            >
              <RefreshCw className="h-2.5 w-2.5" /> อัตโนมัติ
            </span>
          ) : (
            <PriorityBadge priority={wo.priority} />
          )}
        </div>

        <div className="mt-1 flex items-center gap-3 text-xs text-(--ink-soft)">
          <span className="inline-flex min-w-0 items-center gap-1">
            <HomeIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{propertyName}</span>
          </span>
          {creatorName && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {creatorName}
            </span>
          )}
        </div>

        {wo.description && (
          <p className="mt-1 line-clamp-2 text-xs text-(--ink-soft)">
            {wo.description}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between">
          {wo.status === "completed" ? (
            <span
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px]"
              style={{
                color: wo.hasExpense ? M.green : M.orange,
                backgroundColor: wo.hasExpense ? `${M.green}1a` : `${M.orange}1a`,
                border: `1px solid ${wo.hasExpense ? M.green : M.orange}4d`,
              }}
            >
              <ReceiptText className="h-3 w-3" />
              {wo.hasExpense ? "บันทึกค่าใช้จ่ายแล้ว" : "ยังไม่บันทึกค่าใช้จ่าย"}
            </span>
          ) : (
            <span />
          )}
          <span className="text-[11px] text-(--ink-soft)">
            {wo.createdAtLabel}
          </span>
        </div>
      </Card>
    </Link>
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
    <div className="mx-auto flex max-w-4xl flex-col gap-3 p-4 sm:p-5">
      {orders.map((wo) => (
        <OrderCard
          key={wo.id}
          wo={wo}
          propertyName={propertyNames[wo.propertyId] ?? ""}
          creatorName={wo.createdBy ? creatorNames[wo.createdBy] : undefined}
        />
      ))}
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
    />
  );

  const groups = byPriority ? groupByPriority(orders) : [];
  // กลุ่มเดียวไม่ต้องขึ้นหัวกลุ่ม — หัวข้อที่คลุมทั้งคอลัมน์ไม่ได้บอกอะไรเพิ่ม
  if (groups.length <= 1) {
    return <div className={`flex flex-col ${gap}`}>{orders.map(card)}</div>;
  }

  return (
    <div className={`flex flex-col ${gap}`}>
      {groups.map((g) => (
        <Fragment key={g.key}>
          <GroupHeader group={g} />
          {g.orders.map(card)}
        </Fragment>
      ))}
    </div>
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

export function WorkOrderBoard({
  orders,
  propertyNames,
  creatorNames,
}: {
  orders: BoardOrder[];
  propertyNames: Record<string, string>;
  creatorNames: Record<string, string>;
}) {
  const [group, setGroup] = useState<string | null>(null);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

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
      const g = propertyGroup(e[1]);
      const list = map.get(g) ?? [];
      list.push(e);
      map.set(g, list);
    }
    return {
      groups: Array.from(map.keys()).sort(),
      housesInGroup: group ? (map.get(group) ?? []) : [],
    };
  }, [orders, propertyNames, group]);

  const visible = useMemo(() => {
    if (houseId) {
      return orders.filter(
        (w) => w.propertyId === houseId || w.additionalPropertyIds.includes(houseId)
      );
    }
    if (!group) return orders;
    return orders.filter((w) =>
      [w.propertyId, ...w.additionalPropertyIds].some((id) => {
        const name = propertyNames[id];
        return name ? propertyGroup(name) === group : false;
      })
    );
  }, [orders, group, houseId, propertyNames]);

  const buckets: Record<string, BoardOrder[]> = {
    open: visible.filter((w) => w.status === "open"),
    in_progress: visible.filter((w) => w.status === "in_progress"),
    no_expense: visible.filter((w) => w.status === "completed" && !w.hasExpense),
    done: visible.filter(
      (w) => w.status === "cancelled" || (w.status === "completed" && w.hasExpense)
    ),
  };

  return (
    <div className="flex flex-col lg:h-full">
      {/* ─── กรองตามบ้าน: แถวบน = หมวด, แถวล่าง = บ้านในหมวด ─── */}
      {groups.length > 1 && (
        <div className="shrink-0">
          <div className="flex gap-2 overflow-x-auto px-3 py-1.5">
            <FilterChip
              selected={group === null && houseId === null}
              onClick={() => {
                setGroup(null);
                setHouseId(null);
              }}
            >
              ทุกบ้าน
            </FilterChip>
            {groups.map((g) => (
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
      <div className="lg:hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-(--line)">
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
        <div className="p-3">
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
            className={`flex min-w-0 flex-1 flex-col ${
              i > 0 ? "border-l border-(--line)" : ""
            }`}
          >
            <div
              className="flex shrink-0 items-center gap-2 px-4 py-2.5"
              style={{
                backgroundColor: `${c.color}14`,
                borderBottom: `1px solid ${c.color}33`,
              }}
            >
              <ColumnIcon col={c.key} color={c.color} />
              <span
                className="truncate text-sm font-bold"
                style={{ color: c.color }}
              >
                {c.title}
              </span>
              <span
                className="ml-auto shrink-0 rounded-xl px-2 py-0.5 text-xs font-bold"
                style={{ color: c.color, backgroundColor: `${c.color}26` }}
              >
                {buckets[c.key]!.length}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
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
