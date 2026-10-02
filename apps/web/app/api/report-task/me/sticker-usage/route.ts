import type { NextRequest } from "next/server";
import { prisma } from "@smartboss/database";
import { requireOrg } from "@smartboss/auth";

/**
 * อีโมจิ/สติกเกอร์ที่ "ฉัน" กดบ่อย — เก็บที่เซิร์ฟเวอร์ต่อคน (เดิมอยู่ใน localStorage เครื่องเดียว
 * ปิด LINE / ออกจากระบบ / เปลี่ยนเครื่องแล้วหาย) ใช้ตาราง report_task.stores คีย์ user:<id>:sticker-usage
 * ข้อมูลเป็นแค่ { "emoji:👍": 12, "sticker:<id>": 3, ... }
 */
export const dynamic = "force-dynamic";

type Counts = Record<string, number>;
const MAX_KEYS = 500;

const storeKey = (userId: string) => `user:${userId}:sticker-usage`;

async function readCounts(orgId: string, userId: string): Promise<Counts> {
  const row = await prisma.reportTaskStore.findUnique({
    where: { orgId_key: { orgId, key: storeKey(userId) } },
    select: { data: true },
  });
  const data = row?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Counts) : {};
}

function validKey(k: unknown): k is string {
  return typeof k === "string" && k.length > 0 && k.length <= 120 && (k.startsWith("emoji:") || k.startsWith("sticker:"));
}

export async function GET() {
  const session = await requireOrg();
  return Response.json({ counts: await readCounts(session.orgId, session.userId) });
}

/** { key } = กดเพิ่ม 1 ครั้ง · { merge } = รวมของเดิมในเครื่องขึ้นเซิร์ฟเวอร์ (เอาค่าที่มากกว่า) */
export async function POST(request: NextRequest) {
  const session = await requireOrg();
  const body = (await request.json().catch(() => null)) as { key?: unknown; merge?: unknown } | null;
  if (!body) return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });

  const counts = await readCounts(session.orgId, session.userId);
  if (validKey(body.key)) {
    counts[body.key] = (counts[body.key] ?? 0) + 1;
  } else if (body.merge && typeof body.merge === "object") {
    for (const [k, v] of Object.entries(body.merge as Record<string, unknown>)) {
      if (validKey(k) && typeof v === "number" && Number.isFinite(v) && v > 0) counts[k] = Math.max(counts[k] ?? 0, Math.floor(v));
    }
  } else {
    return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  // กันโตไม่จำกัด — เก็บแค่ที่ใช้บ่อยสุด
  const trimmed = Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KEYS)
  );
  const key = storeKey(session.userId);
  await prisma.reportTaskStore.upsert({
    where: { orgId_key: { orgId: session.orgId, key } },
    update: { data: trimmed, version: { increment: 1 }, updatedBy: session.userId },
    create: { orgId: session.orgId, key, data: trimmed, updatedBy: session.userId },
  });
  return Response.json({ counts: trimmed });
}
