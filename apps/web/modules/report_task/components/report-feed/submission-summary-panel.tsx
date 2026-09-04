"use client";

import { useMemo, useState } from "react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Button } from "@/modules/report_task/components/ui/button";
import { cn } from "@/modules/report_task/lib/utils";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canManage } from "@/modules/report_task/lib/directory";
import { todayStatusEntries, buildUserComplianceReports } from "@/modules/report_task/lib/report-feed-compliance";
import { Bell, CircleCheck, Clock, CircleX } from "lucide-react";

/**
 * ภาพรวมการส่งรายงาน (จอสรุป) — วันนี้ใครส่ง/สาย/ยังไม่ส่ง + อัตราการส่งย้อนหลังรายคน.
 * อ่านจากตัวตัดสินเดียว (report-feed-compliance) ตัวเดียวกับแดชบอร์ด จึงตรงกันเสมอ.
 * "ป้ายจะหัก" เป็นแค่การแจ้งเตือน (shadow) — เฟสนี้ยังไม่ยิงคะแนนเข้า HR จริง.
 */
export function SubmissionSummaryPanel() {
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const exemptions = useReportComplianceExemptions();
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const canNudge = canManage(viewingAsUserId);

  const [days, setDays] = useState<7 | 30>(7);
  const [nudged, setNudged] = useState<Set<string>>(new Set());

  const today = useMemo(() => todayStatusEntries(topics, posts, exemptions), [topics, posts, exemptions]);
  const counts = useMemo(() => {
    let posted = 0, late = 0, missing = 0;
    for (const e of today) {
      if (e.status === "posted") posted += 1;
      else if (e.status === "late") late += 1;
      else missing += 1;
    }
    return { posted, late, missing, total: today.length };
  }, [today]);

  const rate = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    return buildUserComplianceReports(topics, posts, { from, to }, exemptions).filter((r) => r.trackedDays > 0);
  }, [topics, posts, exemptions, days]);

  const needAttention = today.filter((e) => e.status !== "posted");

  return (
    <div className="space-y-5">
      {/* shadow banner */}
      <div className="flex items-start gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg-soft)] p-3">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-soft)]" />
        <p className="text-xs text-[var(--ink-soft)]">
          <span className="font-semibold text-[var(--ink)]">โหมดแสดงผลอย่างเดียว</span> — สาย/ไม่ส่ง แสดงให้เห็นเพื่อติดตาม ยังไม่หักคะแนนเข้าระบบผลงาน
          (ค่าเริ่มต้นถ้าเปิด: สาย −1 · ไม่ส่ง −2 ปรับได้ที่ตั้งค่าผลงาน)
        </p>
      </div>

      {/* today counts */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-[var(--line)] bg-white p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-[var(--tone-ok)]"><CircleCheck className="h-4 w-4" /><span className="text-xl font-bold tabular-nums">{counts.posted}</span></div>
          <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">ส่งแล้ววันนี้</p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-white p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-[var(--tone-warn)]"><Clock className="h-4 w-4" /><span className="text-xl font-bold tabular-nums">{counts.late}</span></div>
          <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">ส่งช้า</p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-white p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-[var(--danger)]"><CircleX className="h-4 w-4" /><span className="text-xl font-bold tabular-nums">{counts.missing}</span></div>
          <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">ยังไม่ส่ง</p>
        </div>
      </div>

      {/* who needs attention today */}
      {needAttention.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-[var(--ink-soft)]">ต้องตาม ({needAttention.length})</p>
          {needAttention.map((e) => {
            // Phase 1.1: today's entries are per (person, round), so the
            // same person can show up twice for a 2-round room — the key
            // and the "จี้" state both need the round in them, or nudging
            // one round would silently mark the other nudged too.
            const key = `${e.userId}:${e.topicId}:${e.roundId}`;
            return (
              <div key={key} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white p-2">
                <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{e.userName.slice(0, 2)}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.userName}</p>
                  <p className="truncate text-[11px] text-[var(--ink-soft)]">{e.topicName} · {e.roundLabel} · {e.departmentName}</p>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", e.status === "late" ? "bg-[var(--accent)] text-[var(--tone-warn)]" : "bg-[var(--danger-bg)] text-[var(--danger)]")}>
                  {e.status === "late" ? "ส่งช้า" : "ยังไม่ส่ง"}
                </span>
                {canNudge && (
                  <Button variant="outline" size="sm" disabled={nudged.has(key)} onClick={() => setNudged((s) => new Set(s).add(key))}>
                    <Bell className="mr-1 h-3.5 w-3.5" />{nudged.has(key) ? "จี้แล้ว" : "จี้"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* report rate over time */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--ink-soft)]">อัตราการส่งรายคน</p>
          <div className="flex gap-1">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", days === d ? "bg-[var(--accent)] text-[var(--brand-green-dark)]" : "text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]")}
              >
                {d} วัน
              </button>
            ))}
          </div>
        </div>
        {rate.length === 0 && <p className="rounded-lg bg-[var(--bg-soft)] p-3 text-center text-xs text-[var(--ink-soft)]">ยังไม่มีข้อมูลในช่วงนี้</p>}
        {rate.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-sm">{r.name}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-soft)]">
              <div
                className={cn("h-full rounded-full", r.complianceRate >= 90 ? "bg-[var(--tone-ok)]" : r.complianceRate >= 70 ? "bg-[var(--tone-warn)]" : "bg-[var(--danger)]")}
                style={{ width: `${r.complianceRate}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[var(--ink-soft)]">{r.complianceRate}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
