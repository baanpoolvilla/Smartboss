"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send, Sparkles } from "lucide-react";
import { ACTION_STATUSES, ACTION_STATUS_LABEL } from "../constants";

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
  return json;
}

/** ปุ่ม "ให้ AI วิเคราะห์ใหม่" (spec §6.6 ตามต้องการ) — POST /api/ads/ai-reports */
export function RunAnalysisButton({
  customerId,
  from,
  to,
  compare,
}: {
  customerId: string;
  from: string;
  to: string;
  compare: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { id } = await call("/api/ads/ai-reports", {
            method: "POST",
            body: JSON.stringify({ customer_id: customerId, from, to, compare }),
          });
          const q = new URLSearchParams({ customer_id: customerId, from, to, compare, report: String(id) });
          router.push(`/ads/analysis?${q.toString()}`);
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex h-9 items-center gap-2 rounded-(--radius) bg-[#1A73E8] px-4 text-sm font-medium text-white disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {busy ? "AI กำลังวิเคราะห์…" : "ให้ AI วิเคราะห์ใหม่"}
    </button>
  );
}

/** เลือกสถานะแผนปฏิบัติการ — PATCH /api/ads/ai-actions/{id} */
export function ActionStatusSelect({ actionId, status }: { actionId: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  return (
    <select
      value={value}
      onChange={async (e) => {
        const next = e.target.value;
        const prev = value;
        setValue(next);
        try {
          await call(`/api/ads/ai-actions/${actionId}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
          router.refresh();
        } catch (err) {
          setValue(prev);
          toast.error(err instanceof Error ? err.message : String(err));
        }
      }}
      className="h-8 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-xs text-(--ink)"
    >
      {ACTION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {ACTION_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/** ช่องถาม AI (spec §6.5) — AI เห็นแค่ input/output ของรายงานนี้ */
export function AskAi({ reportId }: { reportId: string }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {history.map((h, i) => (
        <div key={i} className="flex flex-col gap-1 text-sm">
          <div className="self-end rounded-(--radius) bg-[#EEF4FE] px-3 py-2 text-(--ink)">{h.q}</div>
          <div className="whitespace-pre-wrap rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-(--ink)">{h.a}</div>
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const q = question.trim();
          if (!q) return;
          setBusy(true);
          try {
            const { answer } = await call(`/api/ads/ai-reports/${reportId}/ask`, {
              method: "POST",
              body: JSON.stringify({ question: q, history }),
            });
            setHistory([...history, { q, a: String(answer) }]);
            setQuestion("");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="ถามเกี่ยวกับรายงานนี้ เช่น แคมเปญไหนควรปรับก่อน"
          className="h-10 flex-1 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center gap-1 rounded-(--radius) bg-[#1A73E8] px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} ถาม
        </button>
      </form>
    </div>
  );
}
