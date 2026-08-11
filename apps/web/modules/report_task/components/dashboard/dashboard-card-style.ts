/**
 * Shared "premium SaaS" card shell for the Dashboard specifically (not the
 * app-wide `Card` primitive, which stays untouched for every other page) —
 * rounded-[18px], soft shadow, hairline border, gentle hover lift. Every
 * dashboard widget's outer `<Card>` gets this via `cn(DASHBOARD_CARD, ...)`
 * so the whole page reads as one consistent visual system instead of each
 * widget inventing its own card treatment.
 */
export const DASHBOARD_CARD =
  "rounded-[18px] border border-[#eef2f7] shadow-[0_10px_35px_rgba(0,0,0,0.05)] hover:shadow-[0_16px_45px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-200";

/** Same shell, no hover lift — for cards that aren't a click target (e.g. static KPI tiles). */
export const DASHBOARD_CARD_STATIC =
  "rounded-[18px] border border-[#eef2f7] shadow-[0_10px_35px_rgba(0,0,0,0.05)]";
