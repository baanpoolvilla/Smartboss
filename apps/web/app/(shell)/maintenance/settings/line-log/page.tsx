import { redirect } from "next/navigation";
import { Info, MessageSquare, Check, X } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listLineLogs } from "@/modules/maintenance/data/notify";
import { userNameMap } from "@/modules/maintenance/data/users";
import { fmtThaiDateTime } from "@/modules/maintenance/lib/format";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

/** Log LINE — port จาก line_log_screen.dart */
export default async function LineLogPage() {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.admin)) redirect("/");
  const logs = await listLineLogs(session.orgId);
  const names = await userNameMap(
    session.orgId,
    logs.map((l) => l.userId)
  );

  return (
    <AppScaffold
      title="Log การส่ง LINE"
      width="max-w-3xl"
      backHref="/maintenance/settings"
    >

      <p className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-(--ink-soft)">
        <Info className="h-4 w-4" /> แสดง {logs.length} รายการล่าสุด
      </p>

      {logs.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีบันทึกการส่ง LINE
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {logs.map((l) => {
            const recipient =
              (l.userId && names[l.userId]) || l.lineUserId || "-";
            return (
              <Card key={l.id} className="flex items-start gap-3 p-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: l.success ? "#EFF6FF" : "#FEF2F2" }}
                >
                  <MessageSquare
                    className="h-5 w-5"
                    style={{ color: l.success ? "#2563EB" : "#DC2626" }}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-(--ink)">
                    {recipient}
                  </p>
                  <p className="line-clamp-2 text-[13px] text-(--ink-soft)">
                    {l.message.replace(/\n/g, " ")}
                  </p>
                  <p className="text-xs text-(--ink-soft)">
                    {fmtThaiDateTime(l.createdAt)}
                    {l.error ? ` · ${l.error}` : ""}
                  </p>
                </div>
                <span className="mt-0.5 shrink-0">
                  {l.success ? (
                    <Check className="h-4 w-4 text-[#16A34A]" />
                  ) : (
                    <X className="h-4 w-4 text-[#DC2626]" />
                  )}
                </span>
              </Card>
            );
          })}
        </div>
      )}
    </AppScaffold>
  );
}
