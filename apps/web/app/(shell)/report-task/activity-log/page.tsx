"use client";

import { useMemo, useState } from "react";
import { Search, ScrollText, X } from "lucide-react";
import { Input } from "@/modules/report_task/components/ui/input";
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
import { PageHeader } from "@/modules/report_task/components/shared/page-header";
import { ManagerOnlyGate } from "@/modules/report_task/components/shared/manager-only-gate";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { getUser, users } from "@/modules/report_task/data/mock";
import { relativeTime, formatDateTime } from "@/modules/report_task/lib/format";
import { SYSTEM_USER_ID } from "@/modules/report_task/store/task-store";

export default function ActivityLogPage() {
  const entries = useActivityLogStore((s) => s.entries);
  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState<string>("all");
  const [action, setAction] = useState<string>("all");

  // Only actions that have actually happened, not every possible one — an
  // empty log shouldn't show a dropdown full of options that filter to nothing.
  const actionOptions = useMemo(() => Array.from(new Set(entries.map((e) => e.action))), [entries]);
  const actorOptions = useMemo(() => {
    const ids = new Set(entries.map((e) => e.userId));
    return users.filter((u) => ids.has(u.id));
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (userId !== "all" && e.userId !== userId) return false;
      if (action !== "all" && e.action !== action) return false;
      if (q) {
        const hay = `${e.action} ${e.target} ${e.detail ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, userId, action]);

  const hasFilters = search.trim() !== "" || userId !== "all" || action !== "all";

  // Collapse a burst of adjacent entries that are the same person acting on
  // the same target in quick succession (e.g. toggling "mark done" on/off
  // several times in a minute — action alternates each time, so matching on
  // action too would never catch this) into one row with a "×N" count —
  // otherwise the flurry buries whatever else happened around it under
  // repeats of itself. Bounded to a 5-minute window so two genuinely
  // separate touches on the same task hours apart still show as their own
  // lines. `entries` is newest-first, so the first (most recent) item in
  // each run is the one actually shown.
  const COLLAPSE_WINDOW_MS = 5 * 60 * 1000;
  const collapsed = useMemo(() => {
    const groups: { entry: (typeof filtered)[number]; count: number }[] = [];
    for (const e of filtered) {
      const last = groups[groups.length - 1];
      const withinWindow =
        last && Math.abs(new Date(last.entry.createdAt).getTime() - new Date(e.createdAt).getTime()) <= COLLAPSE_WINDOW_MS;
      if (last && withinWindow && last.entry.userId === e.userId && last.entry.target === e.target) {
        last.count += 1;
      } else {
        groups.push({ entry: e, count: 1 });
      }
    }
    return groups;
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4 lg:gap-6 pb-6">
      <PageHeader
        title="บันทึกกิจกรรม"
        subtitle="ใครทำอะไร ที่งานไหน เมื่อไหร่ — บันทึกอัตโนมัติทุกครั้งที่มีการเปลี่ยนสถานะ, แก้กำหนดส่ง, เปิดงานใหม่, หัก/ยกเลิกคะแนน, หรือติด/ลบสติกเกอร์"
      />

      <ManagerOnlyGate>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
            <Input
              data-tour="activity-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่องาน, การกระทำ, รายละเอียด..."
              className="pl-8 bg-white"
            />
          </div>
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
            <Button data-tour="activity-clear-filters" variant="ghost" size="sm" onClick={() => { setSearch(""); setUserId("all"); setAction("all"); }}>
              <X className="h-3.5 w-3.5" /> ล้างตัวกรอง
            </Button>
          )}
          <span className="text-xs text-[var(--ink-soft)] ml-auto shrink-0">{filtered.length} รายการ</span>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-white overflow-hidden mt-4">
          {filtered.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title={entries.length === 0 ? "ยังไม่มีบันทึกกิจกรรม" : "ไม่พบรายการที่ตรงกับตัวกรอง"}
              description={entries.length === 0 ? "พอมีการเปลี่ยนสถานะงาน, แก้กำหนดส่ง, หักคะแนน ฯลฯ จะบันทึกไว้ที่นี่โดยอัตโนมัติ" : undefined}
              className="border-0"
            />
          ) : (
            <div className="divide-y divide-[var(--line)] max-h-[70vh] overflow-y-auto">
              {collapsed.map(({ entry: e, count }) => {
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
                        {count > 1 && (
                          <span className="text-[var(--ink-soft)] font-normal"> ×{count}</span>
                        )}
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
      </ManagerOnlyGate>
    </div>
  );
}
