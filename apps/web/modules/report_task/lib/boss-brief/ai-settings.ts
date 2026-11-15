import "server-only";
import { readStoreCached } from "@/modules/report_task/lib/db/store-cached-read";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import { localDateStr } from "@/modules/report_task/lib/now";
import { getOrgPlan, planAtLeast } from "@/modules/report_task/lib/plan";
import type { ReportTopic, SubmissionRound } from "@/modules/report_task/store/report-feed-store";
import { effectiveCap, readBriefSettings, readUsage, readUsageLog } from "./server";
import { billingStatus, type AiBillingStatus } from "./ai-billing";
import type { AiUsageKind, AiUsageLog, BossBriefSettings } from "./types";

/**
 * หน้าตั้งค่า AI (15/11/2569) — ผู้ใช้: "อยากให้มีตั้งค่าที่ชัดเจน … ตั้งค่าเกี่ยวกับการใช้งาน AI"
 * รวมไว้ที่เดียว: ใช้เงินเดือนนี้ (แยกประเภท/รายวัน/ยอดจริง) · เพดาน · ห้องที่สรุป · รุ่น AI · ตุ๊กตาผู้ช่วย · ประวัติล่าสุด
 * ส่วนเชื่อม OpenAI ของบริษัท (คีย์/Project) เห็นเฉพาะ SUPER_ADMIN (ผู้ให้บริการ)
 */
export interface AiSettingsRoom {
  id: string;
  name: string;
  color: string;
  rounds: string;
  on: boolean;
}

export interface AiSettingsView {
  allowed: boolean;
  reason?: "plan";
  canEdit: boolean;
  settings: BossBriefSettings;
  month: string;
  usage: {
    thb: number;
    trackedThb: number;
    calls: number;
    actualUsd?: number;
    actualSyncedAt?: string;
    byKind: Partial<Record<AiUsageKind, number>>;
    byDay: Record<string, number>;
    projectedThb: number;
  };
  capThb: number;
  planMaxThb: number;
  rooms: AiSettingsRoom[];
  log: AiUsageLog[];
  billing?: AiBillingStatus;
}

const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
function whenText(r: SubmissionRound): string {
  if (r.dayOfMonth) return `ทุกวันที่ ${r.dayOfMonth}`;
  if (r.weekdays && r.weekdays.length > 0 && r.weekdays.length < 7) return `ทุก ${r.weekdays.map((d) => WD[d]).join(" ")}`;
  return "ทุกวัน";
}

export async function aiSettingsView(orgId: string, opts: { canEdit: boolean; superAdmin: boolean }): Promise<AiSettingsView> {
  const settings = await readBriefSettings(orgId);
  const today = localDateStr(new Date());
  const month = today.slice(0, 7);
  const [usage, { cap, planMax }, log, { data: feed }, plan] = await Promise.all([
    readUsage(orgId, month),
    effectiveCap(orgId, settings),
    readUsageLog(orgId),
    readStoreCached<{ topics?: ReportTopic[] }>(orgId, "report-feed"),
    getOrgPlan(orgId),
  ]);
  // คาดการณ์สิ้นเดือน = เฉลี่ยต่อวันที่ผ่านมา × จำนวนวันของเดือน
  const dayNo = Number(today.slice(8, 10));
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y!, m!, 0).getDate();
  const projectedThb = dayNo > 0 ? (usage.thb / dayNo) * daysInMonth : usage.thb;
  const on = new Set(settings.enabled ? settings.topicIds : []);
  const rooms: AiSettingsRoom[] = (feed?.topics ?? [])
    .filter((t) => t && !t.isCategory && !t.archived)
    .map((t) => ({ t, rounds: effectiveRoundsOf(t) }))
    .filter((x) => x.rounds.length > 0)
    .map(({ t, rounds }) => ({
      id: t.id,
      name: t.name || "(ไม่มีชื่อห้อง)",
      color: t.color,
      rounds: rounds.map((r) => `${r.label ? `${r.label} ` : ""}${r.time} (${whenText(r)})`).join(" · "),
      on: on.has(t.id),
    }))
    .sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name, "th"));
  return {
    allowed: planAtLeast(plan, "PRO"),
    ...(planAtLeast(plan, "PRO") ? {} : { reason: "plan" as const }),
    canEdit: opts.canEdit,
    settings,
    month,
    usage: {
      thb: usage.thb,
      trackedThb: usage.trackedThb ?? usage.thb,
      calls: usage.calls,
      actualUsd: usage.actualUsd,
      actualSyncedAt: usage.actualSyncedAt,
      byKind: usage.byKind ?? {},
      byDay: usage.byDay ?? {},
      projectedThb: Math.round(projectedThb * 100) / 100,
    },
    capThb: cap,
    planMaxThb: planMax,
    rooms,
    log: log.slice(0, 50),
    ...(opts.superAdmin ? { billing: await billingStatus(orgId) } : {}),
  };
}
