import type { AuditEvent } from "../lib/db";

export const AUDIT_LABEL: Record<string, { text: string; cls: string }> = {
  pay_rate: { text: "ตั้งค่าแรง", cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  settings: { text: "% OT กลาง", cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  payment: { text: "จ่ายเงิน", cls: "bg-(--tone-ok)/15 text-(--tone-ok)" },
  payment_void: { text: "ยกเลิกการจ่าย", cls: "bg-(--tone-danger)/12 text-(--tone-danger)" },
  time_edit: { text: "แก้เวลา", cls: "bg-(--tone-warn)/15 text-(--tone-warn)" },
  time_edit_revoke: { text: "ยกเลิกแก้เวลา", cls: "bg-(--tone-warn)/15 text-(--tone-warn)" },
  day_off: { text: "ลงหยุด", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100" },
  day_off_clear: { text: "ยกเลิกหยุด", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100" },
  ot: { text: "ลง OT", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  ot_delete: { text: "ลบ OT", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  override: { text: "แก้เป็นมา", cls: "bg-(--bg-soft) text-(--ink-soft)" },
  override_remove: { text: "ยกเลิกแก้เป็นมา", cls: "bg-(--bg-soft) text-(--ink-soft)" },
  shift: { text: "ผูกกะ", cls: "bg-(--bg-soft) text-(--ink-soft)" },
};

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const thDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return `${day}/${m}/${y + 543}`;
};

/** รายการประวัติการแก้ไข (ใหม่สุดก่อน) — ใคร ทำอะไร กับใคร วันไหน เมื่อไร */
export function AuditList({ events, names, showWho = true }: { events: AuditEvent[]; names: Record<string, string>; showWho?: boolean }) {
  if (events.length === 0) return <p className="rounded-2xl border border-(--line) bg-(--bg) p-6 text-center text-sm text-(--ink-soft)">ยังไม่มีการแก้ไขในช่วงนี้</p>;
  return (
    <ul className="flex flex-col divide-y divide-(--line) rounded-2xl border border-(--line) bg-(--bg)">
      {events.map((e) => {
        const label = AUDIT_LABEL[e.action] ?? { text: e.action, cls: "bg-(--bg-soft) text-(--ink-soft)" };
        const who = e.employmentIds.map((id) => names[id] ?? "คนงานที่ออกแล้ว");
        return (
          <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <span className="w-32 shrink-0 text-xs tabular-nums text-(--ink-soft)">{fmt(e.at)}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${label.cls}`}>{label.text}</span>
            <span className="min-w-0 flex-1 basis-60">
              {showWho && who.length > 0 && <b>{who.length > 3 ? `${who.slice(0, 3).join(", ")} และอีก ${who.length - 3} คน` : who.join(", ")} · </b>}
              {e.workDate && <span className="text-(--ink-soft)">วันที่ {thDate(e.workDate)} · </span>}
              {e.summary}
            </span>
            <span className="shrink-0 text-xs text-(--ink-soft)">โดย {e.byName}</span>
          </li>
        );
      })}
    </ul>
  );
}
