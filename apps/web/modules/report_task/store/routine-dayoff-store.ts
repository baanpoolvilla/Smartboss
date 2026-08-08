import { create } from "zustand";

/** Where one occurrence of a routine day off comes from — needed at move
 * time because a plain one-off pick and a recurring rule's weekly instance
 * have to be released two different ways. `naturalDate` is the rule's own
 * natural occurrence date (see lib/routine-dayoff.ts) — `ruleExceptions` is
 * always keyed by that, never by whatever date happens to be currently
 * displayed (which may itself already be a previously-moved occurrence) —
 * writing to the wrong key silently no-ops the next move. */
export type DayOffOrigin = { kind: "manual" } | { kind: "rule"; ruleId: string; naturalDate: string };

/** "Every Sunday off," confirmed once (from an external recurring event, or
 * set up by hand) instead of picking every future date one at a time —
 * `expandRule` in lib/routine-dayoff.ts turns this + `ruleExceptions` into
 * concrete dates for a given month. */
export interface RoutineDayOffRule {
  id: string;
  userId: string;
  /** 0 = Sunday ... 6 = Saturday (JS `Date#getDay()` convention). */
  weekday: number;
  label: string;
  /** Occurrences before this date don't count — e.g. the date the routine
   * was actually confirmed, not necessarily the source event's original start. */
  startDate: string;
  /** Occurrences on/after this date don't count — matches Outlook's "Until"
   * on a recurring series. Absent = runs indefinitely (capped internally by
   * `expandRule`'s horizon, since nothing needs dates decades out). */
  endDate?: string;
  /** The external-calendar series this was confirmed from, if any — lets us
   * stop re-suggesting "is this a routine?" once it's already been adopted. */
  sourceSeriesId?: string;
  createdAt: string;
}

interface RoutineDayOffStore {
  /** Applies to everyone unless useDepartmentOverrides is on. */
  companyMonthlyQuota: number;
  useDepartmentOverrides: boolean;
  departmentQuotas: Record<string, number>;
  /** userId -> the specific dates ("YYYY-MM-DD") they've marked as a routine day off. */
  pickedDates: Record<string, string[]>;
  rules: RoutineDayOffRule[];
  /** `${ruleId}:${originalOccurrenceDate}` -> `"cancelled"` (skip this one
   * occurrence) or a `"YYYY-MM-DD"` it moved to — the rule itself keeps
   * generating every week; this only overrides individual weeks. */
  ruleExceptions: Record<string, string>;
  setCompanyMonthlyQuota: (n: number) => void;
  setUseDepartmentOverrides: (v: boolean) => void;
  setDepartmentQuota: (departmentId: string, n: number) => void;
  /** "ใช้ค่าเดียวกันทุกแผนก" — copies the company quota onto every department at once. */
  applyCompanyQuotaToAllDepartments: (departmentIds: string[]) => void;
  /** Commits the settings dialog's whole draft (quota, override toggle, per-department quotas) in one go — the dialog stages edits locally until Save. */
  setRoutineSettings: (settings: { companyMonthlyQuota: number; useDepartmentOverrides: boolean; departmentQuotas: Record<string, number> }) => void;
  addPickedDate: (userId: string, date: string) => void;
  removePickedDate: (userId: string, date: string) => void;
  /** Unilateral reschedule of one of your own days — nobody else's date is
   * involved, so this applies immediately, no approval needed. */
  movePickedDate: (userId: string, fromDate: string, toDate: string) => void;
  /** Confirms a detected weekly pattern as an ongoing routine. Returns the new rule's id. */
  addRule: (userId: string, weekday: number, label: string, startDate: string, sourceSeriesId?: string, endDate?: string) => string;
  /** Stops the routine entirely — past exceptions for it are cleaned up too. */
  removeRule: (ruleId: string) => void;
  /** Reschedule just one week's occurrence — the rule keeps running every
   * other week untouched. */
  moveRuleOccurrence: (ruleId: string, occurrenceDate: string, newDate: string) => void;
  /** Skip just one week's occurrence (e.g. it happens to land on a real
   * holiday) — the rule keeps running every other week untouched. */
  cancelRuleOccurrence: (ruleId: string, occurrenceDate: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "routine-dayoff") in
// store-hydrator.tsx — shared across teammates, not per-browser.
export const useRoutineDayOffStore = create<RoutineDayOffStore>()((set) => ({
      companyMonthlyQuota: 4,
      useDepartmentOverrides: false,
      departmentQuotas: {},
      pickedDates: {},
      rules: [],
      ruleExceptions: {},
      setCompanyMonthlyQuota: (n) => set({ companyMonthlyQuota: Math.max(0, n) }),
      setUseDepartmentOverrides: (v) => set({ useDepartmentOverrides: v }),
      setDepartmentQuota: (departmentId, n) =>
        set((s) => ({ departmentQuotas: { ...s.departmentQuotas, [departmentId]: Math.max(0, n) } })),
      applyCompanyQuotaToAllDepartments: (departmentIds) =>
        set((s) => ({
          departmentQuotas: Object.fromEntries(departmentIds.map((id) => [id, s.companyMonthlyQuota])),
        })),
      setRoutineSettings: (settings) => set(settings),
      addPickedDate: (userId, date) =>
        set((s) => {
          const existing = s.pickedDates[userId] ?? [];
          if (existing.includes(date)) return s;
          return { pickedDates: { ...s.pickedDates, [userId]: [...existing, date].sort() } };
        }),
      removePickedDate: (userId, date) =>
        set((s) => ({
          pickedDates: { ...s.pickedDates, [userId]: (s.pickedDates[userId] ?? []).filter((d) => d !== date) },
        })),
      movePickedDate: (userId, fromDate, toDate) =>
        set((s) => {
          const existing = s.pickedDates[userId] ?? [];
          if (!existing.includes(fromDate) || existing.includes(toDate)) return s;
          const next = existing.filter((d) => d !== fromDate).concat(toDate).sort();
          return { pickedDates: { ...s.pickedDates, [userId]: next } };
        }),
      addRule: (userId, weekday, label, startDate, sourceSeriesId, endDate) => {
        const id = `rule-${crypto.randomUUID()}`;
        set((s) => ({
          rules: [...s.rules, { id, userId, weekday, label, startDate, endDate, sourceSeriesId, createdAt: new Date().toISOString() }],
        }));
        return id;
      },
      removeRule: (ruleId) =>
        set((s) => ({
          rules: s.rules.filter((r) => r.id !== ruleId),
          ruleExceptions: Object.fromEntries(Object.entries(s.ruleExceptions).filter(([k]) => !k.startsWith(`${ruleId}:`))),
        })),
      moveRuleOccurrence: (ruleId, occurrenceDate, newDate) =>
        set((s) => ({ ruleExceptions: { ...s.ruleExceptions, [`${ruleId}:${occurrenceDate}`]: newDate } })),
      cancelRuleOccurrence: (ruleId, occurrenceDate) =>
        set((s) => ({ ruleExceptions: { ...s.ruleExceptions, [`${ruleId}:${occurrenceDate}`]: "cancelled" } })),
}));
