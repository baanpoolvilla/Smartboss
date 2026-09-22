import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { MODULE_CARDS, PRIMARY_MODULE_CODES } from "@/lib/modules";
import { iconByName } from "@/lib/icons";
import { loadShellNav } from "@/lib/nav";
import { AppTileReviewBadge } from "@/modules/report_task/components/shared/app-tile-review-badge";
import { NotifCountBadge } from "@/modules/notifications/notif-count-badge";

interface AppTile {
  code: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** สีไอคอน/พื้นไอคอน — โมดูลที่ยังไม่เปิดใช้จะไม่ใช้ค่านี้ */
  color: string;
  colorBg: string;
  /** มีค่า = กดเข้าได้ (บริษัทเปิดใช้ + ผู้ใช้มีสิทธิ์) */
  href?: string;
}

function thaiToday(): string {
  return new Intl.DateTimeFormat("th-TH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    calendar: "buddhist",
  }).format(new Date());
}

/**
 * หน้ารวมแอป — เข้าโมดูลด้วยการกดไอคอนตรงกลาง เหมือนหน้าโฮมของมือถือ
 * (ไม่มีรายการโมดูลบนแถบซ้ายอีกแล้ว — แถบซ้ายจะโผล่เฉพาะตอนอยู่ในโมดูล)
 *
 * แบ่งสองฝั่ง: ซ้าย = โมดูลหลักที่บริษัทใช้ทุกวัน (ไอคอนใหญ่กว่า) /
 * ขวา = โมดูลและเครื่องมือที่เหลือ
 */
export default async function HomePage() {
  const nav = await loadShellNav();
  if (!nav) redirect("/login");

  const firstName = nav.user.name.split(/\s+/)[0] ?? "ผู้ใช้งาน";
  const visible = new Map(nav.modules.map((m) => [m.id, m]));

  // 6 โมดูลที่วางแผนไว้ (เปิดแล้ว = กดได้ / ยังไม่เปิด = "เร็ว ๆ นี้")
  const tiles: AppTile[] = MODULE_CARDS.map((mod) => ({
    code: mod.code,
    name: mod.name,
    description: mod.description,
    icon: mod.icon,
    color: `var(${mod.colorVar})`,
    colorBg: `var(${mod.colorBgVar})`,
    href: visible.get(mod.code)?.basePath,
  }));

  // โมดูลที่ติดตั้งเพิ่มภายหลัง (ไม่อยู่ใน 6 การ์ด) — ดึงหน้าตาจาก manifest
  for (const m of nav.modules) {
    if (tiles.some((t) => t.code === m.id)) continue;
    // "แจ้งบัค" ของ user ทั่วไป (issueReportSelfManifest) — Super Admin มี tile
    // "แจ้งบัค" ของตัวเองอยู่แล้ว (admin_issue_report ที่มีเมนู "ตั๋วของฉัน")
    // ไม่โชว์ซ้ำสองอัน
    if (m.id === "issue_report_self" && visible.has("admin_issue_report")) continue;
    tiles.push({
      code: m.id,
      name: m.name,
      description: m.name,
      icon: iconByName(m.icon),
      color: m.color,
      colorBg: m.colorBg,
      href: m.basePath,
    });
  }

  // ฝั่งซ้าย = โมดูลหลัก เรียงตามลำดับที่ตั้งไว้ (ไม่ใช่ลำดับใน tiles)
  const byCode = new Map(tiles.map((t) => [t.code, t]));
  const primary = PRIMARY_MODULE_CODES.map((code) => byCode.get(code)).filter(
    (t): t is AppTile => t !== undefined,
  );
  const primaryCodes = new Set(primary.map((t) => t.code));
  const secondary = tiles.filter((t) => !primaryCodes.has(t.code));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 text-center sm:mb-10">
        <h1 className="text-2xl font-semibold text-(--ink)">
          สวัสดี, {firstName}
        </h1>
        <p className="mt-1 text-sm text-(--ink-soft)">{thaiToday()}</p>
      </header>

      {/* จอเล็กเรียงบนล่าง (เส้นคั่นเป็นขีดแนวนอน) — md ขึ้นไปแยกซ้าย-ขวา */}
      <div className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-0">
        <section className="md:pr-8">
          <SectionLabel>โมดูลหลัก</SectionLabel>
          <div className="grid grid-cols-3 gap-x-2 gap-y-7 sm:gap-x-4">
            {primary.map((tile) => (
              <AppIcon key={tile.code} tile={tile} size="lg" />
            ))}
          </div>
        </section>

        <section className="border-t border-(--line) pt-8 md:border-t-0 md:border-l md:pt-0 md:pl-8">
          <SectionLabel>อื่น ๆ</SectionLabel>
          <div className="grid grid-cols-3 gap-x-2 gap-y-7 sm:grid-cols-4 sm:gap-x-4">
            {secondary.map((tile) => (
              <AppIcon key={tile.code} tile={tile} size="md" />
            ))}
          </div>
        </section>
      </div>

      {visible.size === 0 && (
        <p className="mt-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีโมดูลที่เปิดใช้งาน — ติดต่อผู้ดูแลระบบเพื่อเปิดใช้
        </p>
      )}
    </div>
  );
}

/** หัวข้อเล็ก ๆ ของแต่ละฝั่ง */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-5 text-center text-xs font-medium tracking-wide text-(--ink-soft) md:text-left">
      {children}
    </h2>
  );
}

/** ไอคอนแอปหนึ่งช่อง — กดได้เมื่อบริษัทเปิดใช้และผู้ใช้มีสิทธิ์ */
function AppIcon({ tile, size = "md" }: { tile: AppTile; size?: "md" | "lg" }) {
  const { href, icon: Icon } = tile;

  // โมดูลหลักไอคอนใหญ่กว่า เพื่อให้แยกออกจากฝั่งขวาแม้อยู่จอเดียวกัน
  const box =
    size === "lg"
      ? "h-[80px] w-[80px] rounded-[26px] sm:h-[92px] sm:w-[92px]"
      : "h-[68px] w-[68px] rounded-[22px] sm:h-[76px] sm:w-[76px]";
  const glyph = size === "lg" ? "h-9 w-9 sm:h-11 sm:w-11" : "h-8 w-8 sm:h-9 sm:w-9";

  const body = (
    <>
      <span
        className={
          href
            ? `relative flex ${box} items-center justify-center shadow-(--shadow-card) ring-1 ring-black/[0.04] transition-transform duration-150 group-hover:-translate-y-0.5 group-active:scale-95`
            : `relative flex ${box} items-center justify-center bg-(--bg) ring-1 ring-(--line)`
        }
        style={href ? { backgroundColor: tile.colorBg } : undefined}
      >
        <Icon
          className={glyph}
          style={{
            color: href ? tile.color : "var(--ink-soft)",
            opacity: href ? 1 : 0.4,
          }}
        />
        {href && tile.code === "report_task" && <AppTileReviewBadge />}
        {/* "อยากให้เห็นว่าตรงไหนมีแจ้งเตือนอะไรบ้าง...ทำให้หมดกับทุก module"
            — report_task's own badge above มีตรรกะพิเศษของตัวเอง (สแกน
            tasks/posts ตรงๆ ไม่ใช่แค่นับแจ้งเตือน) สองอันนี้ใช้ตัวนับแจ้งเตือน
            ทั่วไปแทน เพราะแจ้งซ่อมบำรุง/HR ไม่มี array งานให้สแกนแบบนั้น */}
        {href && tile.code === "maintenance" && <NotifCountBadge categories={["work_order", "pm", "expense", "purchase_order"]} />}
        {href && tile.code === "hr" && <NotifCountBadge categories={["hr_leave", "hr_attendance"]} />}
        {href && (tile.code === "admin_issue_report" || tile.code === "issue_report_self") && <NotifCountBadge categories={["ticket"]} />}
      </span>

      <span
        className={
          href
            ? "mt-2 line-clamp-2 text-center text-[13px] font-medium text-(--ink)"
            : "mt-2 line-clamp-2 text-center text-[13px] text-(--ink-soft)"
        }
      >
        {tile.name}
      </span>

      {!href && (
        <span className="mt-0.5 text-[11px] text-(--ink-soft)">
          เร็ว ๆ นี้
        </span>
      )}
    </>
  );

  if (!href) {
    return (
      <div
        className="flex cursor-default flex-col items-center"
        aria-disabled
        title={`${tile.name} — ยังไม่เปิดใช้งาน`}
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      title={tile.description}
      // VM 2 core → Prisma pool ~5 connection (คำนวณจาก cores*2+1) — prefetch
      // ค่าเริ่มต้นของ Next.js ยิงทุก tile ที่มองเห็นพร้อมกันตอนหน้านี้โหลด
      // (10 โมดูล) แต่ละหน้าเป็น dynamic route ต้อง query จริง ชน pool จนคลิก
      // จริงต้องรอคิว (เจอเป็นอาการ "กดเมนูรวมแล้วค้าง ต้องพิมพ์ path เอง")
      prefetch={false}
      className="group flex flex-col items-center rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/40"
    >
      {body}
    </Link>
  );
}
