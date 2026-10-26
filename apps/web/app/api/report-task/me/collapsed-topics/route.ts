import type { NextRequest } from "next/server";
import { prisma } from "@smartboss/database";
import { requireOrg } from "@smartboss/auth";

/**
 * หัวข้อรายงานที่ "ฉัน" ย่อไว้ (topic-sidebar.tsx) — เก็บที่เซิร์ฟเวอร์ต่อคน แบบเดียวกับ sticker-usage
 * เดิมอยู่แค่ localStorage ⇒ ปิดแอป/เปิดอีกเครื่อง/เบราว์เซอร์ล้างข้อมูล แล้วกางออกหมดทุกห้อง
 * ข้อมูลเป็นแค่ id ของหัวข้อ · ไม่เคยบันทึก = ids: null (ให้ client ส่งของในเครื่องขึ้นมาครั้งแรก)
 */
export const dynamic = "force-dynamic";

const MAX_IDS = 500;
const storeKey = (userId: string) => `user:${userId}:collapsed-topics`;

export async function GET() {
  const session = await requireOrg();
  const row = await prisma.reportTaskStore.findUnique({
    where: { orgId_key: { orgId: session.orgId, key: storeKey(session.userId) } },
    select: { data: true },
  });
  const data = row?.data;
  return Response.json({ ids: Array.isArray(data) ? data.filter((x) => typeof x === "string") : null });
}

export async function PUT(request: NextRequest) {
  const session = await requireOrg();
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  if (!body || !Array.isArray(body.ids)) return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const ids = [...new Set(body.ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120))].slice(0, MAX_IDS);
  const key = storeKey(session.userId);
  await prisma.reportTaskStore.upsert({
    where: { orgId_key: { orgId: session.orgId, key } },
    update: { data: ids, version: { increment: 1 }, updatedBy: session.userId },
    create: { orgId: session.orgId, key, data: ids, updatedBy: session.userId },
  });
  return Response.json({ ids });
}
