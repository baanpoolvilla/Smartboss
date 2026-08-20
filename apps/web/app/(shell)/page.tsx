import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { MODULE_CARDS } from "@/lib/modules";
import { iconByName } from "@/lib/icons";
import { loadShellNav } from "@/lib/nav";
import { AppTileReviewBadge } from "@/modules/report_task/components/shared/app-tile-review-badge";

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

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8 text-center sm:mb-10">
        <h1 className="text-2xl font-semibold text-(--ink)">
          สวัสดี, {firstName}
        </h1>
        <p className="mt-1 text-sm text-(--ink-soft)">{thaiToday()}</p>
      </header>

      <div className="grid grid-cols-3 gap-x-2 gap-y-7 sm:grid-cols-4 sm:gap-x-4 md:grid-cols-5">
        {tiles.map((tile) => (
          <AppIcon key={tile.code} tile={tile} />
        ))}
      </div>

      {visible.size === 0 && (
        <p className="mt-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีโมดูลที่เปิดใช้งาน — ติดต่อผู้ดูแลระบบเพื่อเปิดใช้
        </p>
      )}
    </div>
  );
}

/** ไอคอนแอปหนึ่งช่อง — กดได้เมื่อบริษัทเปิดใช้และผู้ใช้มีสิทธิ์ */
function AppIcon({ tile }: { tile: AppTile }) {
  const { href, icon: Icon } = tile;

  const body = (
    <>
      <span
        className={
          href
            ? "relative flex h-[68px] w-[68px] items-center justify-center rounded-[22px] shadow-(--shadow-card) ring-1 ring-black/[0.04] transition-transform duration-150 group-hover:-translate-y-0.5 group-active:scale-95 sm:h-[76px] sm:w-[76px]"
            : "relative flex h-[68px] w-[68px] items-center justify-center rounded-[22px] bg-(--bg) ring-1 ring-(--line) sm:h-[76px] sm:w-[76px]"
        }
        style={href ? { backgroundColor: tile.colorBg } : undefined}
      >
        <Icon
          className="h-8 w-8 sm:h-9 sm:w-9"
          style={{
            color: href ? tile.color : "var(--ink-soft)",
            opacity: href ? 1 : 0.4,
          }}
        />
        {href && tile.code === "report_task" && <AppTileReviewBadge />}
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
      className="group flex flex-col items-center rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/40"
    >
      {body}
    </Link>
  );
}
