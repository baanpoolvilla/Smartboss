import { redirect } from "next/navigation";
import { requireOrg, hasPermission, AUDIT_ACTION_LABELS } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { listAuditLogs } from "@/modules/admin/data/org";
import { EmptyState, Pill } from "@/modules/admin/components/ui";

/** สีตามความสำคัญของเหตุการณ์ — เรื่องความปลอดภัยให้เด่นกว่าเรื่องทั่วไป */
function actionColor(action: string): string {
  if (action.includes("FAILED") || action.includes("LOCKED") || action.includes("REUSE"))
    return "#DC2626";
  if (action.includes("DELETED")) return "#EA580C";
  if (action.includes("CREATED")) return "#16A34A";
  if (action.includes("PERMISSION") || action.includes("ROLE")) return "#8B5CF6";
  return "#3B82F6";
}

export default async function AdminAuditPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.auditView)) redirect("/admin");

  const logs = await listAuditLogs(session.orgId, 200);

  return (
    <AppScaffold title="ประวัติการใช้งาน" width="max-w-3xl">
      <p className="mb-3 text-sm text-(--ink-soft)">
        แสดง {logs.length} รายการล่าสุดของผู้ใช้ในบริษัท
      </p>

      {logs.length === 0 ? (
        <EmptyState>ยังไม่มีประวัติการใช้งาน</EmptyState>
      ) : (
        <div className="flex flex-col gap-1.5">
          {logs.map((l) => (
            <Card key={l.id} className="flex items-center gap-3 p-3">
              <Pill color={actionColor(l.action)}>
                {AUDIT_ACTION_LABELS[l.action] ?? l.action}
              </Pill>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-(--ink)">{l.userName}</p>
                {l.ip && (
                  <p className="truncate font-mono text-[11px] text-(--ink-soft)">
                    {l.ip}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-(--ink-soft)">
                {new Intl.DateTimeFormat("th-TH", {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(l.createdAt)}
              </span>
            </Card>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
