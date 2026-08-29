import { redirect } from "next/navigation";
import { Building2, Mail } from "lucide-react";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { AppScaffold } from "@/components/module/app-scaffold";
import { EmptyState, Pill, StatCard } from "@/modules/admin/components/ui";
import { listAllIssueTickets, type CrossOrgIssueTicket } from "@/modules/admin/data/issue-tickets";
import { issueCategoryMeta, issuePriorityMeta, reporterStatusGroup, reporterStatusGroupMeta } from "@/modules/report_task/lib/issue-meta";
import { TimeAgo } from "@/modules/report_task/components/shared/time-ago";

/**
 * ตั๋วแจ้งปัญหาจากทุกบริษัทในแพลตฟอร์ม รวมไว้ที่เดียว — SUPER_ADMIN เท่านั้น
 *
 * เหตุผลที่หน้านี้มีอยู่: ปกติคนแจ้งปัญหาในแต่ละบริษัทจะไปถึงแค่ Agent ของ
 * บริษัทตัวเอง (ดู issue-desk-config ต่อบริษัท) — ทีม SmartBoss เอง (ฝ่ายขาย/
 * แอดมินแพลตฟอร์ม) ไม่เคยเห็นเรื่องที่แจ้งมาจากบริษัทลูกค้าเลยถ้าไม่ได้เข้าไป
 * เปิดของแต่ละบริษัทเองทีละเจ้า หน้านี้รวมทุกบริษัทมาไว้ที่เดียวแทน
 *
 * ยังเป็นมุมมอง "ดูอย่างเดียว" — ตอบ/เปลี่ยนสถานะ/มอบหมายยังต้องทำจากบัญชี
 * ของบริษัทนั้นเอง (หน้า /report-task/issue-reports/[id] อ่านจาก store ของ
 * org ที่ session ผูกอยู่เท่านั้น ข้ามบริษัทไม่ได้) — เก็บไว้เป็นขั้นต่อไปถ้าต้องการ
 * ตอบกลับข้ามบริษัทจากหน้านี้โดยตรง
 */
export const dynamic = "force-dynamic";

export default async function AllIssueReportsPage() {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");

  const tickets = await listAllIssueTickets();
  const openTickets = tickets.filter((t) => !["resolved", "rejected", "duplicate"].includes(t.status));
  const companiesReporting = new Set(tickets.map((t) => t.orgId)).size;

  return (
    <AppScaffold title="แจ้งปัญหาระบบ (ทุกบริษัท)" width="max-w-5xl" backHref="/admin">
      <p className="mb-4 text-sm text-(--ink-soft)">
        ตั๋วแจ้งปัญหาจากพนักงานทุกบริษัทลูกค้า ส่งตรงมาที่นี่ — ไม่ต้องเปิดของแต่ละบริษัทเอง
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="ตั๋วทั้งหมด" value={tickets.length} color="#1B2537" />
        <StatCard label="ยังไม่ปิด" value={openTickets.length} color="#DC2626" />
        <StatCard label="ยังไม่มีใครรับ" value={tickets.filter((t) => t.status === "new").length} color="#F59E0B" />
        <StatCard label="บริษัทที่เคยแจ้ง" value={companiesReporting} color="#0D9488" />
      </div>

      {tickets.length === 0 ? (
        <EmptyState>ยังไม่มีบริษัทไหนแจ้งปัญหาเข้ามา</EmptyState>
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
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--bg-soft)">
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
            <span className="text-[11px] font-medium" style={{ color: priority.colorVar }}>
              {priority.label}
            </span>
          </div>

          <p className="mt-1.5 text-sm font-semibold text-(--ink)">{ticket.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-(--ink-soft)">{ticket.description}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-(--ink-soft)">
            <span>
              แจ้งโดย <span className="font-medium text-(--ink)">{ticket.reporterName}</span>
            </span>
            {ticket.reporterEmail && (
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3" /> {ticket.reporterEmail}
              </span>
            )}
            <span>
              <TimeAgo date={ticket.createdAt} />
            </span>
            <span>{category.label}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
