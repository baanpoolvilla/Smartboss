"use client";

import { useEffect, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import { reportDayLabel } from "@/modules/report_task/components/report-feed/report-day-label";
import { groupByDay } from "@/modules/report_task/lib/format";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { ArrowDown, MessageSquareText } from "lucide-react";

const NEAR_BOTTOM_PX = 120;

/**
 * เหมือน ReportFeed (feed ของห้องเดียว) เป๊ะ ๆ — โครง/สไตล์เดียวกันทุก
 * อย่าง (day separator, จัด scroll ไว้ล่างสุด, ปุ่ม "โพสต์ใหม่") ต่างกันแค่
 * รับโพสต์จากหลายห้องพร้อมกัน (`topicOf` สำหรับหาว่าโพสต์แต่ละอันมาจากห้องไหน
 * แทนที่จะเป็น topic เดียวคงที่แบบ ReportFeed) — ใช้กับห้องรวม "Daily-report /
 * Weekly-report / Monthly-report" ที่รวมโพสต์จากทุกแผนกมาไว้ที่เดียว
 * (สรุปงาน-รวมห้องรายงาน 2026-09-22) ให้ดูเหมือนห้องปกติเป๊ะ ๆ ไม่ใช่หน้า
 * "ภาพรวม" แบบ ReportAllPostsFeed (ไม่มีปุ่มย้อนกลับ/มุมมอง/คำอธิบายใต้ชื่อ)
 *
 * แต่ละการ์ดยังติดป้ายชื่อห้องต้นทาง (topicBadge) ไว้เสมอ เพราะโพสต์ในนี้มา
 * จากหลายแผนกปนกัน ต่างจาก ReportFeed ที่ไม่ต้องติดป้ายเพราะ "ห้องเดียว" อยู่
 * แล้วเห็นชัดจากหัวห้องด้านบน
 *
 * ตัด "ข้อความใหม่" (NewMessagesDivider) ออก — ตัวแบ่งนั้นผูกกับ unread-state
 * ของ "ห้องเดียว" (ReportFeed คำนวณจาก topic.id ตัวเดียว) ห้องรวมนี้ไม่มี
 * "ห้องเดียว" ให้ผูกตรง ๆ แบบนั้น ยอมรับ trade-off นี้แทนเดา/ประมาณผิด
 */
export function MergedReportFeed({
  posts,
  topicOf,
  onJumpToTopic,
  emptyIcon: EmptyIcon = MessageSquareText,
  emptyTitle,
  emptyDescription,
  highlightPostId,
  onOpenTask,
}: {
  posts: ReportPost[];
  topicOf: (post: ReportPost) => ReportTopic | undefined;
  onJumpToTopic?: (topicId: string) => void;
  emptyIcon?: typeof MessageSquareText;
  emptyTitle: string;
  emptyDescription: string;
  highlightPostId?: string | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const sorted = [...posts].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // จงใจรันครั้งเดียวตอนเมานต์ (สลับ Daily/Weekly/Monthly = เมานต์ใหม่ทั้ง
    // component ผ่าน key อยู่แล้ว ดู page.tsx) เหมือน ReportFeed ที่รีเซ็ต
    // ตาม topic.id
  }, []);

  const prevCount = useRef(posts.length);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = posts.length > prevCount.current;
    prevCount.current = posts.length;
    if (!grew) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) el.scrollTop = el.scrollHeight;
    else setShowJumpToLatest(true);
  }, [posts.length]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) setShowJumpToLatest(false);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowJumpToLatest(false);
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-[var(--bg-soft)] py-3 scroll-pt-4">
        {sorted.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="h-14 w-14 rounded-full flex items-center justify-center bg-[var(--accent)]">
              <EmptyIcon className="h-6 w-6 text-[var(--brand-green-dark)]" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">{emptyTitle}</p>
              <p className="text-xs text-[var(--ink-soft)]">{emptyDescription}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6 px-2 sm:px-3">
            {groupByDay(sorted, (p) => p.createdAt).map((group) => (
              <div key={group.key} className="space-y-3">
                <DaySeparator label={reportDayLabel(group.label)} />
                {group.items.map((p) => {
                  const topic = topicOf(p);
                  if (!topic) return null;
                  return (
                    <ReportCard
                      key={p.id}
                      post={p}
                      topic={topic}
                      highlighted={p.id === highlightPostId}
                      onOpenTask={onOpenTask}
                      topicBadge={onJumpToTopic ? { label: topic.name, onClick: () => onJumpToTopic(topic.id) } : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {showJumpToLatest && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-[var(--ink)] text-white text-xs font-medium px-3 py-1.5 shadow-lg hover:opacity-90"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          โพสต์ใหม่
        </button>
      )}
    </div>
  );
}
