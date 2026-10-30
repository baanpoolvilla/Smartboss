"use client";

import { useEffect, useState } from "react";

interface PenaltyRequestItem {
  id: string;
  userId: string;
  submittedBy: string;
  refId: string;
  category: "report_missed" | "report_late";
  points: number;
  topicId: string;
  roundId: string;
  day: string;
  type: "retroactive" | "waive";
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  /** ขอส่งย้อนหลังที่อนุมัติแล้ว รอคนนั้นส่งรีพอต (คืนคะแนนเมื่อส่ง) */
  awaitingPost?: boolean;
  fulfilledAt?: string;
  retroDeadline?: string;
  userName: string;
}

const fmtShort = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** สถานะหลังตัดสิน — ขอส่งย้อนหลังที่อนุมัติแล้วแยก "รอส่ง" / "ส่งแล้ว" */
function decidedLabel(item: PenaltyRequestItem): { text: string; color: string } {
  if (item.status !== "approved") return { text: "✕ ไม่อนุมัติ", color: "#B42318" };
  if (!item.awaitingPost) return { text: "✓ อนุมัติแล้ว", color: "#15803D" };
  if (item.fulfilledAt) return { text: `✓ ส่งย้อนหลังแล้ว ${fmtShort.format(new Date(item.fulfilledAt))} · คืนคะแนน`, color: "#15803D" };
  const deadline = item.retroDeadline ? new Date(item.retroDeadline) : null;
  if (deadline && new Date() >= deadline) return { text: "✕ ไม่ส่งภายในกำหนด · ยังโดนหัก", color: "#B42318" };
  return {
    text: `⏳ อนุมัติแล้ว · รอส่งรีพอต${deadline ? ` (ถึง ${fmtShort.format(new Date(deadline.getTime() - 60_000))})` : ""}`,
    color: "#B54708",
  };
}

const TYPE_LABEL: Record<PenaltyRequestItem["type"], string> = {
  retroactive: "ขอส่งย้อนหลัง (มีเหตุสุดวิสัย)",
  waive: "ขอให้พิจารณายกเลิกการหักคะแนน",
};

const CATEGORY_LABEL: Record<PenaltyRequestItem["category"], string> = {
  report_missed: "ไม่ส่งรายงาน",
  report_late: "ส่งรายงานสาย",
};

/** คิวจริงของ /report-task/penalty-requests — โหลด/อนุมัติ/ไม่อนุมัติผ่าน API
 * ตรง ๆ (ไม่ใช่ ServerStoreSync — ข้อมูลนี้มีการตรวจสิทธิ์เฉพาะ ต้องผ่าน route
 * ที่เขียนไว้เท่านั้น ดู lib/db/report-penalty-requests.ts) */
export function PenaltyRequestsQueue() {
  const [items, setItems] = useState<PenaltyRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/report-task/reports/penalty-requests?all=1", { cache: "no-store" });
      const data = (await res.json()) as { items?: PenaltyRequestItem[] };
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function decide(id: string, decision: "approved" | "rejected") {
    setDecidingId(id);
    try {
      const res = await fetch(`/api/report-task/reports/penalty-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (res.ok) await load();
    } finally {
      setDecidingId(null);
    }
  }

  if (loading) {
    return <div className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--ink-soft)]">กำลังโหลด...</div>;
  }

  const pending = items.filter((i) => i.status === "pending");
  const decided = items.filter((i) => i.status !== "pending");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[var(--ink)]">รอดำเนินการ</div>
        {pending.length > 0 && (
          <span className="rounded-full bg-[#FEF0E1] px-3 py-1 text-xs font-semibold text-[#B45309]">
            {pending.length} รายการ
          </span>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--ink-soft)]">
          ไม่มีคำร้องรอดำเนินการ
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((item) => (
            <div key={item.id} className="rounded-2xl border border-[var(--line)] bg-white p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--ink)]">{item.userName}</div>
                  <div className="text-xs text-[var(--ink-soft)]">
                    ยื่นเมื่อ {new Date(item.createdAt).toLocaleString("th-TH")} · วันที่ {item.day}
                  </div>
                </div>
                <span className="rounded-full bg-[#FEE4E2] px-2.5 py-1 text-[11px] font-semibold text-[#B42318] whitespace-nowrap">
                  {CATEGORY_LABEL[item.category]} {item.points}
                </span>
              </div>
              <div className="rounded-lg bg-[var(--bg-soft)] p-3 text-sm text-[var(--ink)]">{item.reason}</div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--ink-soft)]">{TYPE_LABEL[item.type]}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={decidingId === item.id}
                    onClick={() => decide(item.id, "rejected")}
                    className="rounded-lg border border-[var(--line)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] disabled:opacity-50"
                  >
                    ไม่อนุมัติ
                  </button>
                  <button
                    type="button"
                    disabled={decidingId === item.id}
                    onClick={() => decide(item.id, "approved")}
                    className="rounded-lg bg-[#16A34A] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#15803D] disabled:opacity-50"
                  >
                    {item.type === "retroactive" && item.category !== "report_late" ? "อนุมัติ — ให้ส่งย้อนหลัง" : "อนุมัติ — คืนคะแนน"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <>
          <div className="mt-2 text-sm font-semibold text-[var(--ink)]">ตัดสินไปแล้ว</div>
          <div className="flex flex-col gap-2">
            {decided.map((item) => (
              <div key={item.id} className="rounded-xl border border-[var(--line)] bg-white p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ink)] truncate">{item.userName}</div>
                  <div className="text-xs text-[var(--ink-soft)] truncate">
                    {CATEGORY_LABEL[item.category]} {item.points} · {item.reason}
                  </div>
                </div>
                <span
                  className="text-xs font-semibold whitespace-nowrap"
                  style={{ color: decidedLabel(item).color }}
                >
                  {decidedLabel(item).text}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
