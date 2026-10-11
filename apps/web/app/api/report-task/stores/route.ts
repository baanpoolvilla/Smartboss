import type { NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";

import { isValidStoreKey } from "@/modules/report_task/lib/db/org-store";
import { readStorePayload } from "@/modules/report_task/lib/db/store-read";

/**
 * อ่านหลาย store ในคำขอเดียว — ตอนเข้าโมดูลรายงานและงาน ServerStoreSync ~25 ตัวเคยยิง
 * GET /api/report-task/store/<key> พร้อมกันคนละคำขอ เซิร์ฟเวอร์ 2 core ต้องตรวจ session/ผ่าน proxy
 * ทีละคำขอแล้วเข้าคิว ⇒ คีย์เล็ก ๆ ที่ควรเสร็จในไม่กี่สิบ ms ใช้ 0.3–0.9 วิ บางทีเกิน 1–3 วิ
 * (slow-pages.sh 2026-10-11) — ตอนนี้ client รวมคีย์ที่โหลดพร้อมกันส่งมาที่นี่ทีเดียว
 * (lib/store-batch.ts) · อ่านอย่างเดียว การเขียน/poll ยังเป็นรายคีย์เหมือนเดิม
 *
 * GET ?keys=a,b,c → { stores: { a: { data, version }, ... } } — คีย์ที่อ่านพลาดไม่อยู่ในผล
 * (client ย้อนไปอ่านคีย์นั้นแบบเดิมเอง) · ฟีดรายงาน (หลาย MB) client ไม่ส่งมาทางนี้
 */
export const dynamic = "force-dynamic";

const MAX_KEYS = 40;
/** อ่านพร้อมกันทีละไม่กี่คีย์ — ไม่ให้คำขอเดียวยึด connection pool ของ Prisma หมด */
const PARALLEL = 4;

export async function GET(request: NextRequest) {
  const session = await requireOrg();
  const keys = [...new Set((request.nextUrl.searchParams.get("keys") ?? "").split(",").filter(Boolean))];
  if (keys.length === 0 || keys.length > MAX_KEYS || !keys.every(isValidStoreKey)) {
    return Response.json({ error: "คีย์ไม่ถูกต้อง" }, { status: 400 });
  }

  const stores: Record<string, { data: unknown; version: number }> = {};
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const key = keys[next++]!;
      try {
        const { payload, version } = await readStorePayload(session.orgId, session.userId, key);
        stores[key] = { data: payload, version };
      } catch (err) {
        console.error(`[report-task/stores] read ${key} failed`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, keys.length) }, worker));

  return Response.json({ stores }, { headers: { "Cache-Control": "no-store" } });
}
