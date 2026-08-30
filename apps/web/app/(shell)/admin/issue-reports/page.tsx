import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Mail, Search } from "lucide-react";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { EmptyState, Pill, StatCard, inputClass, selectClass } from "@/modules/admin/components/ui";
import { listAllIssueTickets, type CrossOrgIssueTicket } from "@/modules/admin/data/issue-tickets";
import { listAllOrganizations } from "@/modules/admin/data/orgs";
import {
  issueCategoryMeta,
  issuePriorityMeta,
  issueStatusMeta,
  reporterStatusGroup,
  reporterStatusGroupMeta,
} from "@/modules/report_task/lib/issue-meta";
import { ALL_ISSUE_CATEGORIES, CLOSED_STATUSES, type IssueCategory, type IssuePriority, type IssueStatus } from "@/modules/report_task/types/issue";
import { TimeAgo } from "@/modules/report_task/components/shared/time-ago";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * ตั๋วแจ้งปัญหาจากทุกบริษัทในแพลตฟอร์ม รวมไว้ที่เดียว — SUPER_ADMIN เท่านั้น
 *
 * เดิมหน้านี้เป็น "ดูอย่างเดียว" — ตอบ/รับเรื่อง/ปิดงานยังต้องเข้าไปทำใน
 * บัญชีของบริษัทนั้นเอง วันนี้เปลี่ยนแล้ว: ระบบ agent ระดับบริษัทถูกถอดออก
 * ทั้งหมด (ดู report_task/lib/permissions.ts) พนักงานทุกบริษัทแจ้งปัญหามาที่
 * ทีม Smartboss โดยตรง หน้านี้จึงต้องรับเรื่อง-ตอบ-ปิดงานได้จริงจากที่นี่
 * ที่เดียว ไม่ใช่แค่เห็นเฉยๆ (ดู issue-ticket-actions.ts และหน้ารายละเอียด
 * ที่ /admin/issue-reports/[orgId]/[id])
 */
export const dynamic = "force-dynamic";

const TABS = ["all", "unclaimed", "needs_reply", "with_vendor", "closed"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  all: "ทั้งหมด",
  unclaimed: "ยังไม่มีคนรับ",
  needs_reply: "รอเราตอบ",
  with_vendor: "ส่งผู้พัฒนา",
  closed: "ปิดแล้ว",
};

function needsAgentResponse(t: CrossOrgIssueTicket): boolean {
  if (CLOSED_STATUSES.includes(t.status)) return false;
  if (t.status === "new") return true;
  const lastAll = [...t.messages].reverse().find((m) => m.audience === "all");
  return lastAll?.authorId === t.reporterId;
}

interface SearchParams {
  tab?: string;
  orgId?: string;
  status?: string;
  category?: string;
  priority?: string;
  from?: string;
  to?: string;
  q?: string;
}

export default async function AllIssueReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");

  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "all";

  const [allTickets, organizations] = await Promise.all([listAllIssueTickets(), listAllOrganizations()]);

  const byTab = allTickets.filter((t) => {
    switch (tab) {
      case "unclaimed":
        return t.status === "new";
      case "needs_reply":
        return needsAgentResponse(t);
      case "with_vendor":
        return ["escalated", "vendor_working", "vendor_released"].includes(t.status);
      case "closed":
        return CLOSED_STATUSES.includes(t.status);
      default:
        return true;
    }
  });

  const q = sp.q?.trim().toLowerCase();
  const fromMs = sp.from ? new Date(sp.from).getTime() : null;
  const toMs = sp.to ? new Date(`${sp.to}T23:59:59`).getTime() : null;
  const tickets = byTab.filter((t) => {
    if (sp.orgId && t.orgId !== sp.orgId) return false;
    if (sp.status && t.status !== sp.status) return false;
    if (sp.category && t.category !== sp.category) return false;
    if (sp.priority && t.priority !== sp.priority) return false;
    if (fromMs !== null && new Date(t.createdAt).getTime() < fromMs) return false;
    if (toMs !== null && new Date(t.createdAt).getTime() > toMs) return false;
    if (q) {
      const hay = `${t.code} ${t.title} ${t.description} ${t.reporterName} ${t.orgName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const openTickets = allTickets.filter((t) => !CLOSED_STATUSES.includes(t.status));
  const companiesReporting = new Set(allTickets.map((t) => t.orgId)).size;

  // Every active filter/search value carries forward into each tab link, so
  // switching tabs never silently drops a filter that's currently applied.
  const filterParams = Object.entries(sp).filter(([k, v]) => k !== "tab" && v);

  return (
    <AppScaffold title="แจ้งปัญหาระบบ (ทุกบริษัท)" width="max-w-6xl" backHref="/admin">
      <p className="mb-4 text-sm text-(--ink-soft)">
        ตั๋วแจ้งปัญหาจากพนักงานทุกบริษัทลูกค้า ส่งตรงมาที่นี่ — รับเรื่อง ตอบ และปิดงานได้จากหน้านี้เลย ไม่ต้องเข้าบัญชีของบริษัทนั้น
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="ตั๋วทั้งหมด" value={allTickets.length} color="#1B2537" />
        <StatCard label="ยังไม่ปิด" value={openTickets.length} color="#DC2626" />
        <StatCard label="ยังไม่มีใครรับ" value={allTickets.filter((t) => t.status === "new").length} color="#F59E0B" />
        <StatCard label="บริษัทที่เคยแจ้ง" value={companiesReporting} color="#0D9488" />
      </div>

      {/* Tabs — plain links (server-rendered, no client state) carrying every
          other active filter forward via hidden-equivalent query params. */}
      <div className="mb-3 flex flex-wrap gap-1.5 overflow-x-auto">
        {TABS.map((key) => {
          const params = new URLSearchParams(filterParams as [string, string][]);
          if (key !== "all") params.set("tab", key);
          const href = params.size > 0 ? `?${params.toString()}` : "?";
          return (
            <Link
              key={key}
              href={href}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                tab === key
                  ? "bg-(--ink) text-white border-(--ink)"
                  : "bg-(--bg) text-(--ink-soft) border-(--line) hover:bg-(--bg-soft)"
              )}
            >
              {TAB_LABEL[key]}
            </Link>
          );
        })}
      </div>

      {/* Comprehensive filters — company/status/category/priority/date range
          + free-text search, all one GET form (same pattern admin/users'
          own company filter already uses) — asked for explicitly
          ("ทำพวก filter ให้ครอบคลุมด้วยหน้าจัดการ...หาได้ง่าย"). */}
      <Card className="mb-4 p-4">
        <form method="GET" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">ค้นหา</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ink-soft)" />
              <input name="q" defaultValue={sp.q ?? ""} placeholder="เลขตั๋ว, หัวข้อ, ผู้แจ้ง, บริษัท…" className={cn(inputClass, "pl-8")} />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">บริษัท</span>
            <select name="orgId" defaultValue={sp.orgId ?? ""} className={selectClass}>
              <option value="">ทุกบริษัท</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">สถานะ</span>
            <select name="status" defaultValue={sp.status ?? ""} className={selectClass}>
              <option value="">ทุกสถานะ</option>
              {(Object.keys(issueStatusMeta) as IssueStatus[]).map((s) => (
                <option key={s} value={s}>{issueStatusMeta[s].label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">ประเภท</span>
            <select name="category" defaultValue={sp.category ?? ""} className={selectClass}>
              <option value="">ทุกประเภท</option>
              {ALL_ISSUE_CATEGORIES.map((c: IssueCategory) => (
                <option key={c} value={c}>{issueCategoryMeta[c].label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">ความสำคัญ</span>
            <select name="priority" defaultValue={sp.priority ?? ""} className={selectClass}>
              <option value="">ทุกระดับ</option>
              {(Object.keys(issuePriorityMeta) as IssuePriority[]).map((p) => (
                <option key={p} value={p}>{issuePriorityMeta[p].label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">ตั้งแต่วันที่</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">ถึงวันที่</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} className={inputClass} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" className="w-full sm:w-auto">กรอง</Button>
            {(sp.q || sp.orgId || sp.status || sp.category || sp.priority || sp.from || sp.to) && (
              <Link
                href={tab !== "all" ? `?tab=${tab}` : "?"}
                className="inline-flex h-10 items-center rounded-(--radius) border border-(--line) px-3 text-sm text-(--ink-soft) hover:bg-(--bg-soft)"
              >
                ล้าง
              </Link>
            )}
          </div>
        </form>
      </Card>

      <p className="mb-3 text-xs text-(--ink-soft)">พบ {tickets.length} ตั๋วจาก {allTickets.length} ตั๋วทั้งหมด</p>

      {tickets.length === 0 ? (
        <EmptyState>ไม่พบตั๋วตรงกับตัวกรองนี้</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {tickets.map((t) => (
            <TicketRow key={`${t.orgId}-${t.id}`} ticket={t} />
          ))}
        </div>
      )}
    </AppScaffold>
  );
}

function TicketRow({ ticket }: { ticket: CrossOrgIssueTicket }) {
  const category = issueCategoryMeta[ticket.category];
  const priority = issuePriorityMeta[ticket.priority];
  const group = reporterStatusGroupMeta[reporterStatusGroup(ticket.status)];
  const CategoryIcon = category.icon;

  return (
    <Link href={`/admin/issue-reports/${ticket.orgId}/${ticket.id}`}>
      <Card className="p-4 transition-colors hover:bg-(--bg-soft)">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--bg-soft) sm:flex">
            <CategoryIcon className="h-4 w-4 text-(--ink-soft)" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill color="#0D9488">
                <Building2 className="h-3 w-3" /> {ticket.orgName}
              </Pill>
              <span className="font-mono text-[11px] text-(--ink-soft)">{ticket.code}</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${group.className}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${group.dot}`} /> {group.label}
              </span>
              <span className="text-[11px] font-medium" style={{ color: priority.colorVar }}>{priority.label}</span>
            </div>

            <p className="mt-1.5 text-sm font-semibold text-(--ink)">{ticket.title}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-(--ink-soft)">{ticket.description}</p>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-(--ink-soft)">
              <span>
                แจ้งโดย <span className="font-medium text-(--ink)">{ticket.reporterName}</span>
                {ticket.reporterRole && ` · ${ticket.reporterRole}`}
              </span>
              {ticket.reporterEmail && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" /> {ticket.reporterEmail}
                </span>
              )}
              <span><TimeAgo date={ticket.createdAt} /></span>
              <span className="sm:hidden">{category.label}</span>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
