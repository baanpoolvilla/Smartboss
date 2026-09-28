import { ExternalLink, Globe } from "lucide-react";
import { requireAuth } from "@smartboss/auth";
import { AppScaffold } from "@/components/module/app-scaffold";
import { SALES_MARKETING_APPS } from "@/lib/external-apps";

/**
 * Sale & Marketing — รวมลิงก์เว็บภายนอกของทีมขาย/การตลาด (ดู lib/external-apps.ts)
 * กดแล้วเปิดเว็บนั้นในแท็บใหม่ SmartBoss ยังเปิดค้างไว้ให้กลับมาได้
 */
export default async function SalesMarketingPage() {
  await requireAuth();

  return (
    <AppScaffold title="Sale & Marketing" backHref="/" width="max-w-3xl">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-(--ink-soft)">กดเพื่อเปิดเว็บในแท็บใหม่</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SALES_MARKETING_APPS.map((app) => (
            <li key={app.url}>
              <a
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl border border-(--line) bg-(--bg) p-4 transition-colors hover:border-(--mod-sale) focus-visible:ring-2 focus-visible:ring-(--brand-green)/40 outline-hidden"
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
                  style={{ backgroundColor: "var(--mod-sale-bg)" }}
                >
                  <Globe className="h-5 w-5" style={{ color: "var(--mod-sale)" }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-(--ink)">{app.name}</span>
                  <span className="block truncate text-xs text-(--ink-soft)">{app.description}</span>
                  <span className="block truncate text-[11px] text-(--ink-soft)">{new URL(app.url).host}</span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-(--ink-soft) group-hover:text-(--mod-sale)" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </AppScaffold>
  );
}
