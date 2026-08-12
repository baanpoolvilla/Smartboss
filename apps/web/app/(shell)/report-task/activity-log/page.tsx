"use client";

import { useMemo, useState } from "react";
import { ScrollText, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { Button } from "@/modules/report_task/components/ui/button";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { StickyFilterBar } from "@/modules/report_task/components/shared/sticky-filter-bar";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser, users, canManage } from "@/modules/report_task/lib/directory";
import { relativeTime, formatDateTime } from "@/modules/report_task/lib/format";
import { SYSTEM_USER_ID } from "@/modules/report_task/store/task-store";
import { ShieldAlert } from "lucide-react";

export default function ActivityLogPage() {
  const entries = useActivityLogStore((s) => s.entries);
  const [userId, setUserId] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const allowed = canManage(viewingAsUserId);

  // Only actions that have actually happened, not every possible one — an
  // empty log shouldn't show a dropdown full of options that filter to nothing.
  const actionOptions = useMemo(() => Array.from(new Set(entries.map((e) => e.action))), [entries]);
  const actorOptions = useMemo(() => {
    const ids = new Set(entries.map((e) => e.userId));
    return users.filter((u) => ids.has(u.id));
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (userId !== "all" && e.userId !== userId) return false;
      if (action !== "all" && e.action !== action) return false;
      return true;
    });
  }, [entries, userId, action]);

  const hasFilters = userId !== "all" || action !== "all";

  return (
    <div className="flex flex-col gap-4 lg:gap-6 pb-6">
      <StickyFilterBar>
        {allowed && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
              <SelectTrigger className="w-full sm:w-[180px] bg-white">
                <SelectValue>{userId === "all" ? "ทุกคน" : getUser(userId)?.name ?? "ทุกคน"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกคน</SelectItem>
                {actorOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
                {entries.some((e) => e.userId === SYSTEM_USER_ID) && (
                  <SelectItem value={SYSTEM_USER_ID}>ระบบ (อัตโนมัติ)</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Select value={action} onValueChange={(v) => v && setAction(v)}>
              <SelectTrigger className="w-full sm:w-[180px] bg-white">
                <SelectValue>{action === "all" ? "ทุกการกระทำ" : action}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกการกระทำ</SelectItem>
                {actionOptions.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button data-tour="activity-clear-filters" variant="ghost" size="sm" onClick={() => { setUserId("all"); setAction("all"); }}>
                <X className="h-3.5 w-3.5" /> ล้างตัวกรอง
              </Button>
            )}
            <span className="text-xs text-[var(--ink-soft)] ml-auto shrink-0">{filtered.length} รายการ</span>
          </div>
        )}
      </StickyFilterBar>

      {!allowed ? (
        <EmptyState
          icon={ShieldAlert}
          title="หน้านี้สำหรับหัวหน้าแผนกและผู้บริหารเท่านั้น"
          description="แสดงข้อมูลผลงาน/คะแนนของทุกคนในองค์กร จำกัดสิทธิ์ให้เห็นเฉพาะระดับหัวหน้าขึ้นไป"
        />
      ) : (
        <div className="rounded-xl border border-[var(--line)] bg-white overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title={entries.length === 0 ? "ยังไม่มีบันทึกกิจกรรม" : "ไม่พบรายการที่ตรงกับตัวกรอง"}
              description={entries.length === 0 ? "พอมีการเปลี่ยนสถานะงาน, แก้กำหนดส่ง, หักคะแนน ฯลฯ จะบันทึกไว้ที่นี่โดยอัตโนมัติ" : undefined}
              className="border-0"
            />
          ) : (
            <div className="divide-y divide-[var(--line)] max-h-[70vh] overflow-y-auto">
              {filtered.map((e) => {
                const isSystem = e.userId === SYSTEM_USER_ID;
                const user = isSystem ? null : getUser(e.userId);
                return (
                  <div key={e.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-soft)] transition-colors">
                    <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                      <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                        {isSystem ? "SYS" : user?.avatar ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{isSystem ? "ระบบ (อัตโนมัติ)" : user?.name ?? "ไม่ทราบ"}</span>{" "}
                        <span className="text-[var(--ink-soft)]">{e.action}</span>{" "}
                        <span className="font-medium">{e.target}</span>
                      </p>
                      {e.detail && <p className="text-xs text-[var(--ink-soft)] mt-0.5 truncate">{e.detail}</p>}
                    </div>
                    <span className="text-xs text-[var(--ink-soft)] shrink-0 text-right" title={formatDateTime(e.createdAt)}>
                      {relativeTime(e.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
