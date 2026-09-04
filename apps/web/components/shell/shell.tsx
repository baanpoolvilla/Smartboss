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
import { IssueReportBarButton } from "@/modules/report_task/components/issue-report/issue-report-bar-button";
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
          {/* This launcher header (home page, plus /notifications and
              /account — anything not matching a module's own basePath, see
              findActiveModule) is the one place in the app that doesn't go
              through AppScaffold/AppBarActions, so it never got the 🐛
              report button every module page has — asked to audit and fix
              this explicitly ("ทุกหน้าต้องมีให้กดตัวแมลงเพื่อแจ้งนะ ทั้ง
              ระบบ"). */}
          <IssueReportBarButton />
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
          มือถือ: เลื่อนทั้งหน้า + เว้นที่ด้านล่างให้ bottom nav — ทุกหน้าใน
          แอปพึ่งพฤติกรรมนี้ (70+ หน้า) ยกเว้นสองหน้าที่ประกาศตัวเองว่าจัดการ
          scroll เอง (AppScaffold's `fill`) ซึ่งแก้ให้ล็อกที่ตัวมันเองแทน ไม่ใช่
          ที่นี่ — เปลี่ยนตรงนี้ตรงๆ จะกระทบทุกหน้าที่ยังไม่ได้ตรวจว่ามี scroll
          chain ของตัวเองรองรับมือถือหรือเปล่า */}
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
    <aside className="hidden w-[68px] shrink-0 flex-col items-center border-r border-(--line) bg-(--bg) lg:flex">
      {/* หัวราง = ทางออกกลับไปหน้ารวมแอป (เหมือนกดปุ่ม home ของมือถือ) — ไอคอน
          โมดูลอย่างเดียว ไม่มีชื่อยาว ให้เข้าชุดกับรางไอคอนด้านล่าง */}
      <Link
        href="/"
        title="กลับหน้ารวมแอป"
        aria-label="กลับหน้ารวมแอป"
        className="flex h-[60px] w-full shrink-0 items-center justify-center border-b border-(--line) transition-colors hover:bg-(--bg-soft)"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: module.colorBg }}
        >
          <Icon name={module.icon} className="h-5 w-5" style={{ color: module.color }} />
        </span>
      </Link>

      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
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
      // เหตุผลเดียวกับ AppIcon ใน (shell)/page.tsx — เมนูข้างซ้ายมองเห็นครบ
      // ทุกอันพร้อมกันตอนเข้าโมดูล prefetch ค่าเริ่มต้นเลยยิงพร้อมกันหมด
      // ชน Prisma pool บน VM 2 core (เจอเป็นอาการ "กดเมนูข้างซ้ายหน่วง")
      prefetch={false}
      // ไอคอนอย่างเดียว ไม่มีตัวอักษรค้าง — ชื่อเมนูยังอ่านได้ผ่าน tooltip ของ
      // เบราว์เซอร์เอง (title) แทน แบบเดียวกับ Discord/Slack's icon rail
      title={menu.label}
      aria-label={menu.label}
      className={cn(
        "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors",
        active
          ? "bg-(--app-soft,#CCFBF1) text-(--app-strong,var(--ink))"
          : "text-(--ink-soft) hover:bg-(--bg-soft)"
      )}
    >
      <Icon name={menu.icon} className="h-5 w-5" />
      {menu.badge && <span className="absolute -right-1 -top-1">{menu.badge}</span>}
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

        {/* Always shown, even with nothing to overflow into — the sheet this
            opens is also the only place "กลับหน้ารวมแอป" lives on mobile
            (ModuleRail's equivalent header link is lg-only). Gating this tab
            on `overflow.length > 0` used to strand anyone whose visible menu
            count fit within MAX_TABS (e.g. a report_task user without
            settingManage/activityView — exactly 4 items, no overflow) with
            no way back to the app launcher at all once inside a module. */}
        <BottomNavItem
          label="เพิ่มเติม"
          active={overflowActive}
          onClick={() => setSheetOpen(true)}
        />
      </nav>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-[20px] bg-(--bg) pb-6 shadow-[0_-4px_24px_rgba(0,0,0,0.12)]">
            {/* Drag handle on its own centered row — purely decorative, so it
                doesn't need to share a row (and fight over centering) with
                the close button next to it. */}
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="h-1 w-10 rounded-full bg-(--line)" />
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-(--bg-soft) text-(--ink-soft) hover:bg-(--line) hover:text-(--ink) transition-colors"
              aria-label="ปิด"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mt-2 flex flex-col">
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
    <Link href={href} prefetch={false} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}
