import { create } from "zustand";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { uuid } from "@/modules/report_task/lib/uuid";

/**
 * "none" — unlimited, no quota tracked.
 * "annual" — a flat total of days allowed per calendar year.
 * "monthly" — a fixed number of days granted every calendar month, which
 * carries over (accumulates) unless `expiryMonths` is set, in which case an
 * unused month's grant is forfeited after that many months — see
 * lib/leave-quota.ts for the accrual/expiry math.
 */
export type LeaveQuotaMode = "none" | "annual" | "monthly";

export interface LeaveTypeDef {
  id: string;
  label: string;
  color: string;
  /** Icon name from leaveIconRegistry. */
  icon: string;
  quotaMode: LeaveQuotaMode;
  /** Days per calendar year — used when quotaMode is "annual". */
  annualQuota?: number;
  /** Days granted each calendar month — used when quotaMode is "monthly" and monthlySource is "fixed" (or unset). */
  monthlyGrant?: number;
  /** Months an unused monthly grant stays valid before it's forfeited — undefined means it rolls over forever. Only meaningful when quotaMode is "monthly". */
  expiryMonths?: number;
  /**
   * "fixed" (default) — every month grants the same `monthlyGrant` number.
   * "country" — each month's grant is instead the count of that month's
   * public holidays for `holidayCountryCode` (e.g. companies that convert
   * public holidays into flexible leave days) — only meaningful when
   * quotaMode is "monthly".
   */
  monthlySource?: "fixed" | "country";
  /** Nager.Date country code (e.g. "TH", "US") used when monthlySource is "country". */
  holidayCountryCode?: string;
  /** Per-month ("YYYY-MM") manual overrides on top of a "country"-sourced grant, for admins to correct an individual month. */
  monthlyGrantOverrides?: Record<string, number>;
}

const defaultLeaveTypes: LeaveTypeDef[] = [
  // Deliberately not chartColors.green — that's the exact brand-green used
  // for primary buttons/CTAs and "done" status everywhere else, so a vacation
  // chip in that color reads as a clickable action instead of a leave day.
  { id: "vacation", label: "ลาพักร้อน", color: chartColors.orange, icon: "umbrella", quotaMode: "monthly", monthlyGrant: 1 },
  { id: "sick", label: "ลาป่วย", color: chartColors.red, icon: "thermometer", quotaMode: "none" },
  { id: "personal", label: "ลากิจ", color: chartColors.amber, icon: "briefcase", quotaMode: "annual", annualQuota: 3 },
  { id: "wfh", label: "ทำงานที่บ้าน", color: chartColors.blue, icon: "house", quotaMode: "none" },
];

interface LeaveTypeStore {
  types: LeaveTypeDef[];
  addType: (t: Omit<LeaveTypeDef, "id">) => void;
  updateType: (id: string, patch: Partial<Omit<LeaveTypeDef, "id">>) => void;
  removeType: (id: string) => void;
  /** Replaces the whole list in one commit — used by the settings dialog's Save button, which stages edits locally until then. */
  setTypes: (types: LeaveTypeDef[]) => void;
}

// Server-synced via ServerStoreSync (apiKey "leave-types") in
// store-hydrator.tsx — shared org-wide config, not per-browser.
export const useLeaveTypeStore = create<LeaveTypeStore>()((set) => ({
  types: defaultLeaveTypes,
  addType: (t) => set((s) => ({ types: [...s.types, { ...t, id: `lt-${uuid()}` }] })),
  updateType: (id, patch) =>
    set((s) => ({ types: s.types.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  removeType: (id) => set((s) => ({ types: s.types.filter((x) => x.id !== id) })),
  setTypes: (types) => set({ types }),
}));
