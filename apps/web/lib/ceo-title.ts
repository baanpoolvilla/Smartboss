import "server-only";

import { getSession } from "@smartboss/auth";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { DEFAULT_CEO_TITLE, normalizeCeoTitle } from "@/lib/ceo-title-shared";

/**
 * ชื่อเรียกตำแหน่งสูงสุดของบริษัท ("CEO" / "Boss" / ...) — ผู้ใช้ 8/11/2569 "เปลี่ยนจาก CEO เป็น Boss ดีกว่า"
 * ตั้งที่ หลังบ้าน › ข้อมูลบริษัท · ไม่ตั้ง = "CEO" (บริษัทอื่นที่ใช้ SmartBoss เหมือนเดิม)
 * เป็นแค่คำที่แสดง — บทบาท/สิทธิ์จริงยังเป็นรหัส CEO เหมือนเดิมทุกอย่าง
 *
 * orgId: ส่งมาเมื่อรู้ (งานเบื้องหลัง/cron ไม่มี session) · ไม่ส่ง = บริษัทของคนที่ล็อกอิน · หาไม่ได้ = "CEO"
 */
export const CEO_TITLE_KEY = "org-titles";

const g = globalThis as unknown as { __ceoTitleCache?: Map<string, { at: number; title: string }> };
const cache = (g.__ceoTitleCache ??= new Map());
const TTL_MS = 30_000;

export async function ceoTitle(orgId?: string | null): Promise<string> {
  let id = orgId ?? null;
  if (!id) {
    try {
      id = (await getSession())?.orgId ?? null;
    } catch {
      id = null;
    }
  }
  if (!id) return DEFAULT_CEO_TITLE;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.title;
  let title = DEFAULT_CEO_TITLE;
  try {
    const { data } = await readStore<{ ceo?: unknown }>(id, CEO_TITLE_KEY);
    title = normalizeCeoTitle(data?.ceo);
  } catch {
    title = DEFAULT_CEO_TITLE;
  }
  cache.set(id, { at: Date.now(), title });
  return title;
}

/** หลังบันทึกค่าใหม่ — ให้ทุกหน้าเห็นทันที */
export function forgetCeoTitle(orgId: string) {
  cache.delete(orgId);
}
