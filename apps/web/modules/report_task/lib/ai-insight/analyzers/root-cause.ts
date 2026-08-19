import "server-only";

import { trackedTopicsOf, iterationBounds, eachDay, dayComplianceStatus } from "@/modules/report_task/lib/report-feed-compliance";
import { mustReportToTopicServer, type AiInsightAggregate } from "../aggregate";
import type { RootCause } from "../types";

const MAX_ROOT_CAUSES = 3;
const SYSTEMIC_TOPIC_MIN_USERS = 3;
const CONCENTRATION_SHARE = 0.4;
const WORKLOAD_IMBALANCE_RATIO = 3;
const BOTTLENECK_SHARE = 0.5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** #1 systemic-topic — one report topic missed by several different people,
 * not just one person's problem. Walks the same tracked-topic × user × day
 * loop `aggregate.ts`'s own `reportStatusCountsByUserServer` uses, just kept
 * per-topic instead of summed across all of them — that's the one shape of
 * data this cause needs that the aggregate doesn't already carry. */
function systemicTopicCause(agg: AiInsightAggregate): RootCause | null {
  const tracked = trackedTopicsOf(agg.topics);
  let worst: { topicName: string; users: string[]; total: number } | null = null;
  for (const topic of tracked) {
    const { startStr, endStr } = iterationBounds(topic, null);
    const days = eachDay(startStr, endStr);
    const missedUsers: string[] = [];
    let total = 0;
    for (const u of agg.directory) {
      if (u.isOwner) continue;
      if (!mustReportToTopicServer(topic.visibility, u)) continue;
      let missedForUser = 0;
      for (const day of days) {
        if (dayComplianceStatus(topic, u.id, day, agg.posts) === "missed") missedForUser += 1;
      }
      if (missedForUser > 0) {
        missedUsers.push(u.name);
        total += missedForUser;
      }
    }
    if (missedUsers.length >= SYSTEMIC_TOPIC_MIN_USERS && (!worst || total > worst.total)) {
      worst = { topicName: topic.name, users: missedUsers, total };
    }
  }
  if (!worst) return null;
  const perUser = Math.round((worst.total / worst.users.length) * 10) / 10;
  return {
    kind: "systemic-topic",
    severity: worst.users.length >= 5 ? "high" : "mid",
    evidence: { topic: worst.topicName, users: worst.users, perUser, total: worst.total },
    headline: `หัวข้อ "${worst.topicName}" มีคนขาดส่ง ${worst.users.length} คน เฉลี่ยคนละ ${perUser} ครั้ง — น่าจะเป็นปัญหาที่ตัวหัวข้อ/เดดไลน์เอง ไม่ใช่ที่ตัวคน`,
  };
}

/** #2 concentration — a single person accounts for a large share of one
 * flagged bucket (a single point of failure, not a spread-out problem). */
function concentrationCause(agg: AiInsightAggregate): RootCause | null {
  let worst: { name: string; share: number; bucketLabel: string; count: number; bucketTotal: number } | null = null;
  for (const g of agg.flagged) {
    if (g.count === 0 || g.people.length === 0) continue;
    const top = g.people[0]!;
    const share = top.count / g.count;
    if (share >= CONCENTRATION_SHARE && (!worst || share > worst.share)) {
      worst = { name: top.name, share, bucketLabel: g.label, count: top.count, bucketTotal: g.count };
    }
  }
  if (!worst) return null;
  const pct = Math.round(worst.share * 100);
  return {
    kind: "concentration",
    severity: pct >= 60 ? "high" : "mid",
    evidence: { name: worst.name, sharePercent: pct, bucketLabel: worst.bucketLabel, count: worst.count, bucketTotal: worst.bucketTotal },
    headline: `${worst.name} คนเดียวคิดเป็น ${pct}% ของ "${worst.bucketLabel}" ทั้งหมด (${worst.count}/${worst.bucketTotal}) — แก้จุดเดียวนี้กระทบเยอะ`,
  };
}

/** #3 workload-imbalance — one person's total open items sits far above the
 * company's typical (median) load. */
function workloadImbalanceCause(agg: AiInsightAggregate): RootCause | null {
  const totals = [...agg.personMetricsAll.values()].map((m) => m.open_total);
  const med = median(totals);
  if (med <= 0) return null;
  let worst: { name: string; count: number } | null = null;
  for (const [name, m] of agg.personMetricsAll) {
    if (m.open_total >= med * WORKLOAD_IMBALANCE_RATIO && (!worst || m.open_total > worst.count)) {
      worst = { name, count: m.open_total };
    }
  }
  if (!worst) return null;
  return {
    kind: "workload-imbalance",
    severity: worst.count >= med * 5 ? "high" : "mid",
    evidence: { name: worst.name, count: worst.count, median: med },
    headline: `${worst.name} มีงาน+รายงานค้าง ${worst.count} รายการ มากกว่าค่ากลางของบริษัท (${med}) เกิน ${WORKLOAD_IMBALANCE_RATIO} เท่า — ภาระงานเกลี่ยไม่ทั่วถึง`,
  };
}

/** #4 bottleneck-unit — one department accounts for most of the company's
 * open items — `agg.departmentsAll` is already worst-first, so [0] IS the
 * worst by definition, no separate scan needed. */
function bottleneckUnitCause(agg: AiInsightAggregate): RootCause | null {
  const companyOpenTotal = agg.companyMetrics.open_total;
  if (companyOpenTotal <= 0) return null;
  const worst = agg.departmentsAll[0];
  if (!worst || worst.openTotal <= 0) return null;
  const share = worst.openTotal / companyOpenTotal;
  if (share < BOTTLENECK_SHARE) return null;
  const pct = Math.round(share * 100);
  return {
    kind: "bottleneck-unit",
    severity: pct >= 70 ? "high" : "mid",
    evidence: { unit: worst.name, sharePercent: pct, openTotal: worst.openTotal },
    headline: `แผนก${worst.name}คิดเป็น ${pct}% ของงาน+รายงานค้างทั้งบริษัท — ปัญหารวมของบริษัทจริงๆ คือปัญหาของแผนกนี้แผนกเดียว`,
  };
}

/** §16.1 of docs/ai-insight-v2-spec.md — 4 deterministic pattern checks, no
 * OpenAI call. Capped at 3, worst-severity first, so the prompt/UI never
 * drowns in every pattern that technically matched. */
export function detectRootCauses(agg: AiInsightAggregate): RootCause[] {
  const causes = [systemicTopicCause(agg), concentrationCause(agg), workloadImbalanceCause(agg), bottleneckUnitCause(agg)].filter(
    (c): c is RootCause => c != null
  );
  causes.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  return causes.slice(0, MAX_ROOT_CAUSES);
}
