"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LayoutGrid, MoreHorizontal, X } from "lucide-react";
import { cn } from "@smartboss/ui/cn";
import { Avatar } from "@smartboss/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@smartboss/ui/components/dropdown-menu";
import { Logo } from "@/components/logo";
import { Icon } from "@/components/icon";
import type { ModuleManifest, ModuleMenuItem } from "@/module-registry";
import { LogoutButton } from "./logout-button";
import { SessionRefresher } from "./session-refresher";
import { ShellProvider, type ShellUser } from "./shell-context";

export type { ShellUser };

/** จำนวนช่องบน bottom nav ก่อนยุบที่เหลือเข้า "เพิ่มเติม" (ตรงกับ maxTabs ของ ChangYai) */
const MAX_TABS = 4;

function findActiveModule(
  modules: ModuleManifest[],
  pathname: string
): ModuleManifest | null {
  return (
    modules.find(
      (m) => pathname === m.basePath || pathname.startsWith(m.basePath + "/")
    ) ?? null
  );
}

function isMenuActive(pathname: string, menuPath: string, basePath: string) {
  // เมนู "แดชบอร์ด" (path = basePath) active เฉพาะตอนอยู่หน้าแรกของโมดูลพอดี
  if (menuPath === basePath) return pathname === basePath;
  return pathname === menuPath || pathname.startsWith(menuPath + "/");
}

export function Shell({
  user,
  modules,
  unread = 0,
  children,
}: {
  user: ShellUser;
  modules: ModuleManifest[];
  unread?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeModule = findActiveModule(modules, pathname);

  return (
    <ShellProvider user={user} unread={unread}>
      <SessionRefresher />
      {activeModule ? (
        <ModuleFrame module={activeModule} pathname={pathname}>
          {children}
        </ModuleFrame>
      ) : (
        <LauncherFrame user={user} unread={unread}>
          {children}
        </LauncherFrame>
      )}
    </ShellProvider>
  );
}

/* ══════════════════════════════════════════════════════════════════
   นอกโมดูล (หน้าหลัก / การแจ้งเตือน) — ไม่มีเมนูโมดูลด้านซ้าย
   เข้าแอปจาก grid ตรงกลางหน้าหลักเท่านั้น
   ══════════════════════════════════════════════════════════════════ */
function LauncherFrame({
  user,
  unread,
  children,
}: {
  user: ShellUser;
  unread: number;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="flex min-h-dvh flex-col bg-(--bg-soft)">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-(--line) bg-(--bg) px-4 sm:px-6">
        <Link href="/" aria-label="หน้าหลัก">
          <Logo size="md" />
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/notifications"
            className="relative rounded-md p-2 text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
            aria-label="การแจ้งเตือน"
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger className="gap-2 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/40">
              <Avatar name={user.name} src={user.avatarUrl} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>
                <span className="block font-medium text-(--ink)">
                  {user.name}
                </span>
                <span className="block text-(--ink-soft)">{user.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/*
                ใช้ onSelect + router.push แทนการเอา <Link> มาซ้อนใน
                DropdownMenuItem เพราะตัวนั้น render เป็น <button> — <a> ซ้อนใน
                <button> เป็น HTML ที่ผิด เบราว์เซอร์จะจัดโครงสร้างใหม่เอง
                แล้ว React hydrate ไม่ตรงกับที่ server ส่งมา
              */}
              <DropdownMenuItem onSelect={() => router.push("/account")}>
                บัญชีของฉัน
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-1 py-0.5">
                <LogoutButton variant="menu" />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ในโมดูล — NavigationRail (จอใหญ่) / bottom nav (มือถือ) แบบ ChangYai
   AppBar เป็นของแต่ละหน้าเอง (ตรงกับ Scaffold ของเดิม)
   ══════════════════════════════════════════════════════════════════ */
function ModuleFrame({
  module,
  pathname,
  children,
}: {
  module: ModuleManifest;
  pathname: string;
  children: React.ReactNode;
}) {
  const primary = module.menus.slice(0, MAX_TABS);
  const overflow = module.menus.slice(MAX_TABS);

  return (
    <div
      data-app={module.id}
      className="flex min-h-dvh bg-(--bg-soft)"
      style={{ ["--module-color" as string]: module.color }}
    >
      <ModuleRail module={module} pathname={pathname} />

      {/* จอใหญ่: คอลัมน์สูงเท่าจอ ให้ body ของแต่ละหน้าเลื่อนเอง (เหมือน Scaffold)
          มือถือ: เลื่อนทั้งหน้า + เว้นที่ด้านล่างให้ bottom nav */}
      <div className="flex min-w-0 flex-1 flex-col pb-[68px] lg:h-dvh lg:overflow-hidden lg:pb-0">
        {children}
      </div>

      <ModuleBottomNav
        module={module}
        pathname={pathname}
        primary={primary}
        overflow={overflow}
      />
    </div>
  );
}

function ModuleRail({
  module,
  pathname,
}: {
  module: ModuleManifest;
  pathname: string;
}) {
  return (
    <aside className="hidden w-[200px] shrink-0 flex-col border-r border-(--line) bg-(--bg) lg:flex">
      {/* หัวราง = ทางออกกลับไปหน้ารวมแอป (เหมือนกดปุ่ม home ของมือถือ) */}
      <Link
        href="/"
        title="กลับหน้ารวมแอป"
        className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-(--line) px-4 transition-colors hover:bg-(--bg-soft)"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: module.colorBg }}
        >
          <Icon name={module.icon} className="h-5 w-5" style={{ color: module.color }} />
        </span>
        <span className="truncate text-sm font-bold text-(--ink)">
          {module.name}
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {module.menus.map((menu) => (
          <RailItem
            key={menu.path}
            menu={menu}
            active={isMenuActive(pathname, menu.path, module.basePath)}
          />
        ))}
      </nav>
    </aside>
  );
}

function RailItem({ menu, active }: { menu: ModuleMenuItem; active: boolean }) {
  return (
    <Link
      href={menu.path}
      className={cn(
        "flex h-12 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
        active
          ? "bg-(--app-soft,#CCFBF1) font-bold text-(--app-strong,var(--ink))"
          : "text-(--ink-soft) hover:bg-(--bg-soft)"
      )}
    >
      <Icon name={menu.icon} className="h-5 w-5 shrink-0" />
      <span className="truncate">{menu.label}</span>
      {menu.badge}
    </Link>
  );
}

function ModuleBottomNav({
  module,
  pathname,
  primary,
  overflow,
}: {
  module: ModuleManifest;
  pathname: string;
  primary: ModuleMenuItem[];
  overflow: ModuleMenuItem[];
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const overflowActive = overflow.some((m) =>
    isMenuActive(pathname, m.path, module.basePath)
  );

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[68px] items-stretch border-t border-(--line) bg-(--bg) shadow-[0_-1px_8px_rgba(23,51,47,0.06)] lg:hidden">
        {primary.map((menu) => (
          <BottomNavItem
            key={menu.path}
            label={menu.label}
            icon={menu.icon}
            href={menu.path}
            active={isMenuActive(pathname, menu.path, module.basePath)}
          />
        ))}

        {overflow.length > 0 && (
          <BottomNavItem
            label="เพิ่มเติม"
            active={overflowActive}
            onClick={() => setSheetOpen(true)}
          />
        )}
      </nav>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-[20px] bg-(--bg) pb-6">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="mx-auto h-1 w-10 rounded-full bg-(--line)" />
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="absolute right-3 top-3 rounded-md p-1.5 text-(--ink-soft)"
                aria-label="ปิด"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 flex flex-col">
              {overflow.map((menu) => {
                const active = isMenuActive(
                  pathname,
                  menu.path,
                  module.basePath
                );
                return (
                  <Link
                    key={menu.path}
                    href={menu.path}
                    onClick={() => setSheetOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3.5 text-sm",
                      active
                        ? "bg-(--app-pale,var(--bg-soft)) font-bold text-(--app-strong,var(--ink))"
                        : "text-(--ink)"
                    )}
                  >
                    <Icon name={menu.icon} className="h-5 w-5 shrink-0" />
                    {menu.label}
                  </Link>
                );
              })}
              <Link
                href="/"
                onClick={() => setSheetOpen(false)}
                className="mt-1 flex items-center gap-3 border-t border-(--line) px-5 py-3.5 text-sm text-(--ink-soft)"
              >
                <LayoutGrid className="h-5 w-5 shrink-0" />
                กลับหน้ารวมแอป
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BottomNavItem({
  label,
  icon,
  href,
  active,
  onClick,
}: {
  label: string;
  icon?: string;
  href?: string;
  active: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          "flex h-8 w-16 items-center justify-center rounded-full transition-colors",
          active && "bg-(--app-soft,#CCFBF1)"
        )}
      >
        {icon ? <Icon name={icon} className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
      </span>
      <span className="mt-0.5 truncate text-[11px] leading-tight">{label}</span>
    </>
  );

  const className = cn(
    "flex min-w-0 flex-1 flex-col items-center justify-center px-1 pt-2",
    active
      ? "font-bold text-(--app-strong,var(--ink))"
      : "text-(--ink-soft)"
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}
