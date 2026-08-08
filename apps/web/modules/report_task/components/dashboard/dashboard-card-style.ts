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

/**
 * List-style cards (rows of items) all commit to the same fixed total
 * height, then scroll their own row list inside whatever space is left
 * under the header — so any two of these line up bottom-edge-to-bottom-edge
 * in the grid regardless of item count or how tall each header is, without
 * depending on the grid stretching them to match a neighbor.
 */
export const DASHBOARD_LIST_CARD_H = "h-[30rem] flex flex-col";

/** The scrollable row list inside a DASHBOARD_LIST_CARD_H card — fills whatever's left under the header. */
export const DASHBOARD_LIST_SCROLL = "flex-1 min-h-0 overflow-y-auto";
