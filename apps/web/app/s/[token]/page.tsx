import { notFound } from "next/navigation";
import { getSession } from "@smartboss/auth";
import { resolveShareLink } from "@/modules/company-files/data/files";
import { SharedFileView } from "@/modules/company-files/components/shared-file-view";

export const dynamic = "force-dynamic";

/**
 * หน้าเปิดลิงก์แชร์ไฟล์ — ไม่ต้อง login (ดู app/u/[token] ของโมดูล
 * maintenance เป็นแบบอย่างเดียวกัน: token เดี่ยว ไม่มีบัญชี ไม่มี Shell/AppBar
 * ห่อ เพราะคนเปิดอาจไม่มีบัญชีในระบบเลย)
 */
export default async function SharedFilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveShareLink(token);
  if (!link) notFound();

  const session = await getSession();
  const scopeBlocked = link.scope === "org" && (!session || session.orgId !== link.file.orgId);

  return (
    <div className="min-h-dvh bg-(--bg-soft,#f7f9fc) flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl">
        {scopeBlocked ? (
          <div className="rounded-xl border border-(--line) bg-white p-6 text-center">
            <p className="text-base font-semibold mb-1">ลิงก์นี้เปิดเฉพาะคนในบริษัท</p>
            <p className="text-sm text-(--ink-soft) mb-4">กรุณาเข้าสู่ระบบด้วยบัญชีบริษัทนี้เพื่อเปิดไฟล์</p>
            <a href="/login" className="inline-flex h-10 items-center rounded-(--radius) bg-(--brand-green,#16a34a) px-4 text-sm font-medium text-white">
              เข้าสู่ระบบ
            </a>
          </div>
        ) : (
          <SharedFileView token={token} file={link.file} role={link.role} needsPassword={!!link.passwordHash} />
        )}
      </div>
    </div>
  );
}
