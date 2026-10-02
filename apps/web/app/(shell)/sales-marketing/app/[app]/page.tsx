import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getSession, loadAuthUser, signSsoToken } from "@smartboss/auth";
import { SALES_MARKETING_APPS } from "@/lib/external-apps";

export const dynamic = "force-dynamic";

/** ตรงกับ open/[app]/route.ts — คนที่ "เห็นทั้งบริษัท" */
const ADMIN_ROLE_CODES = new Set(["SUPER_ADMIN", "ADMIN", "CEO"]);

/**
 * เปิดเว็บภายนอกอยู่ในหน้าต่าง SmartBoss เลย (ไม่เด้งแท็บใหม่ — กดย้อนกลับได้ และอยู่ใน
 * แอปที่ติดตั้งไว้) · เซ็น token อายุ 60 วินาทีทุกครั้งที่เปิดหน้า แล้วให้ iframe เข้า
 * `sso.embedEntry` ของแอปนั้น ซึ่งล็อกอินให้เองในกรอบนี้
 *
 * กรอบเต็มพื้นที่ใต้แถบบน 60px ของ LauncherFrame (shell.tsx) — -m-6 ลบ padding ของ <main>
 */
export default async function EmbeddedAppPage({ params }: { params: Promise<{ app: string }> }) {
  const { app: key } = await params;
  const app = SALES_MARKETING_APPS.find((a) => a.sso?.key === key);
  if (!app?.sso?.embedEntry) notFound();

  const session = await getSession();
  const user = session ? await loadAuthUser(session.userId) : null;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/sales-marketing/app/${key}`)}`);

  const secret = process.env[app.sso.secretEnv];
  // ยังไม่ได้ตั้งค่า SSO ของแอปนี้ — เปิดแบบเดิม (แท็บใหม่ผ่าน route open)
  if (!secret) redirect(`/sales-marketing/open/${key}`);

  const token = await signSsoToken(secret, app.sso.key, {
    userId: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.roles.some((r) => ADMIN_ROLE_CODES.has(r)),
  });
  const src = app.sso.embedEntry.replace("{token}", encodeURIComponent(token));
  const Icon = app.icon;

  return (
    <div className="-m-6 flex h-[calc(100dvh-60px)] flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-(--line) bg-(--bg) px-3 sm:px-4">
        <Link
          href="/sales-marketing"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-(--ink-soft) transition-colors hover:bg-(--bg-soft) hover:text-(--ink)"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">ขาย &amp; การตลาด</span>
        </Link>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: app.colorBg }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: app.color }} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-(--ink)">{app.name}</span>
        {/* ทางออกสำรอง เผื่อเบราว์เซอร์บล็อกคุกกี้ในกรอบ (เช่น Safari) แล้วล็อกอินไม่ติด */}
        <a
          href={`/sales-marketing/open/${key}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-(--ink-soft) transition-colors hover:bg-(--bg-soft) hover:text-(--ink)"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">เปิดในหน้าต่างใหม่</span>
        </a>
      </div>
      <iframe
        key={key}
        src={src}
        title={app.name}
        className="w-full flex-1 border-0 bg-(--bg-soft)"
        allow="clipboard-write; fullscreen"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
