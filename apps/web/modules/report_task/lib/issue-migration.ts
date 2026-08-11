import type { IssueTicket, IssueMessage } from "@/modules/report_task/types/issue";
import { defaultPriorityFor, nextTicketCode } from "@/modules/report_task/lib/issue-meta";

/** Shape `data/stores/issue-reports.json` had before this migration existed —
 * see ISSUE_REPORT_SYSTEM_SPEC.md §8.4's mapping table. Kept local to this
 * file (not re-exported) since nothing else should ever construct this shape
 * again. */
interface V1IssueReport {
  id: string;
  reporterId: string;
  category: "bug" | "ui" | "other";
  title: string;
  description: string;
  pageUrl: string;
  createdAt: string;
  status: "new" | "in_progress" | "resolved";
  comments: { id: string; authorId: string; body: string; createdAt: string }[];
  notifiedSales: boolean;
  notifiedSalesAt: string | null;
  notifiedSalesBy: string | null;
}

export const ISSUE_STORE_SCHEMA_VERSION = 2;

export interface IssueStoreSlice {
  schemaVersion: number;
  tickets: IssueTicket[];
}

/** True for a payload that predates `schemaVersion` — the only version that
 * ever shipped without it was V1 (`reports` + top-level `recipientDepartmentIds`). */
function isV1Shape(raw: unknown): raw is { reports: V1IssueReport[]; recipientDepartmentIds?: string[] } {
  return !!raw && typeof raw === "object" && "reports" in raw && Array.isArray((raw as { reports: unknown }).reports);
}

function migrateV1Report(v1: V1IssueReport, index: number): IssueTicket {
  const messages: IssueMessage[] = [];
  if (v1.description) {
    messages.push({
      id: `${v1.id}-msg-0`,
      kind: "message",
      authorId: v1.reporterId,
      audience: "all",
      body: v1.description,
      attachments: [],
      createdAt: v1.createdAt,
      editedAt: null,
      readBy: [v1.reporterId],
    });
  }
  for (const c of v1.comments) {
    messages.push({
      id: c.id,
      kind: "message",
      authorId: c.authorId,
      audience: "all",
      body: c.body,
      attachments: [],
      createdAt: c.createdAt,
      editedAt: null,
      readBy: [c.authorId],
    });
  }
  if (v1.notifiedSales) {
    messages.push({
      id: `${v1.id}-escalated`,
      kind: "event",
      authorId: v1.notifiedSalesBy ?? v1.reporterId,
      audience: "all",
      body: "ส่งต่อให้ผู้พัฒนาแล้ว (ย้ายมาจากข้อมูลเดิม)",
      event: { type: "escalated" },
      attachments: [],
      createdAt: v1.notifiedSalesAt ?? v1.createdAt,
      editedAt: null,
      readBy: [],
    });
  }

  const impact = "workaround" as const;
  const category = v1.category;
  const status = v1.status === "resolved" ? "resolved" : v1.status === "in_progress" ? "in_progress" : "new";

  return {
    id: v1.id,
    code: nextTicketCode(index),
    reporterId: v1.reporterId,
    category,
    title: v1.title,
    description: v1.description,
    impact,
    status,
    priority: defaultPriorityFor(impact, category),
    assigneeId: null,
    vendorAssigneeId: null,
    visibility: "private",
    shareWithHead: true, // V1 never had the "access" category this defaults false for
    context: {
      pageUrl: v1.pageUrl,
      userAgent: "",
      viewport: "",
      appVersion: "migrated-from-v1",
      occurredAt: v1.createdAt,
    },
    attachments: [],
    messages,
    duplicateOfId: null,
    rejectReason: null,
    tags: [],
    whatWasChecked: v1.notifiedSales ? "ย้ายมาจากข้อมูลเดิม (ไม่มีรายละเอียดการตรวจสอบ)" : null,
    createdAt: v1.createdAt,
    firstResponseAt: v1.comments[0]?.createdAt ?? null,
    escalatedAt: v1.notifiedSalesAt,
    escalatedBy: v1.notifiedSalesBy,
    resolvedAt: v1.status === "resolved" ? v1.createdAt : null,
    closedAt: v1.status === "resolved" ? v1.createdAt : null,
    updatedAt: v1.comments.at(-1)?.createdAt ?? v1.createdAt,
    reopenCount: 0,
    satisfaction: null,
  };
}

/**
 * Runs once per `apply` call in ServerStoreSync (see issue-report-store.ts) —
 * cheap no-op for anything already on the current schema (checks
 * `schemaVersion` first), so this is safe to call unconditionally on every
 * load rather than needing a one-time migration flag.
 */
export function migrateIssueStoreSlice(raw: unknown): IssueStoreSlice {
  if (!raw) return { schemaVersion: ISSUE_STORE_SCHEMA_VERSION, tickets: [] };

  if (isV1Shape(raw)) {
    return {
      schemaVersion: ISSUE_STORE_SCHEMA_VERSION,
      tickets: raw.reports.map((r, i) => migrateV1Report(r, i)),
    };
  }

  const slice = raw as Partial<IssueStoreSlice>;
  return {
    schemaVersion: ISSUE_STORE_SCHEMA_VERSION,
    tickets: Array.isArray(slice.tickets) ? slice.tickets : [],
  };
}

/** V1 stored `recipientDepartmentIds` inline on the same JSON blob as the
 * tickets — pulled out separately so the caller can seed the now-separate
 * issue-desk-config store with it once, instead of losing the setting. */
export function extractV1RecipientDepartmentIds(raw: unknown): string[] | null {
  if (isV1Shape(raw) && Array.isArray(raw.recipientDepartmentIds)) return raw.recipientDepartmentIds;
  return null;
}
