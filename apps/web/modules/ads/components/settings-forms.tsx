"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { METRIC_LABEL, STATUS_STYLE } from "../constants";
import { benchmarkError, METRICS, type BenchmarkMap, type Direction, type MetricKey } from "../lib/rules";

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
  return json;
}

const input = "h-9 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm text-(--ink)";
const primary = "h-10 rounded-(--radius) bg-[#1A73E8] px-5 text-sm font-medium text-white disabled:opacity-60";

const UNIT: Record<MetricKey, string> = {
  ctr: "%",
  cpc: "เงิน",
  conv_rate: "%",
  cpa: "เงิน",
  top_impr_pct: "%",
  abs_top_impr_pct: "%",
};

function Chip({ status, text }: { status: "good" | "normal" | "poor"; text: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: s.bg, color: s.fg }}>
      {s.label} {text}
    </span>
  );
}

/** เกณฑ์ 6 ตัวชี้วัด (spec §5.2) — ตรวจทิศทางก่อนบันทึก */
export function BenchmarksForm({
  customerId,
  initial,
  source,
}: {
  customerId: string | null;
  initial: BenchmarkMap;
  source: Record<MetricKey, "account" | "default">;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const usesOverride = customerId != null && METRICS.some((m) => source[m] === "account");
  const url = `/api/ads/benchmarks${customerId ? `?customer_id=${customerId}` : ""}`;

  const set = (m: MetricKey, patch: Partial<{ direction: Direction; poor: number; good: number }>) =>
    setValues({ ...values, [m]: { ...values[m], ...patch } });

  const save = async (body: unknown, done: string) => {
    setBusy(true);
    try {
      await call(url, { method: "PUT", body: JSON.stringify(body) });
      toast.success(done);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save(values, "บันทึกเกณฑ์แล้ว — สีในรายงานเปลี่ยนตามทันที");
      }}
    >
      {customerId && (
        <p className="text-xs text-(--ink-soft)">
          {usesOverride ? "บัญชีนี้ใช้เกณฑ์เฉพาะของตัวเอง" : "บัญชีนี้ยังใช้ค่าเริ่มต้นของบริษัท — บันทึกเพื่อตั้งเกณฑ์เฉพาะบัญชีนี้"}
        </p>
      )}
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="border-b border-(--line) text-xs text-(--ink-soft)">
            <tr>
              <th className="px-2 py-2 text-left font-medium">ตัวชี้วัด</th>
              <th className="px-2 py-2 text-left font-medium">ทิศทาง</th>
              <th className="px-2 py-2 text-left font-medium">เกณฑ์ ต้องแก้</th>
              <th className="px-2 py-2 text-left font-medium">เกณฑ์ ดี</th>
              <th className="px-2 py-2 text-left font-medium">ผลลัพธ์</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const b = values[m];
              const err = benchmarkError(b);
              const hi = b.direction === "higher_better";
              return (
                <tr key={m} className="border-b border-(--line) align-top last:border-0">
                  <td className="px-2 py-2">
                    <div className="font-medium text-(--ink)">{METRIC_LABEL[m]}</div>
                    <div className="text-xs text-(--ink-soft)">หน่วย {UNIT[m]}</div>
                  </td>
                  <td className="px-2 py-2">
                    <select className={input} value={b.direction} onChange={(e) => set(m, { direction: e.target.value as Direction })}>
                      <option value="higher_better">สูง = ดี</option>
                      <option value="lower_better">ต่ำ = ดี</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="any" min={0} className={input} value={b.poor} onChange={(e) => set(m, { poor: Number(e.target.value) })} />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="any" min={0} className={input} value={b.good} onChange={(e) => set(m, { good: Number(e.target.value) })} />
                  </td>
                  <td className="px-2 py-2">
                    {err ? (
                      <span className="text-xs font-medium text-[#8F1414]">{err}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        <Chip status="poor" text={hi ? `< ${b.poor}` : `> ${b.poor}`} />
                        <Chip status="normal" text={hi ? `${b.poor}–${b.good}` : `${b.good}–${b.poor}`} />
                        <Chip status="good" text={hi ? `> ${b.good}` : `< ${b.good}`} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={busy || METRICS.some((m) => benchmarkError(values[m]))}>
          บันทึกเกณฑ์
        </button>
        {usesOverride && (
          <button
            type="button"
            disabled={busy}
            className="h-10 rounded-(--radius) border border-(--line) px-4 text-sm text-(--ink)"
            onClick={() => save({ reset: true }, "กลับไปใช้ค่าเริ่มต้นของบริษัทแล้ว")}
          >
            กลับไปใช้ค่าเริ่มต้น
          </button>
        )}
      </div>
    </form>
  );
}

export interface SettingsValues {
  minClicksToJudge: number;
  minBudgetUtilToScale: number;
  budgetLostIsLimit: number;
  rankLostIsLimit: number;
  wastedTermMinClicks: number;
  primaryGoal: "lead" | "sales";
  targetCpa: number | null;
  avgLeadValue: number | null;
  businessContext: string;
  emailRecipients: string[];
}

/** กฎตรวจสอบก่อนส่ง AI (spec §5.4) + เป้าหมายธุรกิจ — รายบัญชี */
export function AnalysisSettingsForm({ customerId, initial }: { customerId: string; initial: SettingsValues }) {
  const router = useRouter();
  const [v, setV] = useState({
    ...initial,
    targetCpa: initial.targetCpa == null ? "" : String(initial.targetCpa),
    avgLeadValue: initial.avgLeadValue == null ? "" : String(initial.avgLeadValue),
    emailRecipients: initial.emailRecipients.join(", "),
  });
  const [busy, setBusy] = useState(false);

  const field = (label: string, hint: string, el: React.ReactNode) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-(--ink)">{label}</span>
      {el}
      <span className="text-xs text-(--ink-soft)">{hint}</span>
    </label>
  );
  const numInput = (key: keyof typeof v, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      type="number"
      step="any"
      min={0}
      className={input}
      value={v[key] as string | number}
      onChange={(e) => setV({ ...v, [key]: e.target.value })}
      {...props}
    />
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await call(`/api/ads/settings?customer_id=${customerId}`, { method: "PUT", body: JSON.stringify(v) });
          toast.success("บันทึกกฎและเป้าหมายแล้ว");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h3 className="mb-2 text-sm font-semibold text-(--ink)">กฎตรวจสอบก่อนส่งให้ AI</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("คลิกขั้นต่ำก่อนตัดสิน (คลิก)", "น้อยกว่านี้ติดป้าย “ข้อมูลน้อย” ห้าม AI สรุปดี/แย่จาก Conv. Rate", numInput("minClicksToJudge", { step: 1 }))}
          {field("Budget utilization ขั้นต่ำ (%)", "ต่ำกว่านี้ห้าม AI แนะนำ “เพิ่มงบ” ให้แคมเปญนั้น", numInput("minBudgetUtilToScale", { max: 100 }))}
          {field("เสีย IS เพราะงบ เกิน (%)", "ระบุว่างบเป็นตัวจำกัด เพิ่มงบได้ผล", numInput("budgetLostIsLimit", { max: 100 }))}
          {field("เสีย IS เพราะอันดับ เกิน (%)", "ระบุว่า Ad Rank เป็นตัวจำกัด แนะนำปรับ bid หรือคุณภาพโฆษณา", numInput("rankLostIsLimit", { max: 100 }))}
          {field("คำค้นหาที่เสียเงิน: คลิกตั้งแต่ (คลิก)", "คลิกถึงเกณฑ์และ conversion = 0 → เสนอเป็น Negative keyword", numInput("wastedTermMinClicks", { step: 1 }))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-(--ink)">เป้าหมายธุรกิจ</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            "เป้าหมายหลัก",
            "AI ใช้ประกอบการตีความ",
            <select className={input} value={v.primaryGoal} onChange={(e) => setV({ ...v, primaryGoal: e.target.value as "lead" | "sales" })}>
              <option value="lead">Lead</option>
              <option value="sales">Sales</option>
            </select>
          )}
          {field("Target CPA", "ว่างได้", numInput("targetCpa"))}
          {field("มูลค่าเฉลี่ยต่อ Lead", "ว่างได้ — ถ้ามีใช้ประมาณ ROAS", numInput("avgLeadValue"))}
          {field(
            "ผู้รับอีเมลสรุปรายสัปดาห์",
            "คั่นด้วย , หรือขึ้นบรรทัดใหม่",
            <textarea
              rows={2}
              className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-2 py-1.5 text-sm text-(--ink)"
              value={v.emailRecipients}
              onChange={(e) => setV({ ...v, emailRecipients: e.target.value })}
            />
          )}
        </div>
        <div className="mt-4">
          {field(
            "บริบทธุรกิจ",
            "ข้อมูลที่ช่วยให้ AI เข้าใจธุรกิจ เช่น ฤดูกาล สินค้าหลัก กลุ่มลูกค้า",
            <textarea
              rows={4}
              maxLength={4000}
              className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-2 py-1.5 text-sm text-(--ink)"
              value={v.businessContext}
              onChange={(e) => setV({ ...v, businessContext: e.target.value })}
            />
          )}
        </div>
      </div>

      <div>
        <button type="submit" className={primary} disabled={busy}>
          บันทึกกฎและเป้าหมาย
        </button>
      </div>
    </form>
  );
}
