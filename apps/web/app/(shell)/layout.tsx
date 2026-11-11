import { redirect } from "next/navigation";
import { loadShellNav } from "@/lib/nav";
import { Shell } from "@/components/shell/shell";
import { ceoTitle } from "@/lib/ceo-title";
import { CeoTitleProvider } from "@/lib/ceo-title-client";
import { loadSecurityGuards } from "@/lib/security-guards";
import { SecurityGuards } from "@/components/shell/security-guards";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = await loadShellNav();
  if (!nav) redirect("/login");
  // ชื่อเรียกตำแหน่งสูงสุดของบริษัท (CEO/Boss) ให้ทุกหน้าจอฝั่งเบราว์เซอร์ใช้ผ่าน useCeoTitle()
  const title = await ceoTitle();
  // ออกจากระบบเมื่อไม่ใช้งาน / บังคับยืนยันตัวตน 2 ชั้น — เฉพาะบริษัทที่เปิดไว้ (หลังบ้าน › ความปลอดภัย)
  const guards = await loadSecurityGuards();

  return (
    <CeoTitleProvider title={title}>
      <Shell user={nav.user} modules={nav.modules} unread={nav.unread}>
        {children}
      </Shell>
      {(guards.idleMinutes > 0 || guards.mustSetupTwoFactor) && (
        <SecurityGuards idleMinutes={guards.idleMinutes} mustSetupTwoFactor={guards.mustSetupTwoFactor} />
      )}
    </CeoTitleProvider>
  );
}
