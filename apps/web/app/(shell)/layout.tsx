import { redirect } from "next/navigation";
import { loadShellNav } from "@/lib/nav";
import { Shell } from "@/components/shell/shell";
import { ceoTitle } from "@/lib/ceo-title";
import { CeoTitleProvider } from "@/lib/ceo-title-client";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = await loadShellNav();
  if (!nav) redirect("/login");
  // ชื่อเรียกตำแหน่งสูงสุดของบริษัท (CEO/Boss) ให้ทุกหน้าจอฝั่งเบราว์เซอร์ใช้ผ่าน useCeoTitle()
  const title = await ceoTitle();

  return (
    <CeoTitleProvider title={title}>
      <Shell user={nav.user} modules={nav.modules} unread={nav.unread}>
        {children}
      </Shell>
    </CeoTitleProvider>
  );
}
