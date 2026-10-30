"use client";

import { Fragment, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
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
import { NavSkeleton } from "@/components/shell/nav-skeleton";
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
import { CallManager } from "@/modules/chat/components/call-manager";
import { MarkReadOnRoute } from "@/modules/notifications/mark-read-on-route";
import { ShellProvider, useShell, type ShellUser } from "./shell-context";
import { WorkerLangToggle } from "@/modules/daily_worker/components/lang-toggle";
import { useBackToClose, useBackToCloseOnTouch, whenHistorySettled } from "@/lib/back-to-close";

export type { ShellUser };

/**
 * ช่องเมนูโมดูลบน bottom nav (ไม่นับช่อง "หน้าหลัก" ซ้ายสุด) — เกินนี้ใช้ช่องสุดท้ายเป็น
 * "เพิ่มเติม" แทน แถบจึงมีไม่เกิน 5 ช่องเสมอ
 */
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
  // extraPaths: โมดูลที่ครอบหลาย path (การเงินพนักงาน = /salary + /requests) — วัดความยาวจาก path ที่ตรง
  const matchLen = (m: ModuleManifest) =>
    Math.max(-1, ...[m.basePath, ...(m.extraPaths ?? [])].filter((p) => pathname === p || pathname.startsWith(p + "/")).map((p) => p.length));
  const matches = modules.filter((m) => matchLen(m) >= 0);
  return matches.sort((a, b) => matchLen(b) - matchLen(a))[0] ?? null;
}

function isMenuActive(pathname: string, menu: ModuleMenuItem, module: ModuleManifest) {
  const menuPath = menu.path;
  if (menu.activeFor?.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  // เมนู "แดชบอร์ด" (path = basePath หรือ extraPaths) active เฉพาะตอนอยู่หน้าแรกของส่วนนั้นพอดี
  if (menuPath === module.basePath || module.extraPaths?.includes(menuPath)) return pathname === menuPath;
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
      {/* โทรในแชท — จอสายเข้า/คุยอยู่ ขึ้นได้ทุกหน้า (modules/chat/lib/call-controller.ts) */}
      {hasChat && <CallManager />}
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
        >
          {children}
        </LauncherFrame>
      )}
      {/* โครงหน้าระหว่างเปลี่ยนหน้า (ตัวเดียวทั้งแอป — จางออกได้แม้เปลี่ยนจากหน้าหลักเข้าโมดูล) */}
      <NavSkeleton variant={activeModule ? "module" : "launcher"} />
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
  children,
}: {
  user: ShellUser;
  pathname: string;
  chatPath: string | null;
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
        <Link href="/" prefetch aria-label="หน้าหลัก">
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
          {/* คนงาน: เลือกภาษา (พม่า/ไทย/อังกฤษ) มุมขวาบน */}
          {user.workerLang && <WorkerLangToggle lang={user.workerLang} />}
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

      <HomeBottomNav pathname={pathname} chatPath={chatPath} />
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
  // พอดีช่องก็โชว์ครบ ไม่ต้องมี "เพิ่มเติม" · เกินก็เก็บช่องสุดท้ายไว้ให้ "เพิ่มเติม"
  const shown = module.menus.length <= MAX_TABS ? MAX_TABS : MAX_TABS - 1;
  const primary = module.menus.slice(0, shown);
  const overflow = module.menus.slice(shown);

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
    // lg:sticky + h-dvh: เมนูยาวกว่าจอ (ระบบบุคคล + การเงิน ~20 เมนู บนโน้ตบุ๊ก 768px) ให้เลื่อนในแถบซ้ายเอง
    // (nav overflow-y-auto) — เดิมแถบยืดตามเมนู เมนูล่าง ๆ ตกจอ · โมดูลที่เมนูสั้นหน้าตาเหมือนเดิม
    <aside className="hidden w-[200px] shrink-0 flex-col border-r border-(--line) bg-(--bg) lg:sticky lg:top-0 lg:flex lg:h-dvh">
      {/* โลโก้ SmartBoss ตรึงบนสุดทุกหน้าในโมดูล ("อยากให้โลโก้สมาบอสแสดงมุม
          ซ้ายขนทุกหน้าเลย") — เดิมแถวนี้เป็นของหัวข้อโมดูลไปเลย ทำให้โลโก้
          หายไปทันทีที่กดเข้าโมดูล เห็นแค่ตอนอยู่หน้ารวมแอป (LauncherFrame) */}
      <Link
        href="/"
        prefetch
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
        {module.menus.map((menu, i) => (
          <Fragment key={menu.path}>
            {/* หัวข้อกลุ่ม (ModuleMenuItem.group) — ขึ้นเมื่อกลุ่มเปลี่ยน · โมดูลที่ไม่ใส่ group หน้าตาเหมือนเดิม */}
            {menu.group && menu.group !== module.menus[i - 1]?.group && (
              <div className={cn("shrink-0 px-3 pb-1 text-xs font-semibold tracking-wide text-(--ink-soft)", i > 0 && "mt-3")}>{menu.group}</div>
            )}
            <RailItem menu={menu} active={isMenuActive(pathname, menu, module)} />
          </Fragment>
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
        "flex h-12 shrink-0 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
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
    isMenuActive(pathname, m, module)
  );

  return (
    <>
      <BottomBar>
        {/* ช่องซ้ายสุด = กลับหน้าหลัก ตำแหน่งเดียวกับ "หน้าหลัก" บนแถบของหน้าแรก — เดิมต้องกด
            "เพิ่มเติม" แล้วหา "กลับหน้ารวมแอป" ("พอไปหน้าอื่นๆมันต้องกด…ไปยังหน้าแรก") */}
        <BottomNavItem label="หน้าหลัก" icon="Home" href="/" active={false} home />
        {primary.map((menu) => (
          <BottomNavItem
            key={menu.path}
            label={menu.label}
            icon={menu.icon}
            href={menu.path}
            badge={menu.badge}
            active={isMenuActive(pathname, menu, module)}
          />
        ))}

        {overflow.length > 0 && (
          <BottomNavItem
            label="เพิ่มเติม"
            active={overflowActive}
            onClick={() => setSheetOpen(true)}
          />
        )}
      </BottomBar>

      {sheetOpen && overflow.length > 0 && (
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
              {overflow.map((menu, i) => {
                const active = isMenuActive(pathname, menu, module);
                return (
                  <Fragment key={menu.path}>
                  {/* หัวข้อกลุ่มเหมือนแถบซ้ายบนคอม (ModuleMenuItem.group) — โมดูลที่ไม่ใส่ group หน้าตาเหมือนเดิม */}
                  {menu.group && menu.group !== overflow[i - 1]?.group && (
                    <div className={cn("px-5 pb-1 text-xs font-semibold tracking-wide text-(--ink-soft)", i > 0 ? "pt-4" : "pt-1")}>{menu.group}</div>
                  )}
                  <Link
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
                  </Fragment>
                );
              })}
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
  home = false,
}: {
  label: string;
  icon?: string;
  href?: string;
  active: boolean;
  onClick?: () => void;
  /** แถบของหน้าแรก: เมนูที่อยู่เป็นตัวน้ำเงินเข้ม + จุดเขียวข้างใต้ แทนพื้นสีอ่อน */
  dot?: boolean;
  /** ช่อง "หน้าหลัก" บนแถบของโมดูล — สีเขียวแบรนด์ แยกจากเมนูของโมดูลว่าเป็นปุ่มออกจากโมดูล */
  home?: boolean;
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
          active && !dot && "bg-(--app-soft,#CCFBF1)",
          // สีคงที่ ไม่ใช้ --brand-green — บางโมดูล (บุคคล) ตั้งตัวแปรนี้เป็นสีของโมดูลเอง ปุ่มหน้าหลักจะกลายเป็นสีฟ้า
          home && "bg-[#e7f6e4]"
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
      : home
        ? "font-semibold text-[#3a9a2f]"
        : "text-(--ink-soft)"
  );

  return href ? (
    // ปุ่ม "หน้าหลัก" โหลดรอไว้ล่วงหน้า (เก็บไว้ 5 นาที) — เดิมปิดทุกลิงก์ (เซิร์ฟเวอร์ 2 core รับ
    // prefetch ทั้งเมนูไม่ไหว) กดกลับหน้าหลักจากทุกโมดูลเลยต้องรอเซิร์ฟเวอร์ 1–2 วิ จอนิ่งจนคนกดซ้ำ
    // ("กดกลับหน้าแรกช้ามาก ต้องกดหลายครั้ง") หน้าหลักเบา (query เล็ก ๆ ไม่กี่ตัว) เปิดลิงก์เดียวนี้พอ
    <Link href={href} prefetch={href === "/"} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/**
 * แถบเมนูล่าง (มือถือ) — ติดขอบล่างเต็มความกว้าง ("ชิดขอบล่างเลย จะได้ประหยัดพื้นที่") มุมบนมน เงาขึ้นด้านบน
 * สูง 68px เท่าเดิม — หน้าต่าง ๆ เว้นที่ด้วย pb-[68px]
 * และปฏิทินคำนวณความสูงจาก 68 อยู่แล้ว เปลี่ยนตัวเลขนี้ต้องไล่แก้ที่พวกนั้นด้วย
 * ช่องว่างรอบแถบปล่อยให้กดทะลุถึงเนื้อหาข้างหลัง (pointer-events-none ที่กรอบนอก)
 */
function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <nav data-bottom-nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-[68px] lg:hidden">
      <div className="pointer-events-auto relative flex h-full items-stretch rounded-t-[22px] bg-(--bg) shadow-[0_-4px_16px_rgba(15,30,60,0.10),0_-1px_2px_rgba(15,30,60,0.05)]">
        {children}
      </div>
    </nav>
  );
}

/**
 * แถบเมนูล่างของหน้าแรก (มือถือ) — หน้าหลัก · แชท · แจ้งเตือน · บัญชี
 * ปุ่มลงเวลาตรงกลาง (และไอคอนลงเวลาบนหน้าแรก) ย้ายเข้าไปเป็นหน้าแรกของระบบบุคคลแล้ว (/hr แท็บ "ลงเวลา")
 * — "เอาออกจากหน้านี้ ให้ไปอยู่ใน HR เป็นหัวข้อนึง"
 */
function HomeBottomNav({ pathname, chatPath }: { pathname: string; chatPath: string | null }) {
  const { unread } = useShell();

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

  return <BottomBar>{left}{right}</BottomBar>;
}
