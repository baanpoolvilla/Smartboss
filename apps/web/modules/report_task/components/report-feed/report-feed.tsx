"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import { NewMessagesDivider } from "@/modules/report_task/components/report-feed/report-new-divider";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { reportDayLabel } from "@/modules/report_task/components/report-feed/report-day-label";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { groupByDay } from "@/modules/report_task/lib/format";
import { ArrowDown, MessageSquareText } from "lucide-react";

const NEAR_BOTTOM_PX = 120;

/**
 * เรนเดอร์ทีละชุดแทนการกางทั้งห้องรวดเดียว — เริ่มที่ชุดล่าสุด แล้วต่อชุดเก่า
 * ให้เองตอนเลื่อนขึ้นใกล้ยอด (แบบฟีดโซเชียล) ไม่มีปุ่มให้กด
 *
 * ที่มา: ห้องรวมหลังย้ายข้อมูล (สรุปงาน-รวมห้องรายงาน 2026-09-23) มีโพสต์
 * 230+ อันในห้องเดียว จากเดิมห้องละ 20-78 อัน การ์ดแต่ละใบไม่ได้แค่วาด — มัน
 * คิดรอบส่ง/ตรงเวลา-สาย/แท็ก/ความคิดเห็น ของตัวเองทุกใบ พอคูณ 230 ใบตอนเปิด
 * ห้อง หน้าเลยค้างไปครู่หนึ่ง ("เปิดมาหน้า daily แล้วมันค้างไปแปปนึง")
 */
const PAGE_SIZE = 25;
/** เลื่อนขึ้นใกล้ยอดแค่ไหนถึงต่อชุดถัดไป — เผื่อไว้พอให้ต่อทันก่อนถึงยอดจริง */
const LOAD_OLDER_PX = 400;

/** Scrollable post timeline for the active topic — Teams-style: chronological,
 * oldest at the top and new posts pushed in at the bottom (never reordered by
 * reply activity — a post you're actively replying to must stay put, not jump
 * to the top and yank everyone's scroll position around). Jumps to the newest
 * post on topic switch or when already at the bottom, otherwise surfaces a
 * "jump to latest" affordance instead of forcing the scroll position. */
export function ReportFeed({
  topic,
  topicPosts,
  highlightPostId,
  highlightReplyId,
  onOpenTask,
  topicOf,
  onJumpToTopic,
}: {
  topic: ReportTopic;
  topicPosts: ReportPost[];
  highlightPostId: string | null;
  highlightReplyId?: string | null;
  onOpenTask?: (taskId: string) => void;
  /** ห้องรวม (Daily-report/Weekly-report/Monthly-report — ดู
   * mergedReportRoomFrequency) เท่านั้นที่ส่งมา: โพสต์ในฟีดมาจากหลายห้องปนกัน
   * แต่ละการ์ดจึงต้องได้ "ห้องต้นทางของตัวเอง" ไม่ใช่ห้องที่เปิดอยู่ — ตรรกะ
   * รอบส่ง/ตรงเวลา/สาย/จำนวนรูปขั้นต่ำ ทั้งหมดอ่านจาก topic ที่ส่งเข้า
   * ReportCard ถ้าใช้ห้องรวม (ซึ่งไม่มีรอบของตัวเอง) ตัดสินแทนห้องต้นทาง
   * ป้ายพวกนั้นจะผิดหมด ห้องปกติไม่ส่ง prop นี้ = พฤติกรรมเดิมเป๊ะ */
  topicOf?: (post: ReportPost) => ReportTopic | undefined;
  /** คู่กับ topicOf — ทำให้การ์ดของโพสต์ที่มาจากห้องอื่นมีป้ายชื่อห้องต้นทาง กดแล้วเด้งไปห้องนั้นจริง */
  onJumpToTopic?: (topicId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);

  // จำนวนโพสต์ "ล่าสุด" ที่กางอยู่ตอนนี้ — เริ่มชุดเดียว แล้วโตทีละชุดเมื่อเลื่อนขึ้น
  // รีเซ็ตตอนสลับห้องด้วยการปรับ state ระหว่างเรนเดอร์ (แพตเทิร์นที่ React แนะนำ
  // สำหรับ "state ที่ต้องรีเซ็ตเมื่อ prop เปลี่ยน") ไม่ใช้ effect เพราะ effect จะ
  // วาดชุดเก่าของห้องก่อนหน้าทิ้งไปหนึ่งเฟรมก่อนรีเซ็ต
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [countedTopicId, setCountedTopicId] = useState(topic.id);
  if (countedTopicId !== topic.id) {
    setCountedTopicId(topic.id);
    setVisibleCount(PAGE_SIZE);
  }

  // ลิงก์ที่ชี้มาที่โพสต์เก่าโดยตรง (deep link จากปุ่ม "คัดลอกลิงก์"/แจ้งเตือน)
  // ต้องกางถึงโพสต์นั้นให้เห็น ไม่งั้นกดลิงก์แล้วเจอหน้าว่างเพราะมันอยู่นอกชุด
  const highlightIdx = highlightPostId ? topicPosts.findIndex((p) => p.id === highlightPostId) : -1;
  const neededForHighlight = highlightIdx >= 0 ? topicPosts.length - highlightIdx : 0;
  const shownCount = Math.min(topicPosts.length, Math.max(visibleCount, neededForHighlight));
  const olderCount = topicPosts.length - shownCount;
  const visiblePosts = olderCount > 0 ? topicPosts.slice(olderCount) : topicPosts;

  // ต่อชุดเก่าแล้วเนื้อหาด้านบนงอกขึ้นมา ถ้าไม่ทำอะไรหน้าจะกระโดด — จำ "ระยะ
  // ห่างจากก้นฟีด" ไว้ก่อนต่อ แล้วเลื่อนกลับมาที่ระยะเดิมหลังวาดเสร็จ สายตา
  // จึงค้างอยู่ที่โพสต์เดิมเป๊ะ
  const anchorFromBottomRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorFromBottomRef.current;
    if (!el || anchor == null) return;
    el.scrollTop = el.scrollHeight - anchor;
    anchorFromBottomRef.current = null;
  }, [visibleCount]);

  // "ข้อความใหม่" divider position, frozen per room. Opening a room marks it
  // read (page.tsx effect) which clears unreadFor almost immediately, so we
  // capture the id of the first still-unread post on the very first render for
  // this room — refs update during render, before that read-clearing effect
  // runs — and keep the line there until the room changes. null = nothing was
  // unread when you arrived, so no line shows.
  const dividerRef = useRef<{ topicId: string; beforeId: string | null }>({ topicId: "", beforeId: null });
  if (dividerRef.current.topicId !== topic.id) {
    const firstUnread = topicPosts.find((p) => p.unreadFor.includes(viewingAsUserId) && p.authorId !== viewingAsUserId);
    dividerRef.current = { topicId: topic.id, beforeId: firstUnread ? firstUnread.id : null };
  }
  const newDividerBeforeId = dividerRef.current.beforeId;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [topic.id]);

  const prevCount = useRef(topicPosts.length);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = topicPosts.length > prevCount.current;
    prevCount.current = topicPosts.length;
    if (!grew) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    } else {
      setShowJumpToLatest(true);
    }
  }, [topicPosts.length]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) setShowJumpToLatest(false);
    // ใกล้ยอดแล้วและยังมีของเก่าเหลือ → ต่อชุดถัดไปให้เอง (anchorFromBottomRef
    // ทำให้จอไม่กระโดด ดู useLayoutEffect ข้างบน) กันยิงซ้ำด้วย anchor ที่ยัง
    // ไม่ถูกเคลียร์ ระหว่างที่ชุดก่อนหน้ายังวาดไม่เสร็จ
    if (el.scrollTop < LOAD_OLDER_PX && olderCount > 0 && anchorFromBottomRef.current == null) {
      anchorFromBottomRef.current = el.scrollHeight - el.scrollTop;
      setVisibleCount((n) => n + PAGE_SIZE);
    }
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowJumpToLatest(false);
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {/* Round 3: back to a tinted ground behind white post cards — asked for
          explicitly ("กรอบของใครของมันแยกให้ชัดเจน...แบบ thread") after the
          flat single-surface pass (see git history) still read as one
          undifferentiated column. A bordered card needs something to
          contrast against, which flattening this to plain white specifically
          removed. */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-[var(--bg-soft)] py-3 scroll-pt-4">
        {topicPosts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <div
              className="h-14 w-14 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `color-mix(in srgb, ${topic.color} 14%, white)` }}
            >
              <MessageSquareText className="h-6 w-6" style={{ color: topic.color }} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">ยังไม่มีโพสต์ในหัวข้อนี้</p>
              <p className="text-xs text-[var(--ink-soft)]">เริ่มต้นด้วยการเขียนโพสต์แรกของคุณจากช่องด้านล่าง</p>
            </div>
          </div>
        ) : (
          // Not capped in here — the reading-width constraint now lives one
          // level up, in page.tsx, wrapping the whole room column (header +
          // tabs + this feed + the composer) as a single centered unit
          // instead of just this post list on its own. That's the fix for
          // why a max-width tried at this level specifically got reverted
          // twice before: capping only the feed left the header still
          // full-width above it, plus no mx-auto meant the leftover space
          // sat one-sided instead of split evenly ("แสดงให้เต็มกรอบสิ").
          // space-y-6 between day groups, space-y-3 between the cards inside
          // one — each post is now its own bordered card (see ReportCard),
          // so the gap between them has to be real whitespace, not just a
          // border each card leans on.
          <div className="space-y-6 px-2 sm:px-3">
            {olderCount > 0 && (
              // ตัวบอกว่ายังมีของเก่าอยู่ข้างบน — เลื่อนขึ้นต่ออีกนิดแล้วมันต่อให้เอง
              <p className="py-2 text-center text-xs text-[var(--ink-soft)]">
                เลื่อนขึ้นเพื่อดูโพสต์เก่ากว่านี้ · เหลืออีก {olderCount} โพสต์
              </p>
            )}
            {groupByDay(visiblePosts, (p) => p.createdAt).map((group) => (
              <div key={group.key} className="space-y-3">
                <DaySeparator label={reportDayLabel(group.label)} />
                {group.items.map((p) => {
                  const postTopic = topicOf?.(p) ?? topic;
                  const fromAnotherRoom = postTopic.id !== topic.id;
                  return (
                    <Fragment key={p.id}>
                      {p.id === newDividerBeforeId && <NewMessagesDivider />}
                      <ReportCard
                        post={p}
                        topic={postTopic}
                        highlighted={p.id === highlightPostId}
                        highlightReplyId={highlightReplyId}
                        onOpenTask={onOpenTask}
                        topicBadge={
                          fromAnotherRoom && onJumpToTopic
                            ? { label: postTopic.name, onClick: () => onJumpToTopic(postTopic.id) }
                            : undefined
                        }
                      />
                    </Fragment>
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
