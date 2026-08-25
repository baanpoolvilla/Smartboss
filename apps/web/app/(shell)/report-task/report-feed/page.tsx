"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TopicSidebar, TopicLogo, ALL_TOPICS_ID, PENDING_ID, MENTIONS_ID, TODOS_ID } from "@/modules/report_task/components/report-feed/topic-sidebar";
import { AddTodoDialog } from "@/modules/report_task/components/calendar/add-todo-dialog";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { formatDate } from "@/modules/report_task/lib/format";
import type { TodoItem } from "@/modules/report_task/types";
import { ReportComposer } from "@/modules/report_task/components/report-feed/report-composer";
import { ReportFeed } from "@/modules/report_task/components/report-feed/report-feed";
import { OpenchatFeed } from "@/modules/report_task/components/report-feed/openchat-feed";
import { ReportAllPostsFeed } from "@/modules/report_task/components/report-feed/report-all-posts-feed";
import { ReportHeader } from "@/modules/report_task/components/report-feed/report-header";
import { RoomSettingsSheet } from "@/modules/report_task/components/report-feed/room-settings-sheet";
import { ReportTopicPanels, collectFiles, collectLinks, filesCutoffMs } from "@/modules/report_task/components/report-feed/report-topic-panels";
import { PostFilterBar, filterPosts, emptyPostFilters, postFiltersActiveCount, type PostFilters } from "@/modules/report_task/components/report-feed/post-filter-bar";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { Button, buttonVariants } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/modules/report_task/components/ui/sheet";
import { useReportFeedStore, isOpenchatTopic, type ReportPost } from "@/modules/report_task/store/report-feed-store";
import { useReportTagStore } from "@/modules/report_task/store/report-tag-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { users } from "@/modules/report_task/lib/directory";
import { cn } from "@/modules/report_task/lib/utils";
import { canEditReportTopic, canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { topicModeOf } from "@/modules/report_task/lib/report-topic-membership";
import { RoomMembersDialog } from "@/modules/report_task/components/report-feed/room-members-dialog";
import { currentCutoff } from "@/modules/report_task/lib/report-cutoff";
import { pendingToday, todayStatusEntries, type TodayStatusEntry } from "@/modules/report_task/lib/report-feed-compliance";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { postMentionsUser } from "@/modules/report_task/lib/report-feed-mentions";
import { AtSign, BarChart3, Check, CheckCircle2, ChevronDown, Clock, FileImage, FolderHeart, Hash, ImagePlus, Link2, ListTodo, Lock, Menu, MessageSquareText, Pin, Plus, Settings, Trash2, TriangleAlert, Users, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";

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
  const reportTags = useReportTagStore((s) => s.tags);
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
  // "เปิดเป็นงาน" (report-card.tsx) opens the Task Board's own detail sheet
  // right here in place, same local-state pattern as calendar-view.tsx —
  // no navigation away from whatever room/post the viewer was reading.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // Which header pill (H1) was clicked, if any — overrides the main panel
  // with TodayStatusPanel below regardless of what's selected in the
  // sidebar tree. Cleared by selectView() so any real navigation drops it.
  const [todayStatusFilter, setTodayStatusFilter] = useState<"posted" | "late" | "missing" | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  // Filter bar (1.3) — read once from the URL same as the deep-link params
  // above, then kept in sync both ways via the effect below.
  const [filters, setFilters] = useState<PostFilters>(() => ({
    authorIds: new Set((searchParams.get("author") ?? "").split(",").filter(Boolean)),
    tagIds: new Set((searchParams.get("tag") ?? "").split(",").filter(Boolean)),
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
    set("tag", filters.tagIds.size > 0 ? [...filters.tagIds].join(",") : null);
    set("late", filters.lateOnly ? "1" : null);
    set("unread", filters.unreadOnly ? "1" : null);
    set("image", filters.hasImageOnly ? "1" : null);
    set("saved", filters.savedOnly ? "1" : null);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // A parent topic (has sub-topics, Teams-style) is an organizing folder
  // only, with nothing of its own to show — it's not selectable by clicking
  // its sidebar row (see topic-sidebar.tsx), so landing on one here only
  // happens via a stale/deep-linked id. Redirect to its first sub-topic
  // instead of rendering an empty folder view.
  const isParentId = (id: string) => {
    const topic = visibleTopics.find((t) => t.id === id);
    if (topic?.allowDirectPost) return false;
    return visibleTopics.some((t) => t.parentId === id);
  };

  // Falls back to the first (non-folder) topic once the persisted store
  // rehydrates (topics start empty on the very first client render) —
  // computed during render rather than synced via an effect, since it's
  // pure derived state. ALL_TOPICS_ID is a sentinel, not a real topic — pass
  // it through as-is rather than falling back, same as any real,
  // currently-selected topic.
  const activeId = (() => {
    if (selectedId === ALL_TOPICS_ID || selectedId === PENDING_ID || selectedId === MENTIONS_ID || selectedId === TODOS_ID) return selectedId;
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
  const showPending = activeId === PENDING_ID;
  const showMentions = activeId === MENTIONS_ID;
  const showTodos = activeId === TODOS_ID;
  const activeTopic = useMemo(() => visibleTopics.find((t) => t.id === activeId), [visibleTopics, activeId]);
  // Same labels the sidebar itself uses for these entries (topic-sidebar.tsx)
  // — the header should never invent its own name for a view the sidebar
  // already names something specific.
  const roomLabel = showAllPosts
    ? "ภาพรวมทั้งหมด"
    : showPending
      ? "ที่ฉันต้องส่ง"
      : showMentions
        ? "ที่กล่าวถึงฉัน"
        : showTodos
          ? "สิ่งที่ต้องทำ"
          : (activeTopic?.name ?? null);
  const exemptions = useReportComplianceExemptions();
  // "ที่ฉันต้องส่ง" — same pendingToday() the sidebar badge counts, filtered
  // down to just this viewer, for the actual room list underneath the badge.
  const myPending = useMemo(
    () => (showPending ? pendingToday(visibleTopics, posts, exemptions).filter((e) => e.userId === viewingAsUserId) : []),
    [showPending, visibleTopics, posts, exemptions, viewingAsUserId]
  );
  // "ที่กล่าวถึงฉัน" — every post anywhere this viewer is @mentioned, fed
  // into the same ReportAllPostsFeed the merged view already uses.
  const mentionPosts = useMemo(() => {
    if (!showMentions) return [];
    const visibleTopicIds = new Set(visibleTopics.map((t) => t.id));
    return posts.filter((p) => visibleTopicIds.has(p.topicId) && p.authorId !== viewingAsUserId && postMentionsUser(p, viewingAsUserId));
  }, [showMentions, visibleTopics, posts, viewingAsUserId]);
  // Header pills (H1) — who's behind "ส่งแล้ววันนี้/ส่งช้า/ยังไม่ส่ง", not
  // just the count. Only computed once a pill's actually been clicked.
  const todayStatus = useMemo(
    () => (todayStatusFilter ? todayStatusEntries(visibleTopics, posts, exemptions) : []),
    [todayStatusFilter, visibleTopics, posts, exemptions]
  );
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
    if (!activeId || showAllPosts || showPending || showMentions || showTodos) return;
    markTopicRead(activeId, viewingAsUserId);
  }, [activeId, showAllPosts, showPending, showMentions, showTodos, viewingAsUserId, markTopicRead]);

  // ที่กล่าวถึงฉัน spans posts across many rooms, so opening it clears
  // exactly those posts' unread flag (markPostsRead) instead of a whole
  // room's worth (markTopicRead) — the mention badge (topic-sidebar.tsx)
  // only ever counted the unread ones to begin with.
  const markPostsRead = useReportFeedStore((s) => s.markPostsRead);
  useEffect(() => {
    if (!showMentions || mentionPosts.length === 0) return;
    markPostsRead(mentionPosts.map((p) => p.id), viewingAsUserId);
  }, [showMentions, mentionPosts, viewingAsUserId, markPostsRead]);

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

  // Any real navigation (sidebar click, "jump to topic" from a merged view)
  // drops whatever header-pill filter was active — otherwise picking a room
  // out of "ยังไม่ส่ง"'s list would still show the pill panel underneath it.
  function selectView(id: string) {
    setTodayStatusFilter(null);
    setSelectedId(id);
    setActiveTab("posts");
  }

  // Opens the full settings sheet for a topic straight from its sidebar row
  // menu — switches the active room to it first (the sheet reads `activeTopic`,
  // not an id of its own) then opens the same sheet the ⚙ icon uses.
  function openTopicSettings(id: string) {
    selectView(id);
    setRoomSettingsOpen(true);
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <ReportHeader
        visibleTopics={visibleTopics}
        onJumpToPost={(topicId, postId) => {
          selectView(topicId);
          setHighlightPostId(postId);
        }}
        onShowTodayStatus={setTodayStatusFilter}
        roomLabel={roomLabel}
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
            <SheetHeader className="px-4 py-3 border-b border-[var(--line)]/60">
              <SheetTitle>หัวข้อทั้งหมด</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0">
              <TopicSidebar
                topics={visibleTopics}
                activeId={activeId}
                fillHeight
                onSelect={(id) => {
                  selectView(id);
                  setMobileTopicsOpen(false);
                }}
                onOpenSettings={(id) => {
                  openTopicSettings(id);
                  setMobileTopicsOpen(false);
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* items-stretch at every width — lg:items-start previously let the
          sidebar and the room panel each auto-size to their own content
          instead of matching the row's height, so a room list long enough
          would grow the whole page instead of scrolling inside its own
          `lg:h-full` + overflow-y-auto (both panels already opt into that,
          it just had nothing to resolve against without a stretched parent). */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-stretch flex-1 min-h-0 lg:min-h-[420px]">
        <div className="hidden lg:flex lg:shrink-0">
          <TopicSidebar
            topics={visibleTopics}
            activeId={activeId}
            onSelect={selectView}
            onOpenSettings={openTopicSettings}
          />
        </div>

        <div className="w-full flex-1 min-w-0 flex flex-col min-h-0 lg:h-full">
          {todayStatusFilter ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-[var(--line)] bg-white overflow-hidden flex flex-col">
              <TodayStatusPanel
                status={todayStatusFilter}
                entries={todayStatus.filter((e) => e.status === todayStatusFilter)}
                onJumpToTopic={selectView}
              />
            </div>
          ) : showAllPosts ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-[var(--line)] bg-white overflow-hidden flex flex-col">
              <ReportAllPostsFeed topics={visibleTopics} posts={posts} onJumpToTopic={selectView} onOpenTask={setOpenTaskId} />
            </div>
          ) : showPending ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-[var(--line)] bg-white overflow-hidden flex flex-col">
              <PendingTopicsPanel entries={myPending} onJumpToTopic={selectView} />
            </div>
          ) : showMentions ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-[var(--line)] bg-white overflow-hidden flex flex-col">
              <ReportAllPostsFeed
                topics={visibleTopics}
                posts={mentionPosts}
                title="ที่กล่าวถึงฉัน"
                description="ทุกโพสต์และความคิดเห็นที่มีคนแท็กคุณ เรียงตามเวลา ล่าสุดอยู่ล่างสุด"
                icon={AtSign}
                emptyTitle="ยังไม่มีใครกล่าวถึงคุณ"
                emptyDescription="โพสต์หรือความคิดเห็นที่แท็กคุณด้วย @ จะขึ้นที่นี่"
                onJumpToTopic={selectView}
                onOpenTask={setOpenTaskId}
              />
            </div>
          ) : showTodos ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-[var(--line)] bg-white overflow-hidden flex flex-col">
              <TodoPanel />
            </div>
          ) : activeTopic ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-[var(--line)] bg-white overflow-hidden flex flex-col">
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
                  {/* Room mode pill — moved up here from the filter row below
                      (R1, next to the member count/gear it's most related
                      to). Visible to everyone (it's informational — same as
                      before), but only clickable into room settings for
                      whoever can actually edit them; a viewer without that
                      right gets the plain label so hovering doesn't imply a
                      control that isn't there for them. Still just a label
                      either way, not a real <select> — the mode itself is
                      locked for any room created after
                      FEED_VIEW_MODE_LOCK_CUTOFF (see room-settings-sheet.tsx),
                      so a dropdown look would promise something it can't do. */}
                  {(() => {
                    const modeLabel = activeTopic.feedViewMode === "threads" ? "Thread" : "Openchat";
                    const canEdit = canEditReportTopic(activeTopic.visibility, viewingAsUserId);
                    return canEdit ? (
                      <button
                        onClick={() => setRoomSettingsOpen(true)}
                        className="flex items-center gap-1 text-xs font-medium text-[var(--ink-soft)] bg-[var(--bg-soft)] hover:bg-[var(--accent)] hover:text-[var(--brand-green-dark)] rounded-full px-2.5 py-1 shrink-0 transition-colors"
                      >
                        มุมมอง: {modeLabel}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2.5 py-1 shrink-0">
                        มุมมอง: {modeLabel}
                      </span>
                    );
                  })()}
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
                          const next = topicTabs[(i + (e.key === "ArrowRight" ? 1 : -1) + topicTabs.length) % topicTabs.length]!;
                          setActiveTab(next.id);
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
                        {count != null && count > 0 && (
                          <span className="tabular-nums text-[10px] text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-1.5 py-0.5">{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Merged into one row (1.4) — was two separate border-t
                    strips (cutoff reminder, then pinned posts) stacked on
                    top of each other, doubling up the header's height for
                    what's really one "today's context" row.
                    `w-fit` instead of a full-width border-t bar — a bar that
                    stretches edge-to-edge but only ever has content bunched
                    at its left end (pinned posts are the rare case, this row
                    is usually just "รอบส่งวันนี้" + a couple pills) reads as
                    unbalanced/unfinished. A self-contained rounded chip
                    cluster sized to its own content doesn't have that empty
                    right side to begin with. */}
                {activeTab === "posts" && (requirementParts.length > 0 || pinnedPosts.length > 0) && (
                  <div className="mx-5 mt-2 flex w-fit max-w-full items-center gap-2.5 flex-wrap rounded-lg border border-[var(--line)] bg-[var(--bg-soft)]/60 px-3 py-1.5">
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
                  <div className="px-5 py-2 border-t border-[var(--line)]/60 flex items-center justify-between gap-2 flex-wrap">
                    <PostFilterBar
                      filters={filters}
                      onChange={setFilters}
                      authorOptions={topicMembers.map((m) => m.id)}
                      tagOptions={reportTags}
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
                  ) : isOpenchatTopic(activeTopic) ? (
                    /* Openchat rooms carry their own composer built into the
                       flat message stream (Discord's single bottom bar) —
                       ReportComposer's title/sections/images form doesn't
                       apply here at all, so it's skipped entirely, not just
                       hidden. */
                    <OpenchatFeed topic={activeTopic} topicPosts={filteredTopicPosts} onOpenTask={setOpenTaskId} />
                  ) : (
                    <>
                      <ReportFeed
                        topic={activeTopic}
                        topicPosts={filteredTopicPosts}
                        highlightPostId={highlightPostId}
                        highlightReplyId={highlightReplyId}
                        onOpenTask={setOpenTaskId}
                      />
                      <ReportComposer topic={activeTopic} />
                    </>
                  )}
                </>
              ) : (
                <ReportTopicPanels tab={activeTab} topic={activeTopic} topicPosts={topicPosts} />
              )}
            </div>
          ) : (
            <div className="flex-1 rounded-2xl border border-[var(--line)] bg-white flex flex-col items-center justify-center gap-2 text-[var(--ink-soft)]">
              <MessageSquareText className="h-8 w-8" />
              <p className="text-sm">ยังไม่มีหัวข้อ — กด + ทางซ้ายเพื่อเริ่มต้น</p>
            </div>
          )}
        </div>
      </div>

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </div>
  );
}

/** "ที่ฉันต้องส่ง" — a plain room list instead of a post feed (there's
 * nothing posted yet by definition), one row per room this viewer still owes
 * a report to today, jumping straight into it on click. */
function PendingTopicsPanel({
  entries,
  onJumpToTopic,
}: {
  entries: { topicId: string; topicName: string; topicColor: string }[];
  onJumpToTopic: (topicId: string) => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-5 pt-3.5 pb-2.5 flex items-center gap-2.5 border-b border-[var(--line)]/60">
        <span className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-[var(--chart-amber)]">
          <Clock className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold leading-tight">ที่ฉันต้องส่ง</h2>
          <p className="text-xs text-[var(--ink-soft)] leading-tight">ห้องที่คุณยังไม่ได้โพสต์รายงานวันนี้</p>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 bg-[var(--bg-soft)]/40">
          <div className="h-14 w-14 rounded-full bg-[var(--accent)] flex items-center justify-center">
            <Check className="h-6 w-6 text-[var(--brand-green-dark)]" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">ส่งครบทุกห้องแล้ววันนี้</p>
            <p className="text-xs text-[var(--ink-soft)]">ไม่มีห้องที่ต้องส่งรายงานเพิ่มแล้ว</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto bg-[var(--bg-soft)]/40 p-5 space-y-2">
          {entries.map((e) => (
            <button
              key={e.topicId}
              onClick={() => onJumpToTopic(e.topicId)}
              className="w-full flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-left hover:border-[var(--brand-green)]/40 hover:bg-[var(--bg-soft)] transition-colors"
            >
              <span
                className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full"
                style={{ backgroundColor: `color-mix(in srgb, ${e.topicColor} 16%, white)`, color: e.topicColor }}
              >
                <Hash className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{e.topicName}</p>
                <p className="text-xs text-[var(--ink-soft)]">ยังไม่ได้ส่งวันนี้</p>
              </div>
              <span className="shrink-0 text-xs font-medium text-[var(--brand-green-dark)]">ไปที่ห้องนี้ →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The viewer's own สิ่งที่ต้องทำ (see calendar's dedicated tab for the same
 * data) — surfaced here too since Report is where people already check in
 * daily, unlike Calendar which someone might only open to look at meetings.
 * Read/write on the same `todo-store`, so ticking one off here or on the
 * calendar tab shows up in both places immediately. */
function TodoPanel() {
  const todos = useTodoStore((s) => s.todos);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const removeTodo = useTodoStore((s) => s.removeTodo);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);

  const myTodos = todos
    .filter((t) => t.userId === viewingAsUserId)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date));
  const openCount = myTodos.filter((t) => !t.done).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-5 pt-3.5 pb-2.5 flex items-center gap-2.5 justify-between border-b border-[var(--line)]/60">
        <div className="flex items-center gap-2.5">
          <span className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-[var(--chart-amber)]">
            <ListTodo className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold leading-tight">สิ่งที่ต้องทำ</h2>
            <p className="text-xs text-[var(--ink-soft)] leading-tight">
              {myTodos.length === 0 ? "รายการของคุณ" : `เหลือ ${openCount}/${myTodos.length} รายการ`}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1 rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white px-3.5 text-xs"
          onClick={() => {
            setEditingTodo(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          เพิ่ม
        </Button>
      </div>

      {myTodos.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 bg-[var(--bg-soft)]/40">
          <div className="h-14 w-14 rounded-full bg-orange-50 flex items-center justify-center">
            <ListTodo className="h-6 w-6 text-[var(--chart-amber)]" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">ยังไม่มีสิ่งที่ต้องทำ</p>
            <p className="text-xs text-[var(--ink-soft)]">กด &quot;เพิ่ม&quot; ด้านบนเพื่อเริ่มบันทึกรายการแรก</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto bg-[var(--bg-soft)]/40 p-5 space-y-2">
          {myTodos.map((t) => (
            <div
              key={t.id}
              className="group flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4 py-3 hover:border-[var(--brand-green)]/40 transition-colors"
            >
              <button
                onClick={() => toggleTodo(t.id)}
                aria-label={t.done ? "ทำเครื่องหมายว่ายังไม่เสร็จ" : "ทำเครื่องหมายว่าเสร็จแล้ว"}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--chart-amber)]"
                style={t.done ? { backgroundColor: "var(--chart-amber)" } : undefined}
              >
                {t.done && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </button>
              <button
                onClick={() => {
                  setEditingTodo(t);
                  setDialogOpen(true);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <p className={cn("text-sm font-medium truncate", t.done && "line-through text-[var(--ink-soft)]")}>{t.title}</p>
                <p className="text-xs text-[var(--ink-soft)]">
                  {formatDate(t.date)}
                  {t.time && ` · ${t.time}`}
                </p>
              </button>
              <button
                onClick={() => removeTodo(t.id)}
                title="ลบ"
                aria-label={`ลบ "${t.title}"`}
                className="shrink-0 text-[var(--ink-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--chart-red)] transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <AddTodoDialog open={dialogOpen} onOpenChange={setDialogOpen} editingTodo={editingTodo} />
    </div>
  );
}

const todayStatusMeta = {
  posted: { title: "ส่งแล้ววันนี้", icon: CheckCircle2, iconColor: "var(--brand-green-dark)", iconBg: "bg-[var(--accent)]", empty: "ยังไม่มีใครส่งวันนี้" },
  late: { title: "ส่งช้าวันนี้", icon: Clock, iconColor: "var(--chart-amber)", iconBg: "bg-amber-50", empty: "วันนี้ยังไม่มีใครส่งช้า" },
  missing: { title: "ยังไม่ส่งวันนี้", icon: TriangleAlert, iconColor: "var(--chart-red)", iconBg: "bg-red-50", empty: "ส่งครบทุกคนแล้ววันนี้" },
} as const;

/** Where the header's "ส่งแล้ววันนี้/ส่งช้า/ยังไม่ส่ง" pills (H1) actually
 * link to — the people behind that number, grouped by room, instead of
 * dumping the viewer into the unrelated merged feed. */
function TodayStatusPanel({
  status,
  entries,
  onJumpToTopic,
}: {
  status: "posted" | "late" | "missing";
  entries: TodayStatusEntry[];
  onJumpToTopic: (topicId: string) => void;
}) {
  const meta = todayStatusMeta[status];
  const Icon = meta.icon;
  const byTopic = useMemo(() => {
    const groups = new Map<string, { topicName: string; topicColor: string; rows: TodayStatusEntry[] }>();
    for (const e of entries) {
      const g = groups.get(e.topicId) ?? { topicName: e.topicName, topicColor: e.topicColor, rows: [] };
      g.rows.push(e);
      groups.set(e.topicId, g);
    }
    return [...groups.entries()];
  }, [entries]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={cn("shrink-0 px-5 pt-3.5 pb-2.5 flex items-center gap-2.5 border-b border-[var(--line)]/60")}>
        <span className={cn("shrink-0 flex h-8 w-8 items-center justify-center rounded-full", meta.iconBg)} style={{ color: meta.iconColor }}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold leading-tight">{meta.title}</h2>
          <p className="text-xs text-[var(--ink-soft)] leading-tight">{entries.length} คน — จากทุกห้องที่มีรอบตัดยอด</p>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 bg-[var(--bg-soft)]/40">
          <div className={cn("h-14 w-14 rounded-full flex items-center justify-center", meta.iconBg)} style={{ color: meta.iconColor }}>
            <Icon className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold">{meta.empty}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto bg-[var(--bg-soft)]/40 p-5 space-y-4">
          {byTopic.map(([topicId, group]) => (
            <div key={topicId} className="rounded-xl border border-[var(--line)] bg-white overflow-hidden">
              <button
                onClick={() => onJumpToTopic(topicId)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left border-b border-[var(--line)] bg-[var(--bg-soft)] hover:bg-[var(--accent)] transition-colors"
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: group.topicColor }} aria-hidden />
                <span className="flex-1 text-xs font-semibold truncate">{group.topicName}</span>
                <span className="shrink-0 text-[11px] font-medium text-[var(--brand-green-dark)]">ไปที่ห้องนี้ →</span>
              </button>
              <div className="divide-y divide-[var(--line)]">
                {group.rows.map((r) => (
                  <div key={r.userId} className="flex items-center gap-2.5 px-4 py-2">
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{r.userAvatar}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium truncate flex-1">{r.userName}</span>
                    <span className="text-xs text-[var(--ink-soft)] shrink-0">{r.departmentName}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
