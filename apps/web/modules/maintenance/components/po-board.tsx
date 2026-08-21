"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ReceiptText,
  ClipboardCheck,
  Truck,
  CheckCircle2,
  Undo2,
  Home as HomeIcon,
  UserCog,
  AlertTriangle,
  Plus,
  FileEdit,
  Package,
  CalendarDays,
  User,
  ClipboardList,
} from "lucide-react";
import { Card } from "@smartboss/ui/components/card";

export interface BoardPo {
  id: string;
  /** เลขที่ให้คนอ่าน เช่น PO-2569-0001 */
  code: string;
  title: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  propertyName: string;
  itemCount: number;
  totalPrice: number;
  assigneeName: string | null;
  isEmergency: boolean;
  /** เลขที่ใบงานต้นทาง ถ้าเปิดมาจากใบงาน (null = เปิดลอย ๆ) */
  workOrderCode: string | null;
  /** เฟสล่าสุด: label / ผู้ทำ / วันที่ */
  phase: { label: string; who: string; when: string; color: string };
}

export interface BoardReturn {
  id: string;
  poTitle: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  itemLabel: string;
  qty: number;
  problemLabel: string;
  propertyName: string;
  createdByName: string;
  createdAtLabel: string;
}

const PHASE_ICON: Record<string, typeof FileEdit> = {
  "เปิด PR": FileEdit,
  "สร้าง PO": ClipboardCheck,
  ดำเนินการซื้อ: Truck,
  รับของ: Package,
};

function PoCard({ po }: { po: BoardPo }) {
  const PhaseIcon = PHASE_ICON[po.phase.label] ?? FileEdit;
  return (
    <Link href={`/maintenance/purchase-orders/${po.id}`} className="block">
      <Card className="p-3 transition-colors hover:bg-(--bg-soft)">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] tracking-tight text-(--ink-soft)">
              {po.code}
            </p>
            <p className="line-clamp-2 text-sm font-bold text-(--ink)">{po.title}</p>
          </div>
          {po.isEmergency && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px]"
              style={{ color: "#B91C1C", backgroundColor: "#FEF2F2", border: "1px solid #FECACA" }}
            >
              <AlertTriangle className="h-2.5 w-2.5" /> ฉุกเฉิน
            </span>
          )}
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
            style={{
              color: po.statusColor,
              backgroundColor: `${po.statusColor}1a`,
              border: `1px solid ${po.statusColor}4d`,
            }}
          >
            {po.statusLabel}
          </span>
        </div>

        {po.propertyName && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-(--ink-soft)">
            <HomeIcon className="h-3 w-3" /> {po.propertyName}
          </p>
        )}
        {po.workOrderCode && (
          <p
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: "#0F766E" }}
          >
            <ClipboardList className="h-3 w-3" /> {po.workOrderCode}
          </p>
        )}
        {po.itemCount > 0 && (
          <p className="mt-1 text-xs text-(--ink-soft)">
            {po.itemCount} รายการ • ฿{po.totalPrice.toFixed(0)}
          </p>
        )}
        {po.assigneeName && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs" style={{ color: "#1D4ED8" }}>
            <UserCog className="h-3 w-3" /> มอบหมาย: {po.assigneeName}
          </p>
        )}

        <p className="mt-1.5 flex items-center gap-1 truncate text-xs text-(--ink-soft)">
          <PhaseIcon className="h-3 w-3 shrink-0" style={{ color: po.phase.color }} />
          <span style={{ color: po.phase.color, fontWeight: 600 }}>
            {po.phase.label} ·
          </span>
          <span className="text-(--ink)">{po.phase.who}</span>
          <span>· {po.phase.when}</span>
        </p>
      </Card>
    </Link>
  );
}

function ReturnCard({ r }: { r: BoardReturn }) {
  return (
    <Link href={`/maintenance/purchase-orders/returns/${r.id}`} className="block">
      <Card className="p-3 transition-colors hover:bg-(--bg-soft)">
        <div className="flex items-start gap-2">
          <p className="line-clamp-2 flex-1 text-sm font-bold text-(--ink)">
            {r.poTitle}
          </p>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
            style={{
              color: r.statusColor,
              backgroundColor: `${r.statusColor}1a`,
              border: `1px solid ${r.statusColor}4d`,
            }}
          >
            {r.statusLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-(--ink-soft)">
          {r.itemLabel} ×{r.qty} • {r.problemLabel}
        </p>
        {r.propertyName && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-(--ink-soft)">
            <HomeIcon className="h-3 w-3" /> {r.propertyName}
          </p>
        )}
        <p className="mt-1.5 flex items-center gap-3 text-xs text-(--ink-soft)">
          <span className="inline-flex items-center gap-1">
            <User className="h-3 w-3" /> {r.createdByName}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> {r.createdAtLabel}
          </span>
        </p>
      </Card>
    </Link>
  );
}

const COLUMNS = [
  { key: "pending", title: "PR", subtitle: "รอ CEO อนุมัติ", color: "#EA580C", Icon: ReceiptText },
  { key: "approved", title: "PO ที่ได้รับ", subtitle: "CEO อนุมัติแล้ว", color: "#2563EB", Icon: ClipboardCheck },
  { key: "ordered", title: "กำลังดำเนินการ", subtitle: "กำลังซื้อของ", color: "#4F46E5", Icon: Truck },
  { key: "done", title: "เสร็จสิ้น", subtitle: "รับของแล้ว / ยกเลิก", color: "#6B7280", Icon: CheckCircle2 },
] as const;

const TAB_LABEL = ["PR", "PO ที่ได้รับ", "ดำเนินการ", "เสร็จสิ้น", "คืน/ปัญหา"];
const BROWN = "#795548";

export function PoBoard({
  orders,
  returns,
  initialTab,
}: {
  orders: BoardPo[];
  returns: BoardReturn[];
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab === "returns" ? 4 : 0);

  const buckets: Record<string, BoardPo[]> = {
    pending: orders.filter((o) => o.status === "pending"),
    approved: orders.filter((o) => o.status === "approved"),
    ordered: orders.filter((o) => o.status === "ordered"),
    done: orders.filter((o) => o.status === "received" || o.status === "cancelled"),
  };
  const openReturns = returns.filter(
    (r) => r.status === "pending" || r.status === "processing"
  );
  const counts = [
    buckets.pending!.length,
    buckets.approved!.length,
    buckets.ordered!.length,
    buckets.done!.length,
    openReturns.length,
  ];
  const tabColors = ["#EA580C", "#2563EB", "#4F46E5", "#6B7280", BROWN];

  return (
    <div>
      {/* ─── มือถือ: 5 แท็บ ─── */}
      <div className="xl:hidden">
        <div className="mb-3 flex gap-1 overflow-x-auto border-b border-(--line)">
          {TAB_LABEL.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setTab(i)}
              className="flex shrink-0 items-center gap-1 border-b-2 px-3 py-2 text-xs"
              style={{
                borderColor: tab === i ? tabColors[i] : "transparent",
                color: tab === i ? tabColors[i] : "var(--ink-soft)",
                fontWeight: tab === i ? 700 : 400,
              }}
            >
              {label}
              {counts[i]! > 0 && (
                <span
                  className="rounded-full px-1.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: tabColors[i] }}
                >
                  {counts[i]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {tab === 4 ? (
            returns.length === 0 ? (
              <p className="py-10 text-center text-sm text-(--ink-soft)">
                ยังไม่มีรายการคืน/ปัญหา
              </p>
            ) : (
              returns.map((r) => <ReturnCard key={r.id} r={r} />)
            )
          ) : buckets[COLUMNS[tab]!.key]!.length === 0 ? (
            <p className="py-10 text-center text-sm text-(--ink-soft)">
              ไม่มีรายการ
            </p>
          ) : (
            buckets[COLUMNS[tab]!.key]!.map((po) => <PoCard key={po.id} po={po} />)
          )}
        </div>
      </div>

      {/* ─── จอกว้าง: Kanban 5 คอลัมน์ ─── */}
      <div className="hidden gap-4 xl:grid xl:grid-cols-5">
        {COLUMNS.map((c) => (
          <div key={c.key} className="flex min-w-0 flex-col">
            <div
              className="mb-2 flex items-center gap-2 rounded-(--radius) px-3 py-2"
              style={{ backgroundColor: `${c.color}14`, border: `1px solid ${c.color}33` }}
            >
              <c.Icon className="h-4 w-4 shrink-0" style={{ color: c.color }} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold" style={{ color: c.color }}>
                  {c.title}
                </p>
                <p className="truncate text-[11px]" style={{ color: `${c.color}b3` }}>
                  {c.subtitle}
                </p>
              </div>
              <span
                className="ml-auto rounded-full px-2 py-0.5 text-xs font-bold"
                style={{ color: c.color, backgroundColor: `${c.color}26` }}
              >
                {buckets[c.key]!.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {buckets[c.key]!.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-(--ink-soft)">
                  ไม่มีรายการ
                </p>
              ) : (
                buckets[c.key]!.map((po) => <PoCard key={po.id} po={po} />)
              )}
            </div>
          </div>
        ))}

        {/* คอลัมน์ที่ 5: คืน/ปัญหา */}
        <div className="flex min-w-0 flex-col">
          <div
            className="mb-2 flex items-center gap-2 rounded-(--radius) px-3 py-2"
            style={{ backgroundColor: `${BROWN}14`, border: `1px solid ${BROWN}33` }}
          >
            <Undo2 className="h-4 w-4 shrink-0" style={{ color: BROWN }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold" style={{ color: BROWN }}>
                คืน/ปัญหา
              </p>
              <p className="truncate text-[11px]" style={{ color: `${BROWN}b3` }}>
                คืนของ / ของมีปัญหา
              </p>
            </div>
            <span
              className="ml-auto rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ color: BROWN, backgroundColor: `${BROWN}26` }}
            >
              {openReturns.length}
            </span>
            <Link
              href="/maintenance/purchase-orders/returns/new"
              aria-label="แจ้งคืน/ปัญหา"
              style={{ color: BROWN }}
            >
              <Plus className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {returns.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-(--ink-soft)">
                ไม่มีรายการ
              </p>
            ) : (
              returns.map((r) => <ReturnCard key={r.id} r={r} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
