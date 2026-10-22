/** สไตล์ของโมดูลเงินเดือน — ชุดเดียวกับโมดูลเบิกจ่าย & OT (ปุ่มสูง 44px กดง่ายบนมือถือ) */
export const field =
  "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/25 disabled:bg-(--bg-soft) disabled:text-(--ink-soft)";
export const primary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50";
export const navy =
  "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--brand-navy,#1b2537) px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50";
export const outline =
  "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) border border-(--line) bg-(--bg) px-4 text-sm font-medium text-(--ink) hover:bg-(--bg-soft) disabled:opacity-50";
export const dangerOutline =
  "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) border border-red-200 bg-(--bg) px-4 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50";
export const card = "rounded-(--radius-lg) border border-(--line) bg-(--bg)";
export const label = "flex flex-col gap-1.5 text-sm";
export const labelText = "font-semibold text-(--ink)";
export const hint = "text-xs text-(--ink-soft)";

export const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: "ร่าง · รอส่งอนุมัติ", cls: "border-slate-300 bg-slate-50 text-slate-800" },
  submitted: { label: "รอ CEO อนุมัติ", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  approved: { label: "อนุมัติแล้ว · รอจ่าย", cls: "border-sky-300 bg-sky-50 text-sky-900" },
  paid: { label: "ชำระเงินแล้ว", cls: "border-emerald-300 bg-emerald-50 text-emerald-900" },
};
