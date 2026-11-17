import Link from "next/link";
import { cn } from "@smartboss/ui/cn";
import { requireAdsPage } from "@/modules/ads/data/access";
import { lastSyncedAt } from "@/modules/ads/data/accounts";
import { proposalViewer } from "@/modules/ads/data/proposal-view";
import { expireStale, listProposalIds, proposalCounts } from "@/modules/ads/data/proposals";
import { ADS_PERMS } from "@/modules/ads/permissions";
import type { ProposalView } from "@/modules/ads/lib/proposal-types";
import { AdsPage } from "@/modules/ads/components/page-shell";
import { ProposalGrid } from "@/modules/ads/components/agent-panels";
import { Section } from "@/modules/ads/components/ui";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "ค้างอยู่" },
  { key: "done", label: "จบแล้ว" },
  { key: "all", label: "ทั้งหมด" },
] as const;

/** คำขอปรับ Google Ads ทั้งหมด — ที่เดียวกับการ์ดในแชท กดอนุมัติ/ปฏิเสธได้จากตรงนี้ */
export default async function AdsProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAdsPage(ADS_PERMS.access);
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "open";
  await expireStale(session.orgId);
  const [ids, counts, synced] = await Promise.all([
    listProposalIds(session.orgId, { status: tab, take: 60 }),
    proposalCounts(session.orgId),
    lastSyncedAt(session.orgId),
  ]);
  const view = await proposalViewer(session.orgId, ids);
  const proposals = ids.map((id) => view(id, session.userId)).filter((p): p is ProposalView => !!p);
  const openCount = (counts.pending ?? 0) + (counts.approved ?? 0) + (counts.executing ?? 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <AdsPage title="คำขอปรับ Google Ads" lastSynced={synced}>
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/ads/proposals?tab=${t.key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              tab === t.key ? "border-[#1A73E8] bg-[#E8F0FE] font-semibold text-[#1A73E8]" : "border-(--line) text-(--ink)"
            )}
          >
            {t.label} <span className="tabular-nums text-(--ink-soft)">{t.key === "open" ? openCount : t.key === "done" ? total - openCount : total}</span>
          </Link>
        ))}
      </div>
      <Section title={TABS.find((t) => t.key === tab)!.label} description="60 รายการล่าสุด · การ์ดเปลี่ยนสถานะเองเมื่อ n8n ปรับเสร็จ (รีเฟรชหน้าเพื่อดู)">
        <ProposalGrid proposals={proposals} empty={tab === "open" ? "ไม่มีคำขอที่ค้างอยู่" : "ยังไม่มีคำขอ"} />
      </Section>
    </AdsPage>
  );
}
