"use client";

import type { Trend } from "@/modules/report_task/lib/dashboard-trend";
import { cn } from "@/modules/report_task/lib/utils";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

/**
 * "ดีเยี่ยม/ต้องระวัง/วิกฤต" tier for a 0-100 rate — shared so every widget
 * that shows a success rate (the KPI card, both Overview donuts) uses the
 * exact same >=80/>=50 thresholds instead of each inventing its own cutoffs.
 * Only meaningful for a rate; a raw count (overdue tasks, pending reports)
 * has no natural 0-100 scale to tier against — those widgets use TrendText
 * alone, no tier chip.
 */
export function tierFor(rate: number): { label: string; color: string; bg: string } {
  if (rate >= 80) return { label: "ดีเยี่ยม", color: "var(--brand-green-dark)", bg: "bg-green-50" };
  if (rate >= 50) return { label: "ต้องระวัง", color: "var(--chart-amber-dark)", bg: "bg-amber-50" };
  return { label: "วิกฤต", color: "var(--chart-red-dark)", bg: "bg-red-50" };
}

/**
 * "↓ แย่ลง 12% จากช่วงก่อนหน้า" / "↑ ดีขึ้น 8% จากช่วงก่อนหน้า" — one shared
 * renderer for every Dashboard widget's period-over-period comparison, so
 * the wording/icons/colors never drift between the KPI card, the two
 * Overview donuts, and the two backlog lists. `higherIsGood` flips which
 * direction reads as green — a rising success rate is good, a rising
 * overdue count is not.
 */
export function TrendText({ trend, higherIsGood }: { trend: Trend | null; higherIsGood: boolean }) {
  if (!trend || trend.direction === "flat" || trend.percent === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--ink-soft)]">
        <Minus className="h-2.5 w-2.5" /> คงที่
      </span>
    );
  }
  const rose = trend.direction === "up";
  const good = rose === higherIsGood;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", good ? "text-[var(--brand-green-dark)]" : "text-[var(--chart-red)]")}>
      {rose ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {good ? "ดีขึ้น" : "แย่ลง"} {Math.abs(trend.percent)}% จากช่วงก่อนหน้า
    </span>
  );
}
