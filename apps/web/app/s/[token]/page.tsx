import { notFound } from "next/navigation";
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

  return (
    <div className="min-h-dvh bg-(--bg-soft,#f7f9fc) flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl">
        <SharedFileView token={token} file={link.file} role={link.role} />
      </div>
    </div>
  );
}
