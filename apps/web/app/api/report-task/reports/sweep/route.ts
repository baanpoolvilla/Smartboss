import { requireOrg } from "@smartboss/auth";

import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";
import { runReportPenaltySweep } from "@/modules/report_task/lib/server/report-penalty-sweep-run";
import { readStoreCached } from "@/modules/report_task/lib/db/store-cached-read";

/**
 * ไม่มีอะไรที่ใช้ตัดสินคะแนนเปลี่ยนตั้งแต่รอบที่แล้ว — รันห่างขึ้นเป็นทุก 5 นาที (เดิม 30 วิ)
 * prod 8/11/2569: รอบละ ~1.5 วิ ทุก 30 วิ ทั้งวัน แย่ง CPU กับคนที่ใช้งานอยู่
 * "ที่ใช้ตัดสิน" = โพสต์ (ใคร/ห้องไหน/เวลา/ส่งย้อนหลัง) + ตั้งค่าห้อง + กลุ่มผู้ส่ง — ไม่ใช่เลขเวอร์ชันฟีด
 * (แค่เปิดอ่าน/กดสติกเกอร์ฟีดก็เปลี่ยนเวอร์ชันแล้ว) · มีโพสต์ใหม่/ลบ/แก้ห้อง = รันรอบถัดไปเหมือนเดิม
 * cron รายชั่วโมงเรียกตัวงานตรง ไม่ผ่านตรงนี้
 * ที่ช้าลงได้สูงสุด 5 นาที: การยกเว้นจากลา/OT ที่เพิ่งอนุมัติ และการตัดสิน "พลาด" ตอนเลยเวลาปิดรับ
 */
const IDLE_SWEEP_MS = 5 * 60_000;
const g = globalThis as unknown as { __reportSweepLast?: Map<string, { at: number; input: string }> };
const lastRun = (g.__reportSweepLast ??= new Map());

type FeedLike = { topics?: unknown[]; submitterGroups?: unknown[]; posts?: Record<string, unknown>[] };

// ช่องของโพสต์ที่เปลี่ยนจากการอ่าน/ตอบ/กดสติกเกอร์เท่านั้น — ไม่มีผลกับการตัดสินส่ง/สาย/พลาด
const SOCIAL_FIELDS = new Set(["replies", "unreadFor", "savedBy", "reactions", "stickerReactions", "pinned", "readBy"]);
const keyCache = (globalThis as unknown as { __reportSweepKey?: Map<string, { version: number; key: string }> });
const inputKeys = (keyCache.__reportSweepKey ??= new Map());

/** ลายนิ้วมือของสิ่งที่ตัวหักคะแนนใช้จากฟีด — คิดใหม่เฉพาะเมื่อเวอร์ชันฟีดเปลี่ยน (ฟีดอ่านจากหน่วยความจำ) */
async function sweepInputKey(orgId: string): Promise<string> {
  const { data, version } = await readStoreCached<FeedLike>(orgId, "report-feed");
  const hit = inputKeys.get(orgId);
  if (hit && hit.version === version) return hit.key;
  let h = 2166136261;
  const mix = (str: string) => {
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  };
  mix(JSON.stringify(data?.topics ?? []));
  mix(JSON.stringify(data?.submitterGroups ?? []));
  for (const p of data?.posts ?? []) {
    mix(JSON.stringify(p, (k, v) => (SOCIAL_FIELDS.has(k) ? undefined : v)));
  }
  const key = `${data?.posts?.length ?? 0}:${h >>> 0}`;
  inputKeys.set(orgId, { version, key });
  return key;
}

/**
 * หักคะแนน HR เมื่อพลาด/ส่งช้ารอบส่งรายงาน — ตัวงานอยู่ที่ report-penalty-sweep-run.ts
 * (cron ทุกชั่วโมงเรียกตัวเดียวกัน ไม่ต้องรอให้มีแท็บเปิดอยู่)
 */
export const dynamic = "force-dynamic";

// เผื่อ client ฝั่งไหนยิง GET แทน POST มา (เช่นเดียวกับ tasks/sweep, reminders/sweep)
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request?: Request) {
  const session = await requireOrg();
  // dryRun (ดูผลล่วงหน้าจากสคริปต์/แอดมิน) ไม่นับ ไม่ถูกข้าม
  if (request && new URL(request.url).searchParams.get("dryRun") === "1") {
    return runReportPenaltySweep(session.orgId, session.userId, request);
  }
  // ทุกแท็บสั่งทุก 60 วิ — รันจริงไม่เกิน 1 ครั้ง/30 วิ/บริษัท (ดู sweep-throttle.ts)
  const input = await sweepInputKey(session.orgId);
  const last = lastRun.get(session.orgId);
  if (last && last.input === input && Date.now() - last.at < IDLE_SWEEP_MS) {
    return Response.json({ ok: true, changed: false, throttled: true });
  }
  if (!claimSweep("reports", session.orgId)) return Response.json({ ok: true, changed: false, throttled: true });
  try {
    const res = await runReportPenaltySweep(session.orgId, session.userId, request);
    // จำหลังรัน (ตัวงานอาจเขียนฟีดเอง เช่น ทำเครื่องหมายส่งย้อนหลังแล้ว)
    if (res.ok) lastRun.set(session.orgId, { at: Date.now(), input: await sweepInputKey(session.orgId) });
    return res;
  } finally {
    releaseSweep("reports", session.orgId);
  }
}
