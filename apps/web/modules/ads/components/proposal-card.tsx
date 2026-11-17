"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";
import { fmtMoney, fmtNum } from "../lib/format";
import {
  PROPOSAL_STATUS,
  PROPOSAL_TYPE_LABEL,
  REJECT_REASONS,
  RISK_LABEL,
  canDecideFor,
  negativeKeywords,
  numberOf,
  numericField,
  type ProposalView,
} from "../lib/proposal-types";

/**
 * การ์ดคำขอปรับ Google Ads — ใช้ทั้งในห้องแชท "🤖 Ads Agent" และหน้าแดชบอร์ด/คำขอปรับ
 *
 * ปุ่มเป็นแค่ "ทางกด" — เซิร์ฟเวอร์ตรวจสิทธิ์ สถานะ วันหมดอายุ และเพดานใหม่ทุกครั้ง
 * หลังกด การ์ดเปลี่ยนเองทางท่อสด (chat.message.updated) · หน้าแดชบอร์ดสั่ง refresh เพิ่ม
 */

const TONE: Record<string, string> = {
  wait: "bg-[#FEF7E0] text-[#8a5a00]",
  run: "bg-[#E8F0FE] text-[#1A73E8]",
  ok: "bg-[#E6F4EA] text-[#137333]",
  bad: "bg-[#FCE8E6] text-[#B3261E]",
  muted: "bg-(--bg-soft) text-(--ink-soft)",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function decide(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/ads/proposals/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? "ทำรายการไม่สำเร็จ");
}

export function AdsProposalCard({
  proposal,
  viewerId,
  refreshOnDone = false,
}: {
  proposal: ProposalView | null;
  /** คนที่ดูอยู่ — ส่งมา = คิดปุ่มเองจาก deciderIds (การ์ดในกลุ่มแชท) · ไม่ส่ง = ใช้ canDecide ที่เซิร์ฟเวอร์คิดให้ */
  viewerId?: string;
  refreshOnDone?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  if (!proposal) {
    return <div className="rounded-2xl border border-(--line) bg-(--bg) px-3 py-2 text-[13px] text-(--ink-soft)">คำขอปรับนี้ถูกลบแล้ว</div>;
  }
  const p = proposal;
  const st = PROPOSAL_STATUS[p.status];
  const canDecide = viewerId ? canDecideFor(viewerId, p) : p.canDecide;
  const open = p.status === "pending" && canDecide;
  const field = numericField(p.type);
  const keywords = p.type === "add_negative_keywords" ? negativeKeywords(p.proposed) : [];
  const approvedKeywords = p.approved ? new Set(negativeKeywords(p.approved).map((k) => k.text)) : null;
  const selected = picked ?? new Set(keywords.map((k) => k.text));
  const money = (v: number | null) => (p.type === "set_campaign_budget" || p.type === "set_keyword_bid" ? fmtMoney(v, p.currency) : fmtNum(v));

  const run = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await decide(p.id, body);
      toast.success(done);
      setMode("view");
      if (refreshOnDone) router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    if (p.type === "add_negative_keywords") {
      if (selected.size === 0) return toast.error("เลือกอย่างน้อย 1 คำ");
      return run({ action: "approve", keywords: [...selected] }, `อนุมัติ ${selected.size} คำแล้ว`);
    }
    if (mode === "edit" && field) {
      const v = Number(value);
      if (!Number.isFinite(v) || v <= 0) return toast.error("ใส่ตัวเลขมากกว่า 0");
      return run({ action: "approve", value: v }, "อนุมัติค่าที่แก้แล้ว");
    }
    return run({ action: "approve" }, "อนุมัติแล้ว");
  };

  const before = field ? numberOf(p.before?.[field]) : null;
  const proposedNum = field ? numberOf(p.proposed[field]) : null;
  const approvedNum = field && p.approved ? numberOf(p.approved[field]) : null;
  const shownNum = approvedNum ?? proposedNum;
  const editNum = Number(value);
  const editPct = before && Number.isFinite(editNum) && editNum > 0 ? ((editNum - before) / before) * 100 : null;
  const pctOf = (v: number | null) => (before && v != null ? ((v - before) / before) * 100 : null);

  return (
    <div className="w-[min(440px,78vw)] overflow-hidden rounded-2xl border border-(--line) bg-(--bg) text-[13px] text-(--ink) shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="flex items-center gap-2 border-b border-(--line) px-3 py-2">
        <span className="font-semibold">{PROPOSAL_TYPE_LABEL[p.type]}</span>
        <span className="text-[11px] text-(--ink-soft)">{p.code}</span>
        <span className={cn("ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[st.tone])}>{st.label}</span>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="text-[12px] text-(--ink-soft)">
          {[p.campaignName && `แคมเปญ ${p.campaignName}`, p.adGroupName && `กลุ่ม ${p.adGroupName}`, p.targetName && p.type !== "set_campaign_budget" && p.targetName]
            .filter(Boolean)
            .join(" · ")}
        </div>

        {p.type === "add_negative_keywords" && (
          <div className="flex flex-col gap-0.5">
            <div className="text-[11px] text-(--ink-soft)">ระดับ{p.proposed.level === "campaign" ? "แคมเปญ" : "กลุ่มโฆษณา"} · ติ๊กออกได้ก่อนอนุมัติ</div>
            {keywords.map((k) => {
              const on = approvedKeywords ? approvedKeywords.has(k.text) : selected.has(k.text);
              return (
                <label key={k.text} className={cn("grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-0.5 tabular-nums", open && "hover:bg-(--bg-soft)")}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!open || busy}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(k.text);
                      else next.delete(k.text);
                      setPicked(next);
                    }}
                  />
                  <span className={cn("min-w-0 break-words", !on && "text-(--ink-soft) line-through")}>
                    {k.text} <span className="text-[11px] text-(--ink-soft)">{k.match_type.toLowerCase()}</span>
                  </span>
                  <span className="text-right text-[11.5px] text-(--ink-soft)">
                    {k.clicks != null && `${fmtNum(k.clicks)} คลิก`}
                    {k.cost != null && ` · ${fmtMoney(k.cost, p.currency)}`}
                    {k.conversions != null && ` · conv ${fmtNum(k.conversions, k.conversions % 1 ? 2 : 0)}`}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {(p.type === "pause_keyword" || p.type === "pause_ad_group" || p.type === "enable_keyword" || p.type === "enable_ad_group") && (
          <div className="text-[15px] font-semibold">
            {p.targetName ?? p.adGroupName ?? ""} → {String(p.proposed.status) === "PAUSED" ? "หยุด" : "เปิด"}
          </div>
        )}

        {field && (
          <div className="flex flex-wrap items-baseline gap-2 tabular-nums">
            {before != null && <span className="text-(--ink-soft) line-through">{money(before)}</span>}
            <span className="text-[17px] font-bold">→ {money(shownNum)}</span>
            {pctOf(shownNum) != null && (
              <span className="rounded-full bg-[#E8F0FE] px-2 py-0.5 text-[11px] font-semibold text-[#1A73E8]">
                {pctOf(shownNum)! > 0 ? "+" : ""}
                {pctOf(shownNum)!.toFixed(0)}%
              </span>
            )}
            {approvedNum != null && proposedNum != null && approvedNum !== proposedNum && (
              <span className="text-[11px] text-(--ink-soft)">(AI เสนอ {money(proposedNum)} · แก้ตอนอนุมัติ)</span>
            )}
          </div>
        )}

        {mode === "edit" && field && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-(--bg-soft) px-2 py-1.5">
            <label htmlFor={`v-${p.id}`} className="text-[12px]">
              ค่าใหม่
            </label>
            <input
              id={`v-${p.id}`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-8 w-28 rounded-md border border-(--line) bg-(--bg) px-2 tabular-nums"
            />
            {editPct != null && (
              <span className={cn("text-[12px]", p.maxBudgetChangePct != null && Math.abs(editPct) > p.maxBudgetChangePct ? "text-[#B3261E]" : "text-(--ink-soft)")}>
                {editPct > 0 ? "+" : ""}
                {editPct.toFixed(1)}%{p.maxBudgetChangePct != null && Math.abs(editPct) > p.maxBudgetChangePct ? ` เกินเพดาน ${p.maxBudgetChangePct}%` : ""}
              </span>
            )}
          </div>
        )}

        <div className="whitespace-pre-wrap rounded-lg bg-(--bg-soft) px-2.5 py-2 leading-relaxed [overflow-wrap:anywhere]">{p.reason}</div>
        {p.evidence.length > 0 && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] tabular-nums">
            {p.evidence.map((e) => (
              <div key={e.label} className="contents">
                <dt className="text-(--ink-soft)">{e.label}</dt>
                <dd className="m-0 [overflow-wrap:anywhere]">{e.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {p.expectedImpact && <div className="text-[12px]">ผลที่คาด: {p.expectedImpact}</div>}
        <div className="text-[11.5px] text-(--ink-soft)">
          ความเสี่ยง {RISK_LABEL[p.risk] ?? p.risk} · {p.source === "command" ? `สั่งโดย ${p.requestedByName ?? "ผู้ใช้"}` : "AI เสนอ"}
          {p.status === "pending" && ` · หมดอายุ ${fmtWhen(p.expiresAt)}`}
        </div>
      </div>

      {mode === "reject" && open && (
        <div className="flex flex-col gap-2 border-t border-(--line) px-3 py-2.5">
          <div className="text-[12px] font-semibold">เหตุผลที่ปฏิเสธ (AI จะใช้รอบหน้า)</div>
          <div className="flex flex-wrap gap-1.5">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cn("rounded-full border px-2.5 py-1 text-[12px]", reason === r ? "border-[#1A73E8] bg-[#E8F0FE] text-[#1A73E8]" : "border-(--line)")}
              >
                {r}
              </button>
            ))}
          </div>
          <label htmlFor={`r-${p.id}`} className="sr-only">
            เหตุผล
          </label>
          <input
            id={`r-${p.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="หรือพิมพ์เหตุผลเอง"
            className="h-8 rounded-md border border-(--line) bg-(--bg) px-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => run({ action: "reject", note: reason }, "ปฏิเสธแล้ว")}
              className="rounded-lg bg-[#B3261E] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              ยืนยันปฏิเสธ
            </button>
            <button type="button" onClick={() => setMode("view")} className="rounded-lg border border-(--line) px-3 py-1.5">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {open && mode !== "reject" && (
        <div className="flex flex-wrap gap-1.5 border-t border-(--line) px-3 py-2.5">
          <button type="button" disabled={busy} onClick={approve} className="rounded-lg bg-[#137333] px-3 py-1.5 font-semibold text-white disabled:opacity-50">
            ✅ {p.type === "add_negative_keywords" ? `อนุมัติ ${selected.size} คำ` : mode === "edit" ? "อนุมัติค่านี้" : "อนุมัติ"}
          </button>
          {field && mode === "view" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setValue(String(proposedNum ?? ""));
                setMode("edit");
              }}
              className="rounded-lg border border-(--line) px-3 py-1.5 font-semibold"
            >
              ✏️ แก้
            </button>
          )}
          {mode === "edit" && (
            <button type="button" onClick={() => setMode("view")} className="rounded-lg border border-(--line) px-3 py-1.5">
              ยกเลิกแก้
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setMode("reject")} className="rounded-lg border border-(--line) px-3 py-1.5 font-semibold text-[#B3261E]">
            ❌ ปฏิเสธ
          </button>
        </div>
      )}
      {p.status === "pending" && !canDecide && (
        <div className="border-t border-(--line) px-3 py-2 text-[12px] text-(--ink-soft)">
          {viewerId && p.requestedById === viewerId && !p.selfApprove ? "รอสมาชิกคนอื่นในกลุ่ม 🤖 Ads Agent อนุมัติ" : "เฉพาะสมาชิกกลุ่ม 🤖 Ads Agent กดอนุมัติได้"}
        </div>
      )}

      {(p.decidedAt || p.executedAt || p.error || p.measurements.length > 0) && (
        <div className="flex flex-col gap-0.5 border-t border-(--line) px-3 py-2 text-[12px]">
          {p.decidedAt && (
            <div>
              {p.status === "rejected" ? "❌ ปฏิเสธ" : "✅ อนุมัติ"}โดย {p.decidedByName ?? "ผู้ใช้"} · {fmtWhen(p.decidedAt)}
              {p.decisionNote && <span className="text-(--ink-soft)"> — {p.decisionNote}</span>}
            </div>
          )}
          {p.status === "approved" && <div className="text-(--ink-soft)">รอ n8n ปรับ Google Ads (ถ้าเครื่อง n8n ปิดอยู่ จะปรับเมื่อกลับมาออนไลน์)</div>}
          {p.status === "applied" && <div className="text-[#137333]">✓ ปรับ Google Ads สำเร็จ · {fmtWhen(p.executedAt)}</div>}
          {(p.status === "failed" || p.status === "stale") && p.error && <div className="text-[#B3261E]">⚠️ {p.error}</div>}
          {p.measurements.map((m) => (
            <div key={m.days}>
              📊 ผล {m.days} วัน: {m.summary}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
