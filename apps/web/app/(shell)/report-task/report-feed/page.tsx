"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TopicSidebar, TopicLogo, ALL_TOPICS_ID, PENDING_ID, MENTIONS_ID } from "@/modules/report_task/components/report-feed/topic-sidebar";
import { ReportComposer } from "@/modules/report_task/components/report-feed/report-composer";
import { ReportFeed } from "@/modules/report_task/components/report-feed/report-feed";
import { OpenchatFeed } from "@/modules/report_task/components/report-feed/openchat-feed";
import { ReportAllPostsFeed } from "@/modules/report_task/components/report-feed/report-all-posts-feed";
import { ReportComplianceBar } from "@/modules/report_task/components/report-feed/report-header";
import { RoomSettingsSheet } from "@/modules/report_task/components/report-feed/room-settings-sheet";
import { ReportTopicPanels, collectFiles, collectLinks, filesCutoffMs } from "@/modules/report_task/components/report-feed/report-topic-panels";
import { PostFilterBar, PostFilterButton, ActiveFilterChips, filterPosts, emptyPostFilters, postFiltersActiveCount, type PostFilters } from "@/modules/report_task/components/report-feed/post-filter-bar";
import { filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { Button, buttonVariants } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/modules/report_task/components/ui/sheet";
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
import { ArrowLeft, AtSign, BarChart3, Check, CheckCircle2, ChevronDown, Clock, FileImage, FolderHeart, Hash, Link2, Lock, Menu, MessageSquareText, Pin, Search, Settings, SlidersHorizontal, TriangleAlert, Users, X } from "lucide-react";
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

/** Always an open input on desktop — this only ever renders inside the
 * `hidden lg:flex` desktop row (see its call site), so there's no mobile
 * case to collapse for here (mobile gets its own icon-triggered search
 * separately). A hidden search reachable only by first noticing and
 * clicking a small magnifier icon is exactly the "ซ่อนไว้เป็น icon" the
 * brief flags as a problem — an always-visible input needs no discovery
 * step. Same height as PostFilterButton so the two sit level on the tab row. */
function CompactSearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative shrink-0">
      <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder="ค้นหาในหัวข้อนี้..."
        className="h-[34px] w-[220px] rounded-lg border border-[var(--line)] bg-white pl-8 pr-2 text-sm outline-none focus:border-[var(--brand-green)]/50"
      />
    </div>
  );
}

type TopicTab = "posts" | "files" | "album" | "links" | "stats";
const topicTabs: { id: TopicTab; label: string; icon: typeof MessageSquareText }[] = [
  { id: "posts", label: "โพสต์", icon: MessageSquareText },
  { id: "files", label: "ไฟล์", icon: FileImage },
  { id: "album", label: "รูปภาพ", icon: FolderHeart },
  { id: "links", label: "ลิงก์", icon: Link2 },
  { id: "stats", label: "สรุป", icon: BarChart3 },
];

/**
 * This page renders on the client only — deliberately, and it's worth
 * spelling out why, because it's the opposite of what the rest of the app does.
 *
 * Everything on this page comes from zustand stores that are filled in from
 * `/api/report-task/store/*` after mount (see ServerStoreSync). The server has
 * none of that: it renders the stores' built-in seed data — the "ประกาศทั่วไป"
 * placeholder room, zero posts — which the real data replaces a few hundred
 * milliseconds later. So the server-rendered HTML was never anything a viewer
 * was meant to see; it was a placeholder that had to be thrown away.
 *
 * Two things came out of that. The visible one: the page flashed a room that
 * isn't the room you asked for before settling. The subtle one: React hydrates
 * by re-rendering the same tree in the browser and comparing, and any text on
 * this page that resolves differently there — anything read off the clock,
 * anything derived from an id restored out of localStorage — makes the two
 * copies disagree. React then reports a hydration mismatch (minified error
 * #418), throws the server's HTML away and re-renders the whole tree. That
 * fired on nearly every load of this page in production, and left an error in
 * the console that looked alarming while the page itself worked fine.
 *
 * Gating on `mounted` makes the server and the first browser render produce
 * the exact same thing — the skeleton below — so there is nothing to disagree
 * about, and the real UI renders once, in the browser, with the real data
 * already on its way. It removes the whole class of problem rather than the
 * one instance of it, which is the right trade here precisely because the
 * server render had no value to lose: no SEO (the page is behind a login), no
 * meaningful first paint (it showed the wrong room). A page whose server
 * output is real content should never do this.
 *
 * The Suspense boundary stays: useSearchParams() (the "copy link"
 * ?topic=&post= deep link) requires one around anything that calls it, or
 * `next build` fails to prerender this route at all.
 */
export default function ReportFeedPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <ReportFeedSkeleton />;

  return (
    <Suspense fallback={null}>
      <ReportFeedPageInner />
    </Suspense>
  );
}

/** Placeholder with the same bones as the real layout (header, topic rail,
 *  room panel) so the switch to real content doesn't jump the page around. */
function ReportFeedSkeleton() {
  return (
    <div className="flex flex-col gap-6 h-full animate-pulse" aria-hidden>
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-lg bg-[var(--bg-soft)]" />
        <div className="h-4 w-96 max-w-full rounded bg-[var(--bg-soft)]" />
      </div>
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 flex-1 min-h-0">
        {/* Matches the real layout's now-flat panels (no border/rounded/
            white-card) — this skeleton is what actually renders for the
            first moment of every page load, so leaving the old bordered-card
            look here would flash the "gรอบซ้อนกัน" look right back on every
            visit even after the real content underneath was already fixed. */}
        <div className="hidden lg:block w-64 shrink-0 bg-[color-mix(in_srgb,var(--bg-soft)_55%,white)]" />
        <div className="flex-1 bg-white" />
      </div>
    </div>
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
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
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
  // Desktop-header search (new — not part of PostFilters/filterPosts, and
  // not persisted to the URL like the real filters are). A quick client-side
  // title match, additive on top of whatever filterPosts already returns —
  // doesn't touch any existing filter's behavior.
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
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
    if (selectedId === ALL_TOPICS_ID || selectedId === PENDING_ID || selectedId === MENTIONS_ID) return selectedId;
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
  const activeTopic = useMemo(() => visibleTopics.find((t) => t.id === activeId), [visibleTopics, activeId]);
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
  const filteredTopicPosts = (
    activeTopic ? filterPosts(topicPosts, filters, { topicOf: () => activeTopic, viewingAsUserId }) : topicPosts
  ).filter((p) => !searchQuery.trim() || p.title.toLowerCase().includes(searchQuery.trim().toLowerCase()));

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
    if (!activeId || showAllPosts || showPending || showMentions) return;
    markTopicRead(activeId, viewingAsUserId);
  }, [activeId, showAllPosts, showPending, showMentions, viewingAsUserId, markTopicRead]);

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
      return activeTopic.minImages > 0 ? [{ text: `แนบอย่างน้อย ${activeTopic.minImages} รูปทุกโพสต์`, active: false }] : [];
    }
    const active = currentCutoff(activeTopic.cutoffs);
    const requiredOf = (c: { minImages?: number }) => c.minImages ?? activeTopic.minImages;
    // Two rounds with the same photo requirement and no real (non-placeholder)
    // labels read naturally as one deadline window ("กำหนดส่ง 13:00–14:00
    // น."), which is what §7's own example assumes — but that's an accurate
    // simplification only for exactly this common shape. More rounds,
    // differing requirements, or rounds someone actually named stay spelled
    // out individually below instead, since collapsing those into a range
    // would misstate what's actually required.
    const allSameRequirement = activeTopic.cutoffs.every((c) => requiredOf(c) === requiredOf(activeTopic.cutoffs[0]!));
    const anyRealLabel = activeTopic.cutoffs.some((c) => c.label.trim().length > 2);
    if (activeTopic.cutoffs.length === 2 && allSameRequirement && !anyRealLabel) {
      const [a, b] = activeTopic.cutoffs;
      const required = requiredOf(a!);
      return [
        {
          text: `${a!.time}–${b!.time} น.${required > 0 ? ` · แนบอย่างน้อย ${required} รูป` : ""}`,
          active: !!active,
        },
      ];
    }
    // Per-round overrides can make some rounds require a different photo
    // count — spell each one out, and mark whichever round "now" falls into
    // so posting-right-now context is obvious without doing clock math.
    // "กำหนดส่ง" is NOT repeated per round here (it's said once, in the JSX
    // render below) — rounds with no requirement of their own (like this
    // room's first one) otherwise produced "กำหนดส่ง 13:00 น. · กำหนดส่ง
    // 14:00 น. · แนบอย่างน้อย 1 รูป", repeating the same word for no reason
    // ("ไม่สวยเลย").
    return activeTopic.cutoffs.map((c) => {
      const required = requiredOf(c);
      // A round label of a couple characters or less ("t", "00") is almost
      // always leftover placeholder text from setting the round up, not a
      // real name like "รอบเช้า" — showing it as a stray fragment right
      // before the actual time read as clutter, not useful context
      // ("มันเยอะไปมันรก"). Real, longer labels still show.
      const label = c.label.trim().length > 2 ? c.label.trim() : null;
      return {
        text: `${label ? `${label} ` : ""}${c.time} น.${required > 0 ? ` · แนบอย่างน้อย ${required} รูป` : ""}`,
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
    // No more top banner above the columns (used to be a full-width
    // PageHeader row with the room name + these same pills) — the sidebar
    // and room panel now start right under the page's own top bar, and the
    // pills moved into the sidebar header (headerExtra below), which is the
    // one thing that's always on screen no matter which room is open.
    <div className="flex flex-col gap-4 h-full">
      {/* Below `lg`, "☰ หัวข้อ" opens the topic tree as a full-screen Sheet
          instead of squeezing it into a fixed h-64 block above the feed with
          its own internal scroll (3.5.5) — the `lg:flex` sidebar right below
          is completely untouched at desktop widths. */}
      <div className="lg:hidden">
        {/* Was plain outline text with no hint that tapping it does anything
            — asked explicitly for the top bar to signal what's tappable
            ("แถบบนให้รู้ด้วยว่ากดได้อะไร"). A tinted fill (like every other
            actionable control on this page) plus a trailing chevron. Leads
            with the actual room name now (not the generic word "หัวข้อ"),
            and the chevron points down, not right — a right-pointing chevron
            reads as "go to a new screen" (like the deep-link ones on other
            rows), when this is really a selector that opens in place, the
            same cue a native picker/dropdown uses (§10). */}
        <Button
          variant="outline"
          onClick={() => setMobileTopicsOpen(true)}
          className="w-full justify-start gap-2 bg-[var(--bg-soft)] border-[var(--line)] hover:bg-[var(--accent)]"
        >
          <Menu className="h-4 w-4 shrink-0" />
          <span className="truncate">{activeTopic ? activeTopic.name : "หัวข้อ"}</span>
          <ChevronDown className="h-4 w-4 shrink-0 ml-auto text-[var(--ink-soft)]" />
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

        {/* This panel used to be rounded-2xl + border, matching the topic
            sidebar's own box (see topic-sidebar.tsx) — two adjacent bordered
            white cards, each then holding more cards inside (individual
            posts already have their own border+shadow, report-card.tsx),
            read as stacked framing before any actual content was on screen
            ("กรอบซ้อนกันหลายชั้น"). Dropping the border/radius here leaves
            background contrast to do the separating: white panel next to
            the sidebar's tinted one, then the feed's own soft-gray scroll
            area (report-feed.tsx) under white post cards — one visual tier
            per level instead of every level drawing its own line. */}
        <div className="w-full flex-1 min-w-0 flex flex-col min-h-0 lg:h-full">
          {todayStatusFilter ? (
            <div className="flex-1 min-h-0 bg-white overflow-hidden flex flex-col">
              <TodayStatusPanel
                status={todayStatusFilter}
                entries={todayStatus.filter((e) => e.status === todayStatusFilter)}
                onJumpToTopic={selectView}
                onClose={() => setTodayStatusFilter(null)}
              />
            </div>
          ) : showAllPosts ? (
            <div className="flex-1 min-h-0 bg-white overflow-hidden flex flex-col">
              <ReportAllPostsFeed topics={visibleTopics} posts={posts} onJumpToTopic={selectView} onOpenTask={setOpenTaskId} />
            </div>
          ) : showPending ? (
            <div className="flex-1 min-h-0 bg-white overflow-hidden flex flex-col">
              <PendingTopicsPanel entries={myPending} onJumpToTopic={selectView} />
            </div>
          ) : showMentions ? (
            <div className="flex-1 min-h-0 bg-white overflow-hidden flex flex-col">
              <ReportAllPostsFeed
                topics={visibleTopics}
                posts={mentionPosts}
                title="กล่าวถึงฉัน"
                description="ทุกโพสต์และความคิดเห็นที่มีคนแท็กคุณ เรียงตามเวลา ล่าสุดอยู่ล่างสุด"
                icon={AtSign}
                emptyTitle="ยังไม่มีใครกล่าวถึงคุณ"
                emptyDescription="โพสต์หรือความคิดเห็นที่แท็กคุณด้วย @ จะขึ้นที่นี่"
                onJumpToTopic={selectView}
                onOpenTask={setOpenTaskId}
              />
            </div>
          ) : activeTopic ? (
            <div className="flex-1 min-h-0 bg-white overflow-hidden flex flex-col">
              <div className="shrink-0">
                {/* Row 1 — identity: logo/name/description on the left,
                    member count + settings gear on the right (R1/R4: two
                    fixed rows instead of everything wrapping together with
                    the tabs into whatever fits). flex-wrap (not a strict
                    single line) — member count + mode pill + mini compliance
                    bar + gear all have their own minimum width that doesn't
                    shrink, and on a narrow phone (~375-414px) that add up to
                    more than the screen has even with the name truncated to
                    nothing; without a wrap the rest just ran off-screen with
                    no way to reach it ("มุมมอง: Thread" was literally
                    unreachable, cut off past the right edge). */}
                <div className="px-5 pt-3 pb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <TopicLogo topic={activeTopic} size="h-8 w-8" />
                  {/* Name + description share one line now (not stacked) —
                      matches the reference layout ("# test1
                      รายงานประจำวันของทีม") and keeps row 1 to its single
                      line even with a description present. Still hidden
                      below sm: on a narrow phone this pair plus the mode
                      pill/compliance bar/round row below it stacked into the
                      header eating close to a third of the screen before any
                      actual post came into view
                      ("วงมันเปลืองพื้นที่ไป 1/3 ของหน้าจอ"). */}
                  <div className="min-w-0 flex-1 flex items-baseline gap-2">
                    <h2 className="text-[16px] font-semibold truncate shrink-0 max-w-[60%]">{activeTopic.name}</h2>
                    {activeTopic.description && (
                      <p className="hidden sm:block text-xs text-[var(--ink-soft)] truncate min-w-0">{activeTopic.description}</p>
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
                      control that isn't there for them. Plain text now for
                      everyone, editor included — clicking it to jump into
                      room settings was one more way into settings besides
                      the ⚙ gear, and that's the one and only door in
                      ("บอกทุกตัวให้กดตั้งค่าได้ที่ฟันเฟืองเท่านั้น"). Not a
                      real <select> either way — the mode itself is locked
                      for any room created after FEED_VIEW_MODE_LOCK_CUTOFF
                      (see room-settings-sheet.tsx). */}
                  {/* Round 2, explicit instruction: dropped from the header
                      entirely, not just reworded — it's already reachable in
                      room settings ("รูปแบบการแสดงโพสต์", see
                      room-settings-sheet.tsx), and the header should only
                      carry what's needed to actually use the room right now. */}
                  {/* Today's compliance stats — pushed to the row's own far
                      right (ml-auto carries the gear after it along too)
                      instead of sitting packed right after the mode pill, so
                      it reads as its own distinct "here's what matters right
                      now" block in the corner rather than one more chip in a
                      row of chips ("แถวหัวห้อง มุมขวา แยกเด่นออกมา"). */}
                  <div className="hidden sm:flex items-center gap-1 ml-auto">
                    <ReportComplianceBar
                      variant="mini"
                      visibleTopics={visibleTopics}
                      onJumpToPost={(topicId, postId) => {
                        selectView(topicId);
                        setHighlightPostId(postId);
                      }}
                      onShowTodayStatus={setTodayStatusFilter}
                    />
                  </div>
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

                {/* Row 1.5 — submission-round info, on its own wrapping row
                    instead of squeezed into Row 1's single non-wrapping line
                    with the member count/mode pill/gear. A room with 2+
                    rounds (or just a long custom round label) had nowhere to
                    go there but to overflow or get clipped — plain text, not
                    a button (the old "+1 hidden behind a hover" version read
                    as cryptic, "ดูแล้วงง"), one pill per round so a run-on
                    string of every round's text isn't one indecipherable
                    blob either ("ดูยาก งง"). Changing the rounds themselves
                    is the ⚙ gear's job, not this row's. */}
                {requirementParts.length > 0 && (
                  // Plain inline text — metadata about the room, not a
                  // status to react to, so it stays neutral gray throughout
                  // (no green — this isn't a success state, §7). "กำหนดส่ง"
                  // is said once for the whole row (not repeated per round —
                  // see requirementParts' own comment on why that read badly)
                  // only when there's an actual deadline to name; a
                  // topic with no cutoffs at all just states its image rule
                  // plainly instead. The currently-applicable round still
                  // stands out (medium weight only, not color).
                  <div className="px-5 pb-2 flex items-center gap-1.5 overflow-x-auto text-xs text-[var(--ink-soft)]">
                    <Clock className="h-3 w-3 shrink-0" />
                    {activeTopic.cutoffs.length > 0 && <span className="shrink-0">กำหนดส่ง</span>}
                    {requirementParts.map((r, i) => (
                      <span key={i} className={cn("shrink-0", r.active && "font-medium text-[var(--ink)]")}>
                        {i > 0 && <span className="text-[var(--ink-faint)]"> · </span>}
                        {r.text}
                      </span>
                    ))}
                  </div>
                )}

                {/* Row 3 — tabs, full-width so the underline (`border-b` on
                    the container, `-mb-px` per tab) actually connects to a
                    real line instead of floating (R2), with counts (R5) and
                    proper tab semantics (R6). The tablist itself is
                    `flex-1 min-w-0` with its own overflow-x-auto — tabs
                    scroll on a narrow phone rather than wrapping, so the
                    "ตัวกรอง" button stays pinned on the same line instead of
                    getting shoved onto its own orphan row below (which just
                    looked like disconnected clutter, "งง...จัดให้มันดีๆสิ"). */}
                <div className="px-5 flex items-center gap-2 border-b border-[var(--line)]">
                {/* Round 2, explicit instruction: real labels on every tab
                    at every width, not icon-only below lg. Worth flagging
                    that horizontal scroll here specifically was tried and
                    pulled back once before for a real complaint
                    ("ไม่อยากมีให้เลื่อนไปมา...อยากให้จบเลย") — icon+count
                    alone was what let all 5 tabs fit with nothing to scroll.
                    Bringing the labels back means the scroll comes back too;
                    overflow-x-auto on the tablist itself keeps it contained
                    to just this row rather than pushing the whole page wide. */}
                <div role="tablist" aria-label="ส่วนของหัวข้อ" className="flex flex-1 min-w-0 items-center gap-3 lg:gap-4 overflow-x-auto">
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
                        title={t.label}
                        className={cn(
                          "shrink-0 flex items-center gap-1.5 pb-2 -mb-px border-b-2 text-xs font-medium transition-colors duration-200",
                          active
                            ? "border-[var(--brand-green)] text-[var(--brand-green-dark)]"
                            : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{t.label}</span>
                        {count != null && count > 0 && (
                          <span className="tabular-nums text-[10px] text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-1.5 py-0.5">{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                  {/* Desktop: compact search + the single filter button,
                      right-aligned on the tab row. invisible (not unmounted)
                      on every other tab so switching tabs never shifts this
                      row's height/the content border under it — same reason
                      the old PostFilterBar block did this. */}
                  <div className={cn("hidden lg:flex items-center gap-2 my-1.5", activeTab !== "posts" && "invisible")}>
                    <CompactSearchField value={searchQuery} onChange={setSearchQuery} />
                    <PostFilterButton
                      filters={filters}
                      onChange={setFilters}
                      authorOptions={topicMembers.map((m) => m.id)}
                      tagOptions={reportTags}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => activeTab === "posts" && setMobileSearchOpen((v) => !v)}
                    tabIndex={activeTab === "posts" ? 0 : -1}
                    aria-label="ค้นหาโพสต์"
                    title="ค้นหาโพสต์"
                    className={cn(
                      "lg:hidden ml-auto my-1.5 h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors",
                      mobileSearchOpen || searchQuery
                        ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
                        : "border-[var(--line)] bg-white text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]",
                      activeTab !== "posts" && "invisible"
                    )}
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => activeTab === "posts" && setMobileFilterOpen(true)}
                    tabIndex={activeTab === "posts" ? 0 : -1}
                    className={cn(
                      filterFieldTriggerClass(postFiltersActiveCount(filters) > 0),
                      "lg:hidden my-1.5 !h-8 shrink-0",
                      activeTab !== "posts" && "invisible"
                    )}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                    กรอง
                    {postFiltersActiveCount(filters) > 0 && <span className="tabular-nums">({postFiltersActiveCount(filters)})</span>}
                  </button>
                </div>

                {/* Mobile search — a full-width row of its own instead of
                    squeezing into the tab row (which is already tight with
                    5 icon tabs + search + filter on a narrow phone). Icon
                    trigger above toggles it; typing here drives the same
                    searchQuery the desktop input does. */}
                {mobileSearchOpen && activeTab === "posts" && (
                  <div className="lg:hidden px-5 pb-2 relative">
                    <Search className="h-3.5 w-3.5 absolute left-8 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]" />
                    <input
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setSearchQuery("");
                          setMobileSearchOpen(false);
                        }
                      }}
                      placeholder="ค้นหาโพสต์..."
                      className="h-9 w-full rounded-lg border border-[var(--line)] bg-white pl-8 pr-2 text-sm outline-none focus:border-[var(--brand-green)]/50"
                    />
                  </div>
                )}

                {/* Active-filter chips — only when something's actually
                    filtered, right under the tab row, desktop only (mobile's
                    "ตัวกรอง (N)" button + the sheet's own "ล้างตัวกรอง"
                    already cover this there). Quick way to drop one filter
                    without reopening the popover. */}
                {activeTab === "posts" && postFiltersActiveCount(filters) > 0 && (
                  <div className="hidden lg:flex px-5 pt-2">
                    <ActiveFilterChips filters={filters} onChange={setFilters} authorOptions={topicMembers.map((m) => m.id)} />
                  </div>
                )}

                {/* Same bottom-sheet shell ReportAllPostsFeed's own mobile
                    filter uses (labeled header + "ล้างตัวกรอง", a footer
                    confirm button showing the live result count) — this one
                    used to just drop PostFilterBar's compact chip row in
                    bare, which read as a different, rougher pattern than
                    that page's ("ให้เหมือนหน้าอื่นๆสิ"). */}
                <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
                  <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl lg:hidden">
                    {/* No "ล้างตัวกรอง" up here next to the ✕ close button —
                        the two sat close enough together that people read
                        the X itself as the clear-filter action
                        ("คนเข้าใจผิดคิดว่าล้างตัวกรองให้กดกากบาท"). The chip
                        row below already ends with its own "ล้างตัวกรอง (N)"
                        button, so this was a redundant second copy anyway. */}
                    <SheetHeader className="pb-2 pr-11">
                      <SheetTitle>กรองโพสต์</SheetTitle>
                    </SheetHeader>
                    <div className="px-4 pb-4">
                      <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">แสดงเฉพาะ</p>
                      <PostFilterBar
                        filters={filters}
                        onChange={setFilters}
                        authorOptions={topicMembers.map((m) => m.id)}
                        tagOptions={reportTags}
                        size="lg"
                      />
                    </div>
                    <SheetFooter>
                      <Button
                        className="h-[46px] w-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
                        onClick={() => setMobileFilterOpen(false)}
                      >
                        แสดง {filteredTopicPosts.length} โพสต์
                      </Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>

                {/* Pinned posts only. The "รอบส่งวันนี้" chips that used to
                    share this strip moved up into the room's identity row as a
                    single chip showing the round in force right now — every
                    round spelled out, always on screen, was reference material
                    holding a whole band of height hostage: you need it when
                    you're about to post, not on every scroll past someone
                    else's report. Pinned posts stay here because they are
                    content, not settings — and they're rare, so this row is
                    usually not rendered at all. */}
                {activeTab === "posts" && pinnedPosts.length > 0 && (
                  <div className="mx-5 mt-2 flex w-fit max-w-full items-center gap-2.5 flex-wrap rounded-lg border border-[var(--line)] bg-[var(--bg-soft)]/60 px-3 py-1.5">
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

              </div>

              {activeTab === "posts" ? (
                <>
                  {filteredTopicPosts.length === 0 && topicPosts.length > 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6 bg-[var(--bg-soft)]">
                      {/* Distinct wording from a search miss vs. a filter miss
                          (§41 vs §42) — "ไม่พบผลลัพธ์" alone after typing a
                          search term reads as broken/no-data, when really it
                          just means nothing matched that specific term. */}
                      <p className="text-sm font-semibold">
                        {searchQuery.trim() ? `ไม่พบโพสต์ที่ตรงกับ "${searchQuery.trim()}"` : "ไม่พบโพสต์ตามตัวกรองนี้"}
                      </p>
                      {searchQuery.trim() && <p className="text-xs text-[var(--ink-soft)]">ลองเปลี่ยนคำค้นหา หรือล้างตัวกรอง</p>}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearchQuery("");
                          setFilters(emptyPostFilters);
                        }}
                      >
                        {searchQuery.trim() ? "ล้างการค้นหาและตัวกรอง" : "ล้างทั้งหมด"}
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
            <div className="flex-1 bg-white flex flex-col items-center justify-center gap-2 text-[var(--ink-soft)]">
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
          <h2 className="text-[16px] font-semibold leading-tight">รอฉันส่ง</h2>
          <p className="text-xs text-[var(--ink-soft)] leading-tight">ห้องที่คุณยังไม่ได้โพสต์รายงานวันนี้</p>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 bg-[var(--bg-soft)]">
          <div className="h-14 w-14 rounded-full bg-[var(--accent)] flex items-center justify-center">
            <Check className="h-6 w-6 text-[var(--brand-green-dark)]" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">ส่งครบทุกห้องแล้ววันนี้</p>
            <p className="text-xs text-[var(--ink-soft)]">ไม่มีห้องที่ต้องส่งรายงานเพิ่มแล้ว</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto bg-[var(--bg-soft)] p-5 space-y-2">
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
  onClose,
}: {
  status: "posted" | "late" | "missing";
  entries: TodayStatusEntry[];
  onJumpToTopic: (topicId: string) => void;
  /** This panel replaces the room panel entirely (it's a cross-room view, not
   * "in" any one topic), but nothing in the sidebar changes to show it —
   * without this, the only way out was clicking a sidebar row and hoping
   * it'd stick, which read as broken navigation ("กดเข้าไปแล้วไม่มีให้กด
   * ย้อนกลับ"). */
  onClose: () => void;
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
      <div className={cn("shrink-0 px-3 pt-3.5 pb-2.5 flex items-center gap-2.5 border-b border-[var(--line)]/60")}>
        <button
          onClick={onClose}
          aria-label="ย้อนกลับ"
          title="ย้อนกลับ"
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className={cn("shrink-0 flex h-8 w-8 items-center justify-center rounded-full", meta.iconBg)} style={{ color: meta.iconColor }}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold leading-tight">{meta.title}</h2>
          <p className="text-xs text-[var(--ink-soft)] leading-tight">{entries.length} คน — จากทุกห้องที่มีรอบตัดยอด</p>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 bg-[var(--bg-soft)]">
          <div className={cn("h-14 w-14 rounded-full flex items-center justify-center", meta.iconBg)} style={{ color: meta.iconColor }}>
            <Icon className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold">{meta.empty}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto bg-[var(--bg-soft)] p-5 space-y-4">
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
