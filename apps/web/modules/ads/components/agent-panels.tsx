import Link from "next/link";
import { cn } from "@smartboss/ui/cn";
import { fmtDateTime } from "../lib/format";
import { formatPeriod } from "../lib/periods";
import type { ProposalView } from "../lib/proposal-types";
import type { SummaryView } from "../data/summaries";
import { AdsProposalCard } from "./proposal-card";

/** แถบสถานะ n8n บนแดชบอร์ด — ออนไลน์ไหม · ส่งข้อมูลล่าสุดเมื่อไหร่ · คำขอที่รออยู่ */
export function AgentStatusBar({
  online,
  lastSeenAt,
  lastSyncedAt,
  pending,
  waitingExecution,
  canConfigure,
}: {
  online: boolean;
  lastSeenAt: Date | null;
  lastSyncedAt: Date | null;
  pending: number;
  waitingExecution: number;
  canConfigure: boolean;
}) {
  const cell = "flex min-w-0 flex-col gap-0.5 rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2";
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <div className={cell}>
        <span className="text-xs text-(--ink-soft)">n8n</span>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <span className={cn("h-2.5 w-2.5 rounded-full", online ? "bg-[#1e8e3e]" : "bg-[#d93025]")} aria-hidden />
          {online ? "ออนไลน์" : lastSeenAt ? "ออฟไลน์" : "ยังไม่เคยเชื่อมต่อ"}
        </span>
        <span className="truncate text-[11px] text-(--ink-soft)">
          {lastSeenAt ? `ติดต่อล่าสุด ${fmtDateTime(lastSeenAt)}` : canConfigure ? <Link href="/ads/settings/connection" className="underline">ตั้งค่าการเชื่อมต่อ</Link> : "ติดต่อผู้ดูแลระบบ"}
        </span>
      </div>
      <div className={cell}>
        <span className="text-xs text-(--ink-soft)">ข้อมูลโฆษณาล่าสุด</span>
        <span className="text-sm font-semibold">{lastSyncedAt ? fmtDateTime(lastSyncedAt) : "ยังไม่มี"}</span>
        <span className="text-[11px] text-(--ink-soft)">n8n ดึงจาก Google Ads แล้วส่งเข้ามา</span>
      </div>
      <Link href="/ads/proposals" className={cn(cell, "hover:bg-(--bg-soft)")}>
        <span className="text-xs text-(--ink-soft)">รออนุมัติ</span>
        <span className={cn("text-sm font-semibold tabular-nums", pending > 0 && "text-[#8a5a00]")}>{pending} คำขอ</span>
        <span className="text-[11px] text-(--ink-soft)">กดอนุมัติในแชท 🤖 Ads Agent ก็ได้</span>
      </Link>
      <div className={cell}>
        <span className="text-xs text-(--ink-soft)">อนุมัติแล้ว รอ n8n ปรับ</span>
        <span className={cn("text-sm font-semibold tabular-nums", waitingExecution > 0 && !online && "text-[#B3261E]")}>{waitingExecution} คำขอ</span>
        <span className="text-[11px] text-(--ink-soft)">{waitingExecution > 0 && !online ? "n8n ออฟไลน์ — จะปรับเมื่อกลับมา" : "ปกติปรับภายในไม่กี่วินาที"}</span>
      </div>
    </div>
  );
}

/** บทสรุปล่าสุดที่ AI บน n8n ส่งเข้ามา */
export function SummaryPanel({ summary }: { summary: SummaryView | null }) {
  if (!summary) {
    return <p className="text-sm text-(--ink-soft)">ยังไม่มีบทสรุปจาก n8n — n8n ส่งเข้ามาได้ที่ POST /api/agent/ads/summaries</p>;
  }
  const tone = { good: "text-[#137333]", bad: "text-[#B3261E]", neutral: "text-(--ink)" } as const;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-base font-semibold text-(--ink)">{summary.title}</div>
        <div className="text-xs text-(--ink-soft)">
          {summary.period ? `${formatPeriod(summary.period)} · ` : ""}ส่งมาเมื่อ {fmtDateTime(summary.createdAt)}
        </div>
      </div>
      {summary.highlights.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.highlights.map((h) => (
            <div key={h.label} className="rounded-(--radius) border border-(--line) px-3 py-1.5">
              <div className="text-[11px] text-(--ink-soft)">{h.label}</div>
              <div className={cn("text-sm font-semibold tabular-nums", tone[h.tone])}>{h.value}</div>
            </div>
          ))}
        </div>
      )}
      <p className="max-w-[80ch] whitespace-pre-wrap text-sm leading-7 text-(--ink) [overflow-wrap:anywhere]">{summary.body}</p>
    </div>
  );
}

/** รายการการ์ดคำขอปรับ — ใช้ทั้งแดชบอร์ด (ที่ค้างอยู่) และหน้าคำขอปรับ */
export function ProposalGrid({ proposals, empty }: { proposals: ProposalView[]; empty: string }) {
  if (proposals.length === 0) return <p className="text-sm text-(--ink-soft)">{empty}</p>;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3 [&>*>div]:w-full">
      {proposals.map((p) => (
        <div key={p.id} className="min-w-0">
          <AdsProposalCard proposal={p} refreshOnDone />
        </div>
      ))}
    </div>
  );
}
