import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

/**
 * บัญชีนี้เปิด SmartBoss จากแอปที่ติดตั้งบนเครื่องแบบไหนล่าสุดเมื่อไหร่
 * (core.app_installs — ดูเหตุผลที่ต้องจำที่บัญชีใน core.prisma model AppInstall)
 */
export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["ios", "android", "desktop"]);

/** { ios?: ISO, android?: ISO, desktop?: ISO } — เวลาเปิดจากแอปครั้งล่าสุดของแต่ละระบบ */
export async function GET() {
  const session = await requireOrg();
  const rows = await prisma.appInstall.findMany({
    where: { orgId: session.orgId, userId: session.userId },
    select: { platform: true, lastSeenAt: true },
  });
  return Response.json(Object.fromEntries(rows.map((r) => [r.platform, r.lastSeenAt.toISOString()])), {
    headers: { "Cache-Control": "no-store" },
  });
}

/** แอปที่ติดตั้งแจ้งว่า "ตอนนี้เปิดจากแอปอยู่" — body: { platform } */
export async function POST(request: Request) {
  const session = await requireOrg();
  const body = await request.json().catch(() => null);
  const platform = typeof body?.platform === "string" ? body.platform : "";
  if (!PLATFORMS.has(platform)) return Response.json({ error: "platform ไม่ถูกต้อง" }, { status: 400 });
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  const now = new Date();
  await prisma.appInstall.upsert({
    where: { userId_platform: { userId: session.userId, platform } },
    update: { orgId: session.orgId, lastSeenAt: now, userAgent },
    create: { orgId: session.orgId, userId: session.userId, platform, userAgent, lastSeenAt: now },
  });
  return Response.json({ ok: true });
}
