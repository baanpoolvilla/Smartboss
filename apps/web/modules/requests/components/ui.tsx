import { KIND_CLASS, KIND_META, TONE_CLASS, baht, type RequestKind, type StatusInfo } from "../lib/types";

/** ชิปประเภทคำขอ — สีเดียวกันทุกหน้า */
export function KindChip({ kind, className = "" }: { kind: RequestKind; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_CLASS[kind]} ${className}`}>{KIND_META[kind].short}</span>;
}

export function StatusChip({ info, className = "" }: { info: StatusInfo; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[info.tone]} ${className}`}>{info.label}</span>;
}

/** จำนวนเงินตัวใหญ่ อ่านง่าย — ติดลบเป็นสีแดง */
export function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tabular-nums ${value < 0 ? "text-(--danger)" : ""} ${className}`}>{baht(value)}</span>;
}

/** แถวตัวเลขในกล่องสรุปเงิน: ป้าย ซ้าย · เงิน ขวา */
export function MoneyRow({
  label,
  value,
  hint,
  strong = false,
  minus = false,
}: {
  label: React.ReactNode;
  value: number;
  hint?: React.ReactNode;
  strong?: boolean;
  minus?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "border-t border-(--line) pt-2 text-base font-bold" : "text-sm"}`}>
      <div className="min-w-0">
        <div className={strong ? "text-(--ink)" : "text-(--ink-soft)"}>{label}</div>
        {hint && <div className="text-[11px] font-normal text-(--ink-soft)">{hint}</div>}
      </div>
      <div className={`shrink-0 tabular-nums ${minus ? "text-(--danger)" : "text-(--ink)"}`}>
        {minus ? "−" : ""}
        {baht(Math.abs(value))}
      </div>
    </div>
  );
}

/** ขั้นตอนของใบ — วงกลมเขียว = ผ่านแล้ว · วงเปล่า = ยังไม่ถึง · ม่วง = ตอนนี้อยู่ตรงนี้ */
export function Steps({ steps }: { steps: { title: string; sub?: string; state: "done" | "now" | "todo" | "stop" }[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              s.state === "done"
                ? "bg-emerald-100 text-emerald-800"
                : s.state === "now"
                  ? "bg-violet-600 text-white"
                  : s.state === "stop"
                    ? "bg-red-100 text-red-800"
                    : "border-2 border-(--line) text-(--ink-soft)"
            }`}
          >
            {s.state === "done" ? "✓" : s.state === "stop" ? "✕" : i + 1}
          </span>
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${s.state === "todo" ? "text-(--ink-soft)" : "text-(--ink)"}`}>{s.title}</div>
            {s.sub && <div className="text-xs text-(--ink-soft)">{s.sub}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "danger"
        ? "border-red-200 bg-red-50 text-red-900"
        : tone === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-violet-200 bg-violet-50 text-violet-900";
  return <div role={tone === "danger" ? "alert" : "status"} className={`rounded-(--radius) border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
