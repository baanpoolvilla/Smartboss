import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";
import { verifyAppToken } from "@smartboss/auth";
import { notifyUser } from "@/modules/maintenance/data/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Multi Post → SmartBoss: แจ้งเตือน "งานโพสของคุณ" เข้ากระดิ่งของคนคนนั้นคนเดียว
 * (เริ่มโพส / โพสเสร็จ / โพสไม่สำเร็จ) — ปัญหาของระบบ Multi Post เองไม่ส่งมาที่นี่
 * ให้ไปเด้งในเว็บ Multi Post แทน ("ไม่อยากให้ไปสมาร์ทบอสเยอะ มันจะงง")
 *
 * ยืนยันตัวด้วย token ที่ Multi Post เซ็นด้วย secret ร่วมตัวเดียวกับ SSO
 * (SSO_MULTIPOST_SECRET · iss "multipost" · aud "smartboss" · อายุ 60 วินาที)
 * sub = id ผู้ใช้ SmartBoss ที่บัญชี Multi Post ของเขาผูกไว้ตอนเข้าผ่าน SSO
 * อยู่ใต้ /api/webhooks/ ซึ่ง proxy.ts ปล่อยผ่านโดยไม่ต้องมี session
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SSO_MULTIPOST_SECRET;
  if (!secret) return NextResponse.json({ ok: false }, { status: 404 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const verified = token ? await verifyAppToken(secret, "multipost", token) : null;
  if (!verified) return NextResponse.json({ ok: false }, { status: 401 });

  const title = typeof verified.payload.title === "string" ? verified.payload.title.trim().slice(0, 200) : "";
  const body = typeof verified.payload.body === "string" ? verified.payload.body.trim().slice(0, 500) : "";
  // key = "<jobId>:<event>" — กันแจ้งซ้ำเมื่อ Multi Post ส่งซ้ำ (เครือข่ายสะดุดแล้วลองใหม่)
  const key = typeof verified.payload.key === "string" ? verified.payload.key.slice(0, 120) : "";
  if (!title || !key) return NextResponse.json({ ok: false }, { status: 400 });

  // id ผู้ใช้ unique ทั้งระบบ และยังไม่รู้ว่าอยู่บริษัทไหน — orgId คือสิ่งที่ query นี้หา
  const user = await crossOrg("auth:lookup-by-globally-unique-external-id", () =>
    prisma.user.findUnique({
      where: { id: verified.userId },
      select: { id: true, orgId: true, isActive: true },
    })
  );
  // ผู้ใช้ถูกลบ/ปิดไปแล้ว หรือเป็นบัญชีระดับแพลตฟอร์ม (ไม่มีบริษัท) — ไม่มีกระดิ่งให้ส่ง
  if (!user || !user.isActive || !user.orgId) return NextResponse.json({ ok: true, delivered: false });

  const already = await prisma.notification.findFirst({
    where: { orgId: user.orgId, userId: user.id, type: "multipost", referenceId: key },
    select: { id: true },
  });
  if (already) return NextResponse.json({ ok: true, delivered: false, duplicate: true });

  await notifyUser(user.orgId, user.id, { title, body: body || null, type: "multipost", referenceId: key });
  return NextResponse.json({ ok: true, delivered: true });
}
