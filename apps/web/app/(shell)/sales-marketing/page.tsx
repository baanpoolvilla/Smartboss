import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { requireAuth } from "@smartboss/auth";
import { SALES_MARKETING_APPS } from "@/lib/external-apps";

/**
 * Sale & Marketing — รวมลิงก์เว็บภายนอกของทีมขาย/การตลาด (ดู lib/external-apps.ts)
 * กดแล้วเปิดเว็บนั้นในแท็บใหม่ SmartBoss ยังเปิดค้างไว้ให้กลับมาได้
 *
 * ไม่ใช้ AppScaffold: หน้านี้ไม่ใช่โมดูล shell วาดแถบบนให้อยู่แล้ว ใส่ AppBar
 * ของ scaffold ซ้อนเข้าไปอีกจะได้แถบบนสองชั้น — วางแบบเดียวกับหน้าโฮมแทน
 */
export default async function SalesMarketingPage() {
  await requireAuth();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-(--ink-soft) transition-colors hover:bg-(--bg) hover:text-(--ink)"
      >
        <ArrowLeft className="h-4 w-4" />
        หน้าหลัก
      </Link>

      <header className="mt-4 mb-8 text-center sm:mb-10">
        <h1 className="text-2xl font-semibold text-(--ink)">ขาย &amp; การตลาด</h1>
        <p className="mt-1 text-sm text-(--ink-soft)">รวมเว็บของทีมขายและการตลาด · กดเพื่อเปิดในแท็บใหม่</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {SALES_MARKETING_APPS.map((app) => {
          const Icon = app.icon;
          return (
            <li key={app.url}>
              <a
                href={app.sso ? `/sales-marketing/open/${app.sso.key}` : app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 rounded-2xl bg-(--bg) p-5 shadow-(--shadow-card) ring-1 ring-black/[0.04] outline-hidden transition-all duration-150 hover:-translate-y-0.5 hover:ring-black/[0.08] focus-visible:ring-2 focus-visible:ring-(--brand-green)/40 active:scale-[0.99]"
              >
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px]"
                  style={{ backgroundColor: app.colorBg }}
                >
                  <Icon className="h-7 w-7" style={{ color: app.color }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-(--ink)">{app.name}</span>
                  <span className="mt-0.5 block truncate text-sm text-(--ink-soft)">{app.description}</span>
                  <span className="mt-1 block truncate text-xs text-(--ink-soft) opacity-70">{new URL(app.url).host}</span>
                </span>
                <ArrowUpRight className="h-5 w-5 shrink-0 text-(--ink-soft) transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-(--ink)" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
