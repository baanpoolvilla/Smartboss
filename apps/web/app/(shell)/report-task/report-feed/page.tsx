"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TopicSidebar, TopicLogo, ALL_TOPICS_ID } from "@/modules/report_task/components/report-feed/topic-sidebar";
import { ReportComposer } from "@/modules/report_task/components/report-feed/report-composer";
import { ReportFeed } from "@/modules/report_task/components/report-feed/report-feed";
import { ReportAllPostsFeed } from "@/modules/report_task/components/report-feed/report-all-posts-feed";
import { ReportHeader } from "@/modules/report_task/components/report-feed/report-header";
import { RoomSettingsSheet } from "@/modules/report_task/components/report-feed/room-settings-sheet";
import { ReportTopicPanels, collectFiles, collectLinks, filesCutoffMs } from "@/modules/report_task/components/report-feed/report-topic-panels";
import { PostFilterBar, filterPosts, emptyPostFilters, postFiltersActiveCount, type PostFilters } from "@/modules/report_task/components/report-feed/post-filter-bar";
import { Button, buttonVariants } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/modules/report_task/components/ui/sheet";
import { useReportFeedStore, type ReportPost } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { users } from "@/modules/report_task/data/mock";
import { cn } from "@/modules/report_task/lib/utils";
import { canEditReportTopic, canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { topicModeOf } from "@/modules/report_task/lib/report-topic-membership";
import { RoomMembersDialog } from "@/modules/report_task/components/report-feed/room-members-dialog";
import { currentCutoff } from "@/modules/report_task/lib/report-cutoff";
import { BarChart3, FileImage, FolderHeart, ImagePlus, Link2, Lock, Menu, MessageSquareText, Pin, Settings, TriangleAlert, Users, X } from "lucide-react";

// Beyond this many pinned posts, the rest move into the "+N เพิ่มเติม"
// popover instead of forcing the bar to scroll horizontally.
const PIN_CHIP_LIMIT = 3;

function scrollToPost(postId: string) {
  document.getElementById(`report-post-${postId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function pinnedChip(p: ReportPost, onUnpin: (id: string) => void) {
  return (
    <span
      key={p.id}
      className="group/pin shrink-0 flex items-center gap-1 text-xs font-medium text-[var(--brand-green-dark)] bg-[var(--accent)] rounded-full pl-2 pr-1 py-0.5"
    >
      <button onClick={() => scrollToPost(p.id)} className="max-w-[200px] truncate hover:underline">
        {p.title}
      </button>
      <button
        onClick={() => onUnpin(p.id)}
        aria-label={`เลิกปักหมุด ${p.title}`}
        title="เลิกปักหมุด"
        className="shrink-0 h-3.5 w-3.5 rounded-full flex items-center justify-center text-[var(--brand-green-dark)]/60 hover:text-[var(--brand-green-dark)] hover:bg-white/60"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

type TopicTab = "posts" | "files" | "album" | "links" | "stats";
const topicTabs: { id: TopicTab; label: string; icon: typeof MessageSquareText }[] = [
  { id: "posts", label: "โพสต์", icon: MessageSquareText },
  { id: "files", label: "ไฟล์", icon: FileImage },
  { id: "album", label: "อัลบั้ม", icon: FolderHeart },
  { id: "links", label: "ลิงก์", icon: Link2 },
  { id: "stats", label: "สถิติ", icon: BarChart3 },
];

// useSearchParams() (for the "copy link" ?topic=&post= deep link) requires a
// Suspense boundary around anything that calls it, or `next build` fails to
// prerender this route entirely.
export default function ReportFeedPage() {
  return (
    <Suspense fallback={null}>
      <ReportFeedPageInner />
    </Suspense>
  );
}

function ReportFeedPageInner() {
  const topics = useReportFeedStore((s) => s.topics);
  const posts = useReportFeedStore((s) => s.posts);
  const togglePin = useReportFeedStore((s) => s.togglePin);
  const updateTopicSettings = useReportFeedStore((s) => s.updateTopicSettings);
  const markTopicRead = useReportFeedStore((s) => s.markTopicRead);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // Rooms can be scoped to a department or to managers only — filter once
  // here and hand the same list to the sidebar, so the two never disagree
  // about which rooms exist for this viewer.
  const visibleTopics = useMemo(
    () => topics.filter((t) => canSeeReportTopic(t.visibility, viewingAsUserId)),
    [topics, viewingAsUserId]
  );
  const searchParams = useSearchParams();
  // A pasted "copy link" (?topic=&post=) opens straight to the right room +
  // post — read once as the initial state, no need to re-sync via an effect
  // since the params don't change while this page stays mounted.
  const [selectedId, setSelectedId] = useState(() => searchParams.get("topic") ?? "");
  // A dashboard chart (e.g. "อัตราการส่งรายงานแยกตามแผนก") can deep-link
  // straight into a room's "สถิติ" tab with `?tab=stats`, same pattern as
  // `?post=`/`?reply=` — falls back to "posts" for anything else/missing.
  const [activeTab, setActiveTab] = useState<TopicTab>(() => {
    const tab = searchParams.get("tab");
    return tab === "files" || tab === "album" || tab === "links" || tab === "stats" ? tab : "posts";
  });
  const [highlightPostId, setHighlightPostId] = useState<string | null>(() => searchParams.get("post"));
  // A "copy link" on a specific comment (not just the post) adds &reply= —
  // same deep-link idea as Teams' parentMessageId, scoped down to one reply.
  const [highlightReplyId, setHighlightReplyId] = useState<string | null>(() => searchParams.get("reply"));
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  // Below `lg`, the topic tree moves into a full-screen Sheet instead of a
  // squeezed inline block with its own internal scroll (3.5.5) — the desktop
  // sidebar (TopicSidebar, still rendered as-is at `lg:`) is unaffected.
  const [mobileTopicsOpen, setMobileTopicsOpen] = useState(false);
  // The ⚙ (Phase 6) opens settings right here now instead of navigating the
  // whole page away to /settings and losing which room/tab you were on (G1).
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // Filter bar (1.3) — read once from the URL same as the deep-link params
  // above, then kept in sync both ways via the effect below.
  const [filters, setFilters] = useState<PostFilters>(() => ({
    authorIds: new Set((searchParams.get("author") ?? "").split(",").filter(Boolean)),
    lateOnly: searchParams.get("late") === "1",
    unreadOnly: searchParams.get("unread") === "1",
    hasImageOnly: searchParams.get("image") === "1",
    savedOnly: searchParams.get("saved") === "1",
  }));
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const set = (key: string, value: string | null) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    set("author", filters.authorIds.size > 0 ? [...filters.authorIds].join(",") : null);
    set("late", filters.lateOnly ? "1" : null);
    set("unread", filters.unreadOnly ? "1" : null);
    set("image", filters.hasImageOnly ? "1" : null);
    set("saved", filters.savedOnly ? "1" : null);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // First-ever run for this org: populate the demo rooms automatically so the
  // feed isn't a blank page before anyone's posted real reports. Non-destructive
  // and one-time — gated on `hasSeeded`, not on post count, so deleting the
  // demo topics later doesn't bring them back. Waits for `loaded` (the
  // server's real `hasSeeded` value) so this doesn't seed before that arrives.
  const feedLoaded = useReportFeedStore((s) => s.loaded);
  useEffect(() => {
    if (!feedLoaded) return;
    const state = useReportFeedStore.getState();
    if (!state.hasSeeded) state.seedDemoData();
  }, [feedLoaded]);

  // A parent topic (has sub-topics, Teams-style) is an organizing folder
  // only, with nothing of its own to show — it's not selectable by clicking
  // its sidebar row (see topic-sidebar.tsx), so landing on one here only
  // happens via a stale/deep-linked id. Redirect to its first sub-topic
  // instead of rendering an empty folder view.
  const isParentId = (id: string) => visibleTopics.some((t) => t.parentId === id);

  // Falls back to the first (non-folder) topic once the persisted store
  // rehydrates (topics start empty on the very first client render) —
  // computed during render rather than synced via an effect, since it's
  // pure derived state. ALL_TOPICS_ID is a sentinel, not a real topic — pass
  // it through as-is rather than falling back, same as any real,
  // currently-selected topic.
  const activeId = (() => {
    if (selectedId === ALL_TOPICS_ID) return selectedId;
    if (selectedId && visibleTopics.some((t) => t.id === selectedId) && !isParentId(selectedId)) {
      return selectedId;
    }
    if (selectedId && isParentId(selectedId)) {
      const firstChild = visibleTopics.find((t) => t.parentId === selectedId);
      if (firstChild) return firstChild.id;
    }
    return visibleTopics.find((t) => !isParentId(t.id))?.id ?? visibleTopics[0]?.id ?? "";
  })();
  const showAllPosts = activeId === ALL_TOPICS_ID;
  const activeTopic = useMemo(() => visibleTopics.find((t) => t.id === activeId), [visibleTopics, activeId]);
  const topicPosts = posts
    .filter((p) => p.topicId === activeId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const pinnedPosts = topicPosts.filter((p) => p.pinned);
  // Filter bar (1.3) only narrows the main feed — tab counts/pinned strip
  // above still reflect the room's real totals, not "what's visible right now".
  const filteredTopicPosts = activeTopic
    ? filterPosts(topicPosts, filters, { topicOf: () => activeTopic, viewingAsUserId })
    : topicPosts;

  // R5 — a count per tab, so it's obvious there's something to look at
  // before clicking in blind. Same source data each tab's own panel already
  // computes (report-topic-panels.tsx) — recomputed lightly here rather than
  // lifting that panel's whole state up just for a badge number. Plain
  // (not useMemo'd): `topicPosts` above is a fresh array every render
  // anyway, so memoizing against it wouldn't skip any work.
  const allAlbums = useReportFeedStore((s) => s.albums);
  const tabCounts: Partial<Record<TopicTab, number>> = activeTopic
    ? {
        posts: topicPosts.length,
        files: collectFiles(topicPosts).filter((f) => new Date(f.createdAt).getTime() >= filesCutoffMs(activeTopic.filesRetentionDays)).length,
        album: allAlbums.filter((a) => a.topicId === activeTopic.id).length,
        links: collectLinks(topicPosts).length,
      }
    : {};

  // Opening a room marks its posts read, same as any chat app — a parent
  // (organizing-folder) topic has no posts of its own to mark either way,
  // so this is harmless to run unconditionally on whatever's selected.
  useEffect(() => {
    if (!activeId || showAllPosts) return;
    markTopicRead(activeId, viewingAsUserId);
  }, [activeId, showAllPosts, viewingAsUserId, markTopicRead]);

  useEffect(() => {
    if (!highlightPostId) return;
    // When a reply is also targeted, ReportCard's own jumpToQuote effect
    // re-centers on that exact reply — this scroll is just the fallback for
    // a post-only link, so it stays out of the way instead of fighting it.
    if (!highlightReplyId) {
      const el = document.getElementById(`report-post-${highlightPostId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timer = setTimeout(() => {
      setHighlightPostId(null);
      setHighlightReplyId(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [highlightPostId, highlightReplyId, activeId]);

  const requirementParts = useMemo(() => {
    if (!activeTopic) return [];
    if (activeTopic.cutoffs.length === 0) {
      return activeTopic.minImages > 0 ? [{ text: `ต้องแนบรูปอย่างน้อย ${activeTopic.minImages} รูปทุกโพสต์`, active: false }] : [];
    }
    // Per-round overrides can make some rounds require a different photo
    // count — spell each one out, and mark whichever round "now" falls into
    // so posting-right-now context is obvious without doing clock math.
    const active = currentCutoff(activeTopic.cutoffs);
    return activeTopic.cutoffs.map((c) => {
      const required = c.minImages ?? activeTopic.minImages;
      return {
        text: `${c.label} ${c.time}${required > 0 ? ` (แนบรูป ≥${required})` : ""}`,
        active: active?.id === c.id,
      };
    });
  }, [activeTopic]);

  // Who can actually see this room, from the same rule the sidebar and store
  // use to gate visibility — a real list, not a placeholder count.
  const topicMembers = useMemo(() => {
    if (!activeTopic) return [];
    return users.filter((u) => canSeeReportTopic(activeTopic.visibility, u.id));
  }, [activeTopic]);

  // Managing membership (add/remove) opens the shared RoomMembersDialog —
  // only for the two modes where membership is a plain list of people
  // (department-scoped rooms take extraUserIds on top of the department;
  // person-scoped rooms take userIds directly). Whoever can edit the room's
  // settings can also manage this list — same gate as the settings gear
  // icon below.
  const topicMode = activeTopic ? topicModeOf(activeTopic.visibility) : "open";
  const canManageMembers = !!activeTopic && (topicMode === "department" || topicMode === "person") && canEditReportTopic(activeTopic.visibility, viewingAsUserId);

  return (
    <div className="flex flex-col gap-6 h-full">
      <ReportHeader
        visibleTopics={visibleTopics}
        onJumpToPost={(topicId, postId) => {
          setSelectedId(topicId);
          setActiveTab("posts");
          setHighlightPostId(postId);
        }}
        onShowOverview={() => setSelectedId(ALL_TOPICS_ID)}
      />

      {/* Below `lg`, "☰ หัวข้อ" opens the topic tree as a full-screen Sheet
          instead of squeezing it into a fixed h-64 block above the feed with
          its own internal scroll (3.5.5) — the `lg:flex` sidebar right below
          is completely untouched at desktop widths. */}
      <div className="lg:hidden">
        <Button variant="outline" onClick={() => setMobileTopicsOpen(true)} className="w-full justify-start gap-2">
          <Menu className="h-4 w-4" />
          หัวข้อ
          {activeTopic && <span className="text-[var(--ink-soft)] font-normal truncate">— {activeTopic.name}</span>}
        </Button>
        <Sheet open={mobileTopicsOpen} onOpenChange={setMobileTopicsOpen}>
          <SheetContent side="left" className="p-0 w-[85vw] max-w-sm flex flex-col">
            <SheetHeader className="px-4 py-3 border-b border-[var(--line)]">
              <SheetTitle>หัวข้อทั้งหมด</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0">
              <TopicSidebar
                topics={visibleTopics}
                activeId={activeId}
                fillHeight
                onSelect={(id) => {
                  setSelectedId(id);
                  setActiveTab("posts");
                  setMobileTopicsOpen(false);
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-stretch lg:items-start flex-1 min-h-0 lg:min-h-[420px]">
        <div className="hidden lg:flex lg:shrink-0">
          <TopicSidebar
            topics={visibleTopics}
            activeId={activeId}
            onSelect={(id) => {
              setSelectedId(id);
              setActiveTab("posts");
            }}
          />
        </div>

        <div className="w-full flex-1 min-w-0 flex flex-col min-h-0 lg:h-full">
          {showAllPosts ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-[var(--line)] bg-white shadow-sm overflow-hidden flex flex-col">
              <ReportAllPostsFeed
                topics={visibleTopics}
                posts={posts}
                onJumpToTopic={(id) => {
                  setSelectedId(id);
                  setActiveTab("posts");
                }}
              />
            </div>
          ) : activeTopic ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-[var(--line)] bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="shrink-0">
                {/* Row 1 — identity: logo/name/description on the left,
                    member count + settings gear on the right (R1/R4: two
                    fixed rows instead of everything wrapping together with
                    the tabs into whatever fits). */}
                <div className="px-5 pt-3.5 pb-2.5 flex items-start gap-2.5">
                  <TopicLogo topic={activeTopic} size="h-8 w-8" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[16px] font-semibold truncate">{activeTopic.name}</h2>
                    {activeTopic.description && (
                      <p className="text-xs text-[var(--ink-soft)] truncate">{activeTopic.description}</p>
                    )}
                  </div>
                  {/* Anyone can open this to browse who's in the room — same
                      trigger/dialog for every room. RoomMembersDialog itself
                      downgrades to a read-only view (no checkboxes, no Save,
                      just Close) whenever canManage is false or the mode has
                      no per-person list to edit, so a regular employee can
                      look but has no controls to change anything. */}
                  <button
                    data-tour="member-count"
                    onClick={() => setMembersDialogOpen(true)}
                    className="flex items-center gap-1 text-xs text-[var(--ink-soft)] tabular-nums shrink-0 hover:text-[var(--ink)] rounded-full px-1.5 py-0.5 hover:bg-[var(--bg-soft)] transition-colors"
                    title={canManageMembers ? "จัดการสมาชิกในหัวข้อนี้" : "ดูรายชื่อสมาชิกในหัวข้อนี้"}
                  >
                    {activeTopic.visibility?.managerOnly && <Lock className="h-3 w-3" />}
                    <Users className="h-3 w-3" />
                    {topicMembers.length} คน
                  </button>
                  <RoomMembersDialog
                    open={membersDialogOpen}
                    onOpenChange={setMembersDialogOpen}
                    topic={activeTopic}
                    updateTopicSettings={updateTopicSettings}
                    canManage={canManageMembers}
                  />
                  {canEditReportTopic(activeTopic.visibility, viewingAsUserId) && (
                    <button
                      onClick={() => setRoomSettingsOpen(true)}
                      aria-label="ตั้งค่าห้อง"
                      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0 h-7 w-7")}
                    >
                      <Settings className="h-4 w-4 text-[var(--ink-soft)]" />
                    </button>
                  )}
                  <RoomSettingsSheet open={roomSettingsOpen} onOpenChange={setRoomSettingsOpen} topic={activeTopic} />
                </div>

                {/* Row 2 — tabs, full-width so the underline (`border-b` on
                    the container, `-mb-px` per tab) actually connects to a
                    real line instead of floating (R2), with counts (R5) and
                    proper tab semantics (R6). */}
                <div role="tablist" aria-label="ส่วนของหัวข้อ" className="px-5 flex items-center gap-4 border-b border-[var(--line)] overflow-x-auto">
                  {topicTabs.map((t) => {
                    const Icon = t.icon;
                    const active = activeTab === t.id;
                    const count = tabCounts[t.id];
                    return (
                      <button
                        key={t.id}
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => setActiveTab(t.id)}
                        onKeyDown={(e) => {
                          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                          e.preventDefault();
                          const i = topicTabs.findIndex((x) => x.id === t.id);
                          const next = topicTabs[(i + (e.key === "ArrowRight" ? 1 : -1) + topicTabs.length) % topicTabs.length];
                          setActiveTab(next!.id);
                        }}
                        className={cn(
                          "shrink-0 flex items-center gap-1.5 pb-2 -mb-px border-b-2 text-xs font-medium transition-colors duration-200",
                          active
                            ? "border-[var(--brand-green)] text-[var(--brand-green-dark)]"
                            : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {t.label}
                        {count != null && count > 0 && <span className="tabular-nums text-[var(--ink-soft)]">{count}</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Merged into one row (1.4) — was two separate border-t
                    strips (cutoff reminder, then pinned posts) stacked on
                    top of each other, doubling up the header's height for
                    what's really one "today's context" row. */}
                {activeTab === "posts" && (requirementParts.length > 0 || pinnedPosts.length > 0) && (
                  <div className="flex items-center gap-2.5 px-5 py-2 flex-wrap border-t border-[var(--line)] bg-[var(--bg-soft)]/40">
                    {requirementParts.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] shrink-0">
                          {activeTopic.minImages > 0 ? <ImagePlus className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
                          รอบส่งวันนี้
                        </span>
                        {requirementParts.map((part, i) => (
                          <button
                            key={i}
                            onClick={() => setRoomSettingsOpen(true)}
                            className={cn(
                              "text-[11px] font-medium rounded-full px-2.5 py-1 transition-colors",
                              part.active
                                ? "bg-[var(--brand-green)] text-[var(--ink)]"
                                : "bg-white border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--brand-green)]/40 hover:text-[var(--ink)]"
                            )}
                          >
                            {part.text}
                          </button>
                        ))}
                      </div>
                    )}
                    {requirementParts.length > 0 && pinnedPosts.length > 0 && (
                      <div className="h-4 w-px bg-[var(--line)] shrink-0" />
                    )}
                    {pinnedPosts.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Pin className="h-3 w-3 shrink-0 text-[var(--brand-green-dark)]" />
                        {pinnedPosts.slice(0, PIN_CHIP_LIMIT).map((p) => pinnedChip(p, togglePin))}
                        {pinnedPosts.length > PIN_CHIP_LIMIT && (
                          <Popover>
                            <PopoverTrigger
                              render={
                                <button
                                  className="shrink-0 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] rounded-full border border-[var(--line)] px-2 py-0.5 hover:bg-[var(--bg-soft)] transition-colors"
                                  title="โพสต์ที่ปักหมุดเพิ่มเติม"
                                >
                                  +{pinnedPosts.length - PIN_CHIP_LIMIT} เพิ่มเติม
                                </button>
                              }
                            />
                            <PopoverContent align="start" className="w-auto max-w-xs p-2">
                              <div className="flex flex-col gap-1">
                                {pinnedPosts.slice(PIN_CHIP_LIMIT).map((p) => pinnedChip(p, togglePin))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Filter bar (1.3) — was the biggest gap in the whole page:
                    the room's own feed had no filtering at all before this. */}
                {activeTab === "posts" && (
                  <div className="px-5 py-2 border-t border-[var(--line)]">
                    <PostFilterBar
                      filters={filters}
                      onChange={setFilters}
                      authorOptions={topicMembers.map((m) => m.id)}
                    />
                  </div>
                )}
              </div>

              {activeTab === "posts" ? (
                <>
                  {filteredTopicPosts.length === 0 && postFiltersActiveCount(filters) > 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6 bg-[var(--bg-soft)]/40">
                      <p className="text-sm font-semibold">ไม่มีโพสต์ตรงกับตัวกรอง</p>
                      <Button variant="outline" size="sm" onClick={() => setFilters(emptyPostFilters)}>
                        ล้างตัวกรอง
                      </Button>
                    </div>
                  ) : (
                    <ReportFeed
                      topic={activeTopic}
                      topicPosts={filteredTopicPosts}
                      highlightPostId={highlightPostId}
                      highlightReplyId={highlightReplyId}
                    />
                  )}
                  <ReportComposer topic={activeTopic} />
                </>
              ) : (
                <ReportTopicPanels tab={activeTab} topic={activeTopic} topicPosts={topicPosts} />
              )}
            </div>
          ) : (
            <div className="flex-1 rounded-2xl border border-[var(--line)] bg-white shadow-sm flex flex-col items-center justify-center gap-2 text-[var(--ink-soft)]">
              <MessageSquareText className="h-8 w-8" />
              <p className="text-sm">ยังไม่มีหัวข้อ — กด + ทางซ้ายเพื่อเริ่มต้น</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
