"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clock, LayoutGrid, MoreHorizontal, X } from "lucide-react";
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
import { NavigationProgress } from "@/components/shell/navigation-progress";
import { ImageAnnotatorHost } from "@/components/annotate/image-annotator-host";
import { Icon } from "@/components/icon";
import { IssueReportBarButton } from "@/modules/report_task/components/issue-report/issue-report-bar-button";
import { ReportNotificationSync } from "@/modules/report_task/components/shared/report-notification-sync";
import { NotificationBellPopover } from "@/modules/report_task/components/shared/notification-bell-popover";
import type { ModuleManifest, ModuleMenuItem } from "@/module-registry";
import { Toaster } from "@/modules/report_task/components/ui/sonner";
import { StickerManagerHost } from "@/components/sticker-manager";
import { setEmojiRecentOwner } from "@/components/emoji-picker";
import { LogoutButton } from "./logout-button";
import { InstallAppButton, InstallGate } from "./app-install";
import { AppUpdateNotice } from "./app-update-notice";
import { NotificationSetup } from "./notification-setup";
import { SaveFeedback } from "./save-feedback";
import { SessionRefresher } from "./session-refresher";
import { FileSizeGuard } from "./file-size-guard";
import { SystemNotify } from "./system-notify";
import { ChatNotifyListener } from "@/modules/chat/components/chat-nav-badge";
import { MarkReadOnRoute } from "@/modules/notifications/mark-read-on-route";
import { ShellProvider, useShell, type ShellUser } from "./shell-context";
import { useClockState } from "@/components/home/clock-tile";
import { APP_CLOCK_ENABLED } from "@/modules/hr/lib/app-clock";
import { useBackToClose, useBackToCloseOnTouch, whenHistorySettled } from "@/lib/back-to-close";

export type { ShellUser };

/** จำนวนช่องบน bottom nav ก่อนยุบที่เหลือเข้า "เพิ่มเติม" (ตรงกับ maxTabs ของ ChangYai) */
const MAX_TABS = 4;

function findActiveModule(
  modules: ModuleManifest[],
  pathname: string
): ModuleManifest | null {
  // Longest basePath wins, not first-in-array — "แจ้งบัค" ของ Super Admin
  // (basePath /admin/issue-reports) sits underneath "หลังบ้าน"'s own
  // basePath (/admin), so a first-match .find() would always resolve
  // to หลังบ้าน instead (its shorter basePath matches the same
  // pathname.startsWith() check first), making แจ้งบัค's own sidebar
  // unreachable no matter where it sits in moduleRegistry's array.
  const matches = modules.filter((m) => pathname === m.basePath || pathname.startsWith(m.basePath + "/"));
  return matches.sort((a, b) => b.basePath.length - a.basePath.length)[0] ?? null;
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
  // "อีโมจิที่ใช้ล่าสุด" จำแยกรายบัญชีในเครื่องเดียวกัน (ดู components/emoji-picker.tsx)
  useEffect(() => setEmojiRecentOwner(user.id), [user.id]);
  // เข้าแชทได้ = มีเมนูแชทในโมดูลที่เห็น (รายการโมดูล/เมนูถูกกรองตามสิทธิ์มาแล้ว)
  const hasChat = modules.some((m) => m.menus.some((i) => i.path.endsWith("/chat")));

  return (
    <ShellProvider user={user} unread={unread}>
      <SessionRefresher />
      {/* แถบโหลดด้านบนทันทีที่กดลิงก์ — ไม่งั้นจอนิ่งจนหน้าใหม่เสร็จ ดูเหมือนกดไม่ติด */}
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      {/* หน้าต่างวาด/เขียนบนรูปก่อนส่ง — เปิดจากปุ่มปากกาในทุกช่องพิมพ์ */}
      <ImageAnnotatorHost />
      {/* ไฟล์ใหญ่เกิน — เตือนขนาดจริง/เพดาน ก่อนส่งฟอร์มที่แนบไฟล์ทุกหน้า */}
      <FileSizeGuard />
      {/* เปิดหน้าที่แจ้งเตือนชี้มาเอง (ไม่ได้กดจากกระดิ่ง) ก็นับว่าอ่านแล้ว */}
      <Suspense fallback={null}>
        <MarkReadOnRoute />
      </Suspense>
      {/* ตัวแสดง toast ของทั้งแอป (ย้ายมาจาก report-task-scaffold ที่มีแค่โมดูลเดียว)
          + ข้อความ "บันทึกสำเร็จ" หลังกดส่งฟอร์มทุกฟอร์ม */}
      <Toaster position="top-center" closeButton />
      <SaveFeedback />
      {/* เสียง + เด้งแจ้งเตือนของทุกโมดูล (ท่อสด notify.new) */}
      <SystemNotify />
      {/* แชทเข้า → เสียง + เด้ง ทุกหน้า ทุกโมดูล (ไม่ใช่แค่ตอนเห็นเมนูแชท) */}
      {hasChat && <ChatNotifyListener />}
      {/* หน้าจัดการสติกเกอร์บริษัท — เปิดจากตัวเลือกสติกเกอร์ในแชท/รายงาน (components/sticker-manager.tsx) */}
      {hasChat && <StickerManagerHost />}
      {/* ชวนติดตั้งเป็นแอป (มือถือ) + แจ้งเมื่อมีเวอร์ชันใหม่ — ทุกหน้า ทุกโมดูล */}
      <InstallGate />
      <AppUpdateNotice />
      {/* ชวนเปิดการแจ้งเตือนตอนเปิดแอปที่ติดตั้ง/บนคอม — ทุกหน้า */}
      <NotificationSetup />
      {activeModule ? (
        <ModuleFrame module={activeModule} pathname={pathname}>
          {children}
        </ModuleFrame>
      ) : (
        <LauncherFrame
          user={user}
          pathname={pathname}
          chatPath={modules.flatMap((m) => m.menus).find((i) => i.path.endsWith("/chat"))?.path ?? null}
          // เงื่อนไขเดียวกับไอคอนลงเวลาในหน้าแรก (app/(shell)/page.tsx)
          showClock={APP_CLOCK_ENABLED && modules.some((m) => m.id === "hr")}
        >
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
  pathname,
  chatPath,
  showClock,
  children,
}: {
  user: ShellUser;
  pathname: string;
  chatPath: string | null;
  showClock: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  // มือถือ: ปุ่มย้อนกลับปิดเมนูโปรไฟล์ก่อน
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  useBackToCloseOnTouch(userMenuOpen, () => setUserMenuOpen(false));

  return (
    <div className="flex min-h-dvh flex-col bg-(--bg-soft)">
      {/* ไม่มี border-b ตั้งใจ — ("อยากให้เป็นแบบนี้ไม่มีเส้น มันงงอะดูแปลกๆ")
          สีพื้นขาว (--bg) ต่างจากพื้นหลังหน้า (--bg-soft) ด้านล่างอยู่แล้ว พอ
          แยกส่วนได้โดยไม่ต้องมีเส้นขีดเพิ่ม ให้ตรงกับหัวรางฝั่งซ้ายในโมดูล
          ที่เอาเส้นระหว่างโลโก้กับหัวข้อออกไปแล้วเหมือนกัน */}
      <header className="flex h-[60px] shrink-0 items-center justify-between bg-(--bg) px-4 sm:px-6">
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
              ระบบ"). Same reasoning applies to the report_task notification
              count below — this header needs its own copy of both. */}
          <InstallAppButton />
          <IssueReportBarButton />
          <ReportNotificationSync />
          <NotificationBellPopover />

          <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
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
              {/* รอให้เมนูปิด (และถอยช่องประวัติของปุ่มย้อนกลับ) เสร็จก่อนค่อยเปลี่ยนหน้า — บนมือถือ
                  การถอยนั้นเคยยกเลิกการไปหน้าบัญชี "กดบัญชีของฉันไม่ได้" */}
              <DropdownMenuItem onSelect={() => whenHistorySettled(() => router.push("/account"))}>
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

      {/* มือถือ: เว้นที่ด้านล่างให้แถบเมนูลอย (68px) + ระยะหายใจเดิม 24px */}
      <main data-bottom-nav-pad className="min-w-0 flex-1 p-6 pb-[92px] lg:pb-6">{children}</main>

      <HomeBottomNav userId={user.id} pathname={pathname} chatPath={chatPath} showClock={showClock} />
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
      <div data-bottom-nav-pad className="flex min-w-0 flex-1 flex-col pb-[68px] lg:h-dvh lg:overflow-hidden lg:pb-0">
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
      {/* โลโก้ SmartBoss ตรึงบนสุดทุกหน้าในโมดูล ("อยากให้โลโก้สมาบอสแสดงมุม
          ซ้ายขนทุกหน้าเลย") — เดิมแถวนี้เป็นของหัวข้อโมดูลไปเลย ทำให้โลโก้
          หายไปทันทีที่กดเข้าโมดูล เห็นแค่ตอนอยู่หน้ารวมแอป (LauncherFrame) */}
      <Link
        href="/"
        aria-label="หน้าหลัก"
        // h-[60px] + px-4 sm:px-6 ตรงกับ header ของ LauncherFrame ทุกตัวเป๊ะ ๆ
        // (เดิม px-4 ตายตัว ทำให้โลโก้อยู่คนละตำแหน่งกับหน้าหลัก "ให้มันตรง
        // กับตำแหน่งหน้าหลัก") — ความสูง 60px เท่ากับ topbar ของเนื้อหาฝั่งขวา
        // (AppScaffold) พอดี
        //
        // border-b กลับมาอีกครั้ง — ตอนเอาออก (ให้โลโก้กับหัวข้อโมดูลรวมเป็น
        // บล็อกเดียว "แบ่งกันมากเกินไป") ดันทำให้เส้นใต้ topbar ฝั่งขวา
        // ("แดชบอร์ด" ที่ y=60) เหลือแค่ครึ่งเดียวของหน้า เพราะฝั่งซ้ายไม่มีเส้น
        // มาบรรจบที่ระดับเดียวกัน ("ตีเส้นตรงนี้ให้หน่อย") ที่ y=60 ต้องมีเส้น
        // ต่อกันเต็มความกว้างเสมอ — ไปกันคนละตำแหน่งกับที่คิดว่า "แบ่งเยอะไป"
        className="flex h-[60px] shrink-0 items-center border-b border-(--line) px-4 sm:px-6 transition-colors hover:bg-(--bg-soft)"
      >
        <Logo size="md" />
      </Link>

      {/* หัวข้อโมดูล ใต้โลโก้ — กดแล้วกลับหน้าแรกของโมดูลนี้ (โลโก้ด้านบน = กลับหน้ารวมแอป
          คนละหน้าที่กัน ไม่ซ้ำซ้อนแบบเดิมที่ทั้งคู่พากลับหน้ารวมแอป) ไปเมนูแรกที่ผู้ใช้คนนี้เห็น
          ไม่ใช่ basePath ตรง ๆ — คนที่ไม่มีสิทธิ์หน้าแรก (เช่น แดชบอร์ด) จะได้ไม่โดนเด้งออก
          เส้นขอบล่างปิดท้ายก่อนเข้าเมนู */}
      <Link
        href={module.menus[0]?.path ?? module.basePath}
        prefetch={false}
        title={`หน้าแรกของ${module.name}`}
        className="flex h-[56px] shrink-0 items-center gap-2.5 border-b border-(--line) px-4 transition-colors hover:bg-(--bg-soft)"
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
      // เหตุผลเดียวกับ AppIcon ใน (shell)/page.tsx — เมนูข้างซ้ายมองเห็นครบ
      // ทุกอันพร้อมกันตอนเข้าโมดูล prefetch ค่าเริ่มต้นเลยยิงพร้อมกันหมด
      // ชน Prisma pool บน VM 2 core (เจอเป็นอาการ "กดเมนูข้างซ้ายหน่วง")
      prefetch={false}
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
  useBackToClose(sheetOpen, () => setSheetOpen(false));
  const overflowActive = overflow.some((m) =>
    isMenuActive(pathname, m.path, module.basePath)
  );

  return (
    <>
      <BottomBar>
        {primary.map((menu) => (
          <BottomNavItem
            key={menu.path}
            label={menu.label}
            icon={menu.icon}
            href={menu.path}
            badge={menu.badge}
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
      </BottomBar>

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
  badge,
  dot = false,
}: {
  label: string;
  icon?: string;
  href?: string;
  active: boolean;
  onClick?: () => void;
  /** แถบของหน้าแรก: เมนูที่อยู่เป็นตัวน้ำเงินเข้ม + จุดเขียวข้างใต้ แทนพื้นสีอ่อน */
  dot?: boolean;
  /** Optional count/dot pill from the module manifest. Overlaid on the icon's
   * top-right corner (absolute) so it never widens the already-tight bottom
   * bar — see manifest.ts's ModuleMenuItem.badge. */
  badge?: React.ReactNode;
}) {
  const body = (
    <>
      <span
        className={cn(
          "relative flex h-7 w-14 items-center justify-center rounded-full transition-colors",
          active && !dot && "bg-(--app-soft,#CCFBF1)"
        )}
      >
        {icon ? <Icon name={icon} className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
        {badge ? (
          <span className="pointer-events-none absolute -top-1 left-1/2 ml-2">{badge}</span>
        ) : null}
      </span>
      <span className="mt-0.5 truncate text-[11px] leading-tight">{label}</span>
      {dot && active && <span className="absolute bottom-1 h-[5px] w-[5px] rounded-full bg-(--brand-green)" />}
    </>
  );

  const className = cn(
    "relative flex min-w-0 flex-1 flex-col items-center justify-center px-1",
    active
      ? dot
        ? "font-bold text-(--brand-navy)"
        : "font-bold text-(--app-strong,var(--ink))"
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

/**
 * แถบเมนูล่างแบบลอย (มือถือ) — การ์ดขาวมุมมน มีเงา เว้นขอบซ้าย/ขวา/ล่าง ("ของเราไม่ดูไม่มีมิติเลย")
 * พื้นที่รวมยังสูง 68px เท่าเดิม (แถบ 60px + ขอบล่าง 8px) — หน้าต่าง ๆ เว้นที่ด้วย pb-[68px]
 * และปฏิทินคำนวณความสูงจาก 68 อยู่แล้ว เปลี่ยนตัวเลขนี้ต้องไล่แก้ที่พวกนั้นด้วย
 * ช่องว่างรอบแถบปล่อยให้กดทะลุถึงเนื้อหาข้างหลัง (pointer-events-none ที่กรอบนอก)
 */
function BottomBar({ children, notch = false }: { children: React.ReactNode; notch?: boolean }) {
  return (
    <nav data-bottom-nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-[68px] px-2.5 pb-2 lg:hidden">
      {notch ? (
        // แถบเว้าโค้งรับปุ่มกลาง: ตัดวงกลมออกจากพื้นขาวด้วย mask — เงาต้องใช้ drop-shadow ที่ชั้นนอก
        // (box-shadow โดน mask ตัดไปด้วย)
        <div className="pointer-events-auto relative flex h-full items-stretch [filter:drop-shadow(0_8px_14px_rgba(27,37,55,0.12))_drop-shadow(0_1px_2px_rgba(27,37,55,0.08))]">
          <div
            aria-hidden
            className="absolute inset-0 rounded-[22px] bg-(--bg)"
            style={{ maskImage: NOTCH_MASK, WebkitMaskImage: NOTCH_MASK }}
          />
          {children}
        </div>
      ) : (
        <div className="pointer-events-auto flex h-full items-stretch rounded-[22px] bg-(--bg) shadow-[0_10px_24px_rgba(15,30,60,0.16),0_2px_6px_rgba(15,30,60,0.08)] ring-1 ring-black/[0.04]">
          {children}
        </div>
      )}
    </nav>
  );
}

/** วงที่เว้าออกจากขอบบนตรงกลางแถบ — ใหญ่กว่าปุ่ม (50px) นิดหน่อยให้เห็นขอบโค้งรอบปุ่ม */
const NOTCH_MASK = "radial-gradient(circle 32px at 50% -4px, transparent 31px, #000 32px)";

/** สีปุ่มลงเวลา — สีจากโลโก้เท่านั้น: เขียว "Smart" = เข้างาน · น้ำเงินเข้ม "Boss" = ออกงาน · เขียวอ่อน = ลงครบแล้ว */
const CLOCK_LOOK = {
  in: { bg: "linear-gradient(155deg,#6fcf63,#3a9a2f)", icon: "#fff", text: "#3a9a2f", glow: "rgba(76,185,63,0.35)" },
  out: { bg: "linear-gradient(155deg,#34435e,var(--brand-navy))", icon: "#fff", text: "var(--brand-navy)", glow: "rgba(27,37,55,0.30)" },
  done: { bg: "linear-gradient(155deg,#eaf7e7,#d6efd1)", icon: "#3a9a2f", text: "var(--ink-soft)", glow: "rgba(27,37,55,0.10)" },
} as const;

/**
 * แถบเมนูล่างของหน้าแรก (มือถือ) — หน้าหลัก · แชท · [ลงเวลา] · แจ้งเตือน · บัญชี
 * ปุ่มกลาง "ลงเวลา" ยกขึ้นเป็นวงกลม มีเฉพาะคนที่ต้องลงเวลา (สถานะเดียวกับไอคอนลงเวลาในหน้าแรก)
 * สีบอกว่ากดเข้าไปจะได้ทำอะไร (CLOCK_LOOK): เขียว เข้างาน · น้ำเงินเข้ม ออกงาน · เขียวอ่อน ลงครบแล้ว
 * แถบเว้าโค้งรับปุ่มกลาง ใต้ปุ่มบอกเวลาเข้า (แทนไอคอนลงเวลาบนหน้าแรกที่ซ่อนไว้บนมือถือ)
 * หน้าในโมดูลไม่มีปุ่มกลาง ("หน้าอื่นๆไม่ต้องมีตัวกลาง") — ใช้ ModuleBottomNav
 */
function HomeBottomNav({
  userId,
  pathname,
  chatPath,
  showClock,
}: {
  userId: string;
  pathname: string;
  chatPath: string | null;
  showClock: boolean;
}) {
  const { unread } = useShell();
  const clock = useClockState(userId);
  const clockVisible = showClock && clock.kind !== "hidden" && clock.kind !== "loading";
  const look = clock.kind === "in" ? CLOCK_LOOK.in : clock.kind === "out" ? CLOCK_LOOK.out : CLOCK_LOOK.done;
  const clockLabel = clock.kind === "in" ? "เข้างาน" : clock.kind === "out" ? "ออกงาน" : clock.kind === "done" ? "ลงเวลาแล้ว" : "ลงเวลา";
  const clockSub =
    clock.kind === "out" && clock.since
      ? `เข้า ${clock.since}`
      : clock.kind === "done"
        ? clock.since
          ? `${clock.since}–${clock.at}`
          : `ออก ${clock.at}`
        : null;

  const left = (
    <>
      <BottomNavItem dot label="หน้าหลัก" icon="Home" href="/" active={pathname === "/"} />
      {chatPath && <BottomNavItem dot label="แชท" icon="MessageCircle" href={chatPath} active={false} />}
    </>
  );
  const right = (
    <>
      <BottomNavItem
        dot
        label="แจ้งเตือน"
        icon="Bell"
        href="/notifications"
        active={pathname.startsWith("/notifications")}
        badge={
          unread > 0 ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-bold leading-none text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null
        }
      />
      <BottomNavItem dot label="บัญชี" icon="User" href="/account" active={pathname.startsWith("/account")} />
    </>
  );

  if (!clockVisible) return <BottomBar>{left}{right}</BottomBar>;

  return (
    <BottomBar notch>
      {/* ซ้าย/ขวากว้างเท่ากันเสมอ ปุ่มกลางจะตรงกับรอยเว้าพอดี แม้ฝั่งซ้ายไม่มีแชท */}
      <div className="relative flex flex-1">{left}</div>
      <div className="w-[76px] shrink-0" />
      <div className="relative flex flex-1">{right}</div>
      <Link
        href="/clock"
        prefetch={false}
        className="absolute left-1/2 top-[-25px] flex w-[76px] -translate-x-1/2 flex-col items-center"
      >
        <span
          className="flex h-[50px] w-[50px] items-center justify-center rounded-full transition-transform active:scale-95"
          style={{ background: look.bg, color: look.icon, boxShadow: `0 8px 16px ${look.glow}, inset 0 1px 0 rgba(255,255,255,0.3)` }}
        >
          <Clock className="h-6 w-6" />
        </span>
        <span className="mt-[3px] whitespace-nowrap text-[10px] font-bold leading-tight" style={{ color: look.text }}>
          {clockLabel}
        </span>
        {clockSub && (
          <span className="whitespace-nowrap text-[9px] leading-tight tabular-nums text-(--ink-soft)">{clockSub}</span>
        )}
      </Link>
    </BottomBar>
  );
}
