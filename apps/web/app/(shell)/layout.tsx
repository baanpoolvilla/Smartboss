import { redirect } from "next/navigation";
import { loadShellNav } from "@/lib/nav";
import { Shell } from "@/components/shell/shell";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = await loadShellNav();
  if (!nav) redirect("/login");

  return (
    <Shell user={nav.user} modules={nav.modules} unread={nav.unread}>
      {children}
    </Shell>
  );
}
