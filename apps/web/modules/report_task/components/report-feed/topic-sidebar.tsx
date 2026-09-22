"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/modules/report_task/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/modules/report_task/components/ui/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { useReportFeedStore, topicColors, type ReportTopic, type ReportPost } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useSettingsAccessStore } from "@/modules/report_task/store/settings-access-store";
import { canEditReportTopic, canManageReportTopics, canSeeRoomSubmissionStatus } from "@/modules/report_task/lib/permissions";
import { holdServerSync } from "@/modules/report_task/lib/sync-pause";
import { useTourStore, tourStepsByPage } from "@/modules/report_task/store/tour-store";
import { uploadCompressedImage } from "@/modules/report_task/lib/image-resize";
import { useIsMobile } from "@/modules/report_task/hooks/use-is-mobile";
import { postMentionsUser } from "@/modules/report_task/lib/report-feed-mentions";
import { aboutMeCountInPost } from "@/modules/report_task/lib/report-feed-activity";
import { roundsForUserOnDay, attributePostToRound, effectiveRoundsOf, roundRunsOnDay } from "@/modules/report_task/lib/submission-rounds";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { isExemptDate } from "@/modules/report_task/lib/report-feed-exemptions";
import { todayIso, localDateStr } from "@/modules/report_task/lib/now";
import { safeLocalStorage } from "@/modules/report_task/lib/safe-storage";
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";
import {
  AtSign,
  Bell,
  BellOff,
  Briefcase,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ChevronUp,
  Code2,
  Crown,
  Eye,
  EyeOff,
  Flag,
  GripVertical,
  Hash,
  Headset,
  ImagePlus,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Rocket,
  Settings2,
  ShoppingCart,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

// A little "logo" per room instead of a flat hash mark. Priority: a custom
// uploaded image wins > an explicitly picked icon > a department-derived
// icon for rooms scoped to exactly one department > a plain hash.
const departmentIcon: Record<string, LucideIcon> = {
  "dep-eng": Code2,
  "dep-design": Palette,
  "dep-marketing": Megaphone,
  "dep-sales": ShoppingCart,
  "dep-ops": Settings2,
  "dep-support": Headset,
};

const iconOptions: { key: string; icon: LucideIcon }[] = [
  { key: "hash", icon: Hash },
  { key: "megaphone", icon: Megaphone },
  { key: "code", icon: Code2 },
  { key: "palette", icon: Palette },
  { key: "cart", icon: ShoppingCart },
  { key: "settings", icon: Settings2 },
  { key: "headset", icon: Headset },
  { key: "crown", icon: Crown },
  { key: "star", icon: Star },
  { key: "flag", icon: Flag },
  { key: "rocket", icon: Rocket },
  { key: "briefcase", icon: Briefcase },
  { key: "message", icon: MessageSquare },
  { key: "bell", icon: Bell },
];
const iconByKey: Record<string, LucideIcon> = Object.fromEntries(iconOptions.map((o) => [o.key, o.icon]));

export function TopicLogo({ topic, size = "h-6 w-6" }: { topic: ReportTopic; size?: string }) {
  if (topic.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={topic.logoUrl} alt="" className={cn("relative shrink-0 rounded-full object-cover", size)} />
    );
  }
  // Assigned via a plain ternary (not a helper function call) so the React
  // Compiler can statically see this always resolves to one of the module-
  // level icon constants, not a freshly-created component.
  const deptIds = topic.visibility?.departmentIds;
  const Icon: LucideIcon = topic.icon
    ? (iconByKey[topic.icon] ?? Hash)
    : deptIds?.length === 1
      ? (departmentIcon[deptIds[0] ?? ""] ?? Hash)
      : topic.visibility?.managerOnly
        ? Crown
        : Hash;
  // Round 2, explicit instruction: neutral by default — every topic's own
  // arbitrary color (pink/purple/orange/teal/red, picked just to tell rooms
  // apart) painted a different-colored icon per room with no actual meaning
  // behind which room got which color. Color is reserved for states that
  // mean something now (selected = primary, via the row's own accent —
  // see renderTopicRow — not this icon).
  return (
    <span className={cn("relative shrink-0 rounded-full flex items-center justify-center bg-[var(--bg-soft)]", size)}>
      <Icon className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
    </span>
  );
}

/** Selecting this instead of a real topic id switches the main panel to the merged "ภาพรวมทั้งหมด" feed (see report-all-posts-feed.tsx) — a sentinel rather than a real topic since it isn't one. */
export const ALL_TOPICS_ID = "__all__";
/** Rooms this viewer hasn't posted to yet today, judged against each room's own cutoffs/required weekdays (same rule report-topic-panels.tsx's "ยังไม่ส่งวันนี้" KPI uses) — see PendingTopicsPanel in page.tsx. */
export const PENDING_ID = "__pending__";
/** Every post/reply anywhere this viewer can see that @mentions them, newest first — reuses ReportAllPostsFeed with a pre-filtered post list. */
export const MENTIONS_ID = "__mentions__";
type Editor = { mode: "create" } | { mode: "edit"; topic: ReportTopic };

// Per-browser, not shared team state (same reasoning/pattern as page.tsx's
// own topicSidebarCollapsed) — which top-level rooms are folded shut is a
// pure viewing convenience, so localStorage instead of the server-synced
// report-feed-store. Without this, every page refresh silently re-expanded
// everything ("ยุบไว้ พอรีเฟรชแล้วมันมาเปิดทั้งหมดเลย") since the collapsed
// set lived only in this component's own React state.
const COLLAPSED_TOPIC_IDS_KEY = "report_task.collapsedTopicIds";
function loadCollapsedTopicIds(): Set<string> {
  try {
    const raw = safeLocalStorage.getItem(COLLAPSED_TOPIC_IDS_KEY);
    if (typeof raw !== "string" || !raw) return new Set();
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}
function saveCollapsedTopicIds(ids: Set<string>) {
  safeLocalStorage.setItem(COLLAPSED_TOPIC_IDS_KEY, JSON.stringify([...ids]));
}

function isTopLevel(t: ReportTopic) {
  return !t.parentId;
}

/** Whether `candidateId` sits anywhere under `ancestorId` in the parentId
 * chain — used to keep the edit dialog's "หัวข้อนี้อยู่ภายใต้หัวข้อหลักไหน?"
 * picker from ever offering one of the topic's OWN descendants as its new
 * parent. `parentOptions` used to only exclude the topic itself, not its
 * descendants, so editing e.g. "GL Chats" and picking its own child
 * "management-gl" as GL Chats' new parent was a real, reachable way to
 * create a parentId cycle (GL Chats under management-gl, which is already
 * under GL Chats) with no guard at all — unlike drag reorder, which already
 * checks this. Once that cycle exists, every recursive tree walk
 * (childrenOf/renderTopicSubtree, topicDepth) loops forever on it, hanging
 * the whole tab on the next render, drag or no drag ("ค้างจริง ต้องรีเฟรช"
 * — "ปัญหานี้พึ่งมาตอนแก้แก้ไขห้องเอง"). The `seen` set guards this walk
 * itself the same way, in case a cycle already exists from before this fix. */
function isDescendantOf(candidateId: string, ancestorId: string, byId: Map<string, ReportTopic>): boolean {
  const seen = new Set<string>();
  let cur = byId.get(candidateId);
  while (cur?.parentId) {
    if (cur.parentId === ancestorId) return true;
    if (seen.has(cur.parentId)) return false;
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return false;
}

/** 0 = top-level, 1 = sub-topic, 2 = sub-of-sub — walks up `parentId` until
 * it runs out (or hits a topic not in `byId`, e.g. one this viewer can't
 * see, which just stops the count there rather than throwing). Used to cap
 * nesting at 3 tiers total (see `parentOptions` below) — deeper than MS
 * Teams' own 2, since a flat "daily/weekly/monthly" sub-topic layer under
 * each room was the actual ask ("อยากได้ย้อยไปย้อยอีกที"). */
function topicDepth(t: ReportTopic, byId: Map<string, ReportTopic>): number {
  let depth = 0;
  let cur = t;
  // `seen` catches a corrupted parentId chain that loops back on itself
  // (A's parent is B, B's parent is A, or deeper) — should never happen
  // given the guards where parentId gets set (drag reorder, the edit
  // dialog's parent picker), but this function runs on every render for
  // every topic, so if it ever DID happen, an unguarded `while (cur.parentId)`
  // here would recurse forever and hang the whole tab, not just misreport a
  // depth. Bail out to whatever depth was reached so far instead.
  const seen = new Set<string>([t.id]);
  while (cur.parentId) {
    if (seen.has(cur.parentId)) break;
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    seen.add(cur.parentId);
    depth += 1;
    cur = parent;
  }
  return depth;
}

export function TopicSidebar({
  topics: topicsProp,
  activeId,
  onSelect,
  fillHeight,
  onOpenSettings,
  onCollapse,
}: {
  /** Pre-filtered to what this viewer can see — see canSeeReportTopic in the parent page. */
  topics: ReportTopic[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Full height instead of the desktop-layout's fixed `h-64`/`lg:h-full`
   * split — for reuse inside the mobile topics Sheet (3.5.5), which already
   * gives it a definite height of its own to fill. */
  fillHeight?: boolean;
  /** Opens the *full* room settings sheet (feedViewMode, post permissions,
   * cutoffs, reminders, ...) for a topic straight from its row menu here —
   * previously the only way in was the ⚙ icon next to the room title,
   * which meant opening the room first. This menu's own "แก้ไขหัวข้อ" item
   * is a lighter dialog (name/color/icon only), kept as-is alongside this. */
  onOpenSettings?: (id: string) => void;
  /** Renders the "«" collapse button in the header when given — the desktop
   * report-feed layout passes this; the mobile topics Sheet (already its own
   * dismissible surface) doesn't, so it never shows a redundant collapse
   * control. */
  onCollapse?: () => void;
}) {
  const posts = useReportFeedStore((s) => s.posts);
  const addTopic = useReportFeedStore((s) => s.addTopic);
  const removeTopic = useReportFeedStore((s) => s.removeTopic);
  const updateTopicSettings = useReportFeedStore((s) => s.updateTopicSettings);
  const moveTopic = useReportFeedStore((s) => s.moveTopic);
  const submitterGroups = useReportFeedStore((s) => s.submitterGroups);
  const toggleFavoriteTopic = useReportFeedStore((s) => s.toggleFavoriteTopic);
  const toggleHiddenTopic = useReportFeedStore((s) => s.toggleHiddenTopic);
  const setNotifyPreference = useReportFeedStore((s) => s.setNotifyPreference);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // Leave/holiday/routine day-off dates — so a room's ⏰ hover status doesn't
  // nag someone to send a report on a day they're legitimately off, matching
  // the same exemption already honored by the report-feed's own compliance
  // pills (dayComplianceStatus etc.).
  const complianceExemptions = useReportComplianceExemptions();
  const settingsGrants = useSettingsAccessStore((s) => s.grants);
  // Creating/deleting a topic (either level) is CEO-only by default — the
  // CEO can delegate it to specific employees via the "สร้าง/ลบหัวข้อ Report"
  // grant (settings ▸ สิทธิ์การเข้าถึง), same delegation pattern as every
  // other owner-only company setting.
  const canManageTopics = canManageReportTopics(viewingAsUserId, settingsGrants);
  // The star button is normally hover-only (opacity-0 until group-hover) —
  // the tour spotlight can't hover, so force it visible while its step is
  // the active one.
  const tourOnStarStep = useTourStore((s) => s.active && s.page === "/report-feed" && tourStepsByPage[s.page]?.[s.stepIndex]?.target === "topic-star");

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  // Opening this dialog right after a fast/double-click elsewhere (e.g. the
  // quick + on a topic row) can leave the browser mid text-selection —
  // autoFocus alone doesn't clear that, so the name field could come up with
  // its whole default value pre-selected/highlighted for no reason the user
  // did on purpose ("ปัญหานี้พึ่งมาตอนแก้ไขห้อง...เช็คดูดีๆสิ"). Explicitly
  // collapse the cursor to the end whenever this field mounts, overriding
  // whatever selection state it inherited.
  useEffect(() => {
    if (!editor) return;
    const el = nameInputRef.current;
    if (!el) return;
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [editor]);
  const [color, setColor] = useState(topicColors[0]!);
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  // Set only when this "create" session started from a specific topic row's
  // quick + button (openCreate(t.id)) — not from the general "+ หัวข้อใหม่".
  // Locks the "เลือกห้องหลักที่จะซ้อนเข้าไป" picker below to that one topic
  // instead of still showing every top-level topic in the company to pick
  // from ("เลือกได้ทุกห้องเลยมันเยอะเกินไป") — the button already committed to
  // "a sub-topic under THIS one", so re-showing the full picker just invited
  // picking a different parent by mistake, defeating the point of the quick
  // button in the first place ("ไม่ต้องมาหาในดรอปดาวน์" — see its own comment).
  const [quickCreateParentId, setQuickCreateParentId] = useState<string | undefined>(undefined);
  // Which department groups are collapsed in the "ห้องย่อย ชั้น 2" parent
  // picker — company-wide, every sub-topic flattened by department read as
  // too much to scan through even after grouping them
  // ("กดยุบย่อได้นะ ถ้าอยากดูหมวดไหนไม่อยากดูหมวดไหนอะ แบบปิดเปิดได้"). Starts
  // empty (all expanded), same default the sidebar's own tree uses.
  const [collapsedSubParentGroups, setCollapsedSubParentGroups] = useState<Set<string>>(new Set());
  function toggleSubParentGroupCollapsed(parentName: string) {
    setCollapsedSubParentGroups((prev) => {
      const next = new Set(prev);
      if (next.has(parentName)) next.delete(parentName);
      else next.add(parentName);
      return next;
    });
  }
  const [description, setDescription] = useState("");
  // Create-only: an explicit three-way choice instead of a dropdown
  // defaulting to "none" — "หัวข้อหลัก" (brand-new top-level topic),
  // "หัวข้อย่อย" (nested under an existing top-level topic), or "หัวข้อย่อย
  // ในหัวข้อย่อย" (nested under an existing sub-topic — the 3rd tier).
  // Splitting "sub" into two explicit buttons instead of one button plus a
  // dropdown that silently changes what tier you land on ("ต้องมี 3 ล็อคให้
  // เลือกสิ") — each button's own parent picker only ever lists options at
  // the one tier that button actually means, so there's nothing to infer
  // from which row got picked. Buttons force back to "main" when there's
  // nothing eligible to nest under yet at that tier.
  const [createKind, setCreateKind] = useState<"main" | "sub" | "subsub">("main");
  // Create-only, same as createKind — chosen once here and never surfaced
  // again as an editable field for this room afterward (see room-settings-
  // sheet.tsx and feedViewMode's own comment on ReportTopic).
  // "threads" pre-selected (not locked — still switchable to Openchat before
  // hitting "สร้างหัวข้อ") for every tier, main topic or sub-topic alike —
  // matches what the team actually picks most of the time now, so the
  // common case doesn't need an extra click every time.
  const [feedViewMode, setFeedViewMode] = useState<"stream" | "threads">("threads");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Collapsed = chevron pointing right, hiding the sub-topics — every
  // top-level topic starts expanded so a first-time viewer sees the
  // Teams-style hierarchy immediately instead of a wall of collapsed rows,
  // unless a previous visit (this browser) left some folded shut — see
  // loadCollapsedTopicIds' own comment.
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<Set<string>>(loadCollapsedTopicIds);
  function toggleCollapsed(id: string) {
    setCollapsedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsedTopicIds(next);
      return next;
    });
  }

  // 1) จัดลำดับห้อง (drag reorder) — every row is draggable all the time now
  // (canManageTopics-permitted), no separate "enter reorder mode" step to
  // click through first ("อยากกดและลากแก้ไขได้แบบดิสครอด...ไม่ต้องกดปุ่มก่อน").
  // Still staged, not live: the first drag/▲▼ starts `pendingTopics`, a local
  // working copy — nothing reaches the real store (moveTopic/
  // updateTopicSettings) until "เสร็จ" actually commits it, and those two
  // buttons only show up once something's staged (see the header). Used to
  // write on every single click instead, which read as sluggish ("กดแล้วจะ
  // สลับค้าง" — each click really was a live save/sync round-trip) and,
  // worse, meant a drag was already permanent the instant you made it —
  // refreshing before ever pressing "เสร็จ" still showed the moved position
  // ("ยังไม่กดเสร็จเลยนะ"), with no way to back out short of manually
  // dragging everything back by hand. "ยกเลิก" now just drops
  // `pendingTopics` untouched — since nothing was ever written, there's
  // nothing to revert.
  const [reorderMode, setReorderMode] = useState(false);
  const [pendingTopics, setPendingTopics] = useState<ReportTopic[] | null>(null);
  // Every read of `topics` below (grouping, ordering, drag targets, the lot)
  // transparently sees the staged copy whenever one's pending — otherwise
  // the real, saved list. No call site elsewhere in this component needs to
  // know which one it's looking at.
  const topics = reorderMode && pendingTopics ? pendingTopics : topicsProp;
  // An explicit mode again, entered from the ⠿ button in the header —
  // dragging only works once you're in it, and nothing is saved until
  // "เสร็จ" ("แก้ให้มีกดปุ่มแก้ไขแบบเดิม และก็กดถึงจะลากได้...พอกดผิดก็กด
  // ยกเลิก"). Briefly tried making every row draggable at all times with no
  // mode to enter first; putting it back behind a deliberate button also
  // means a stray drag on a room you only meant to click can't quietly
  // reshape the sidebar.
  const editingOrder = reorderMode && canManageTopics;
  const [draggedTopicId, setDraggedTopicId] = useState<string | null>(null);
  // Discord-style drop feedback while dragging over another row: a thin
  // green line above/below it for "become a sibling here", or a highlighted
  // ring around the whole row for "nest inside this one" — the *only* way to
  // rejoin a topic as a child once it's out (dropping ON the parent's own
  // row used to always mean "become its sibling," so a topic dragged out
  // with no siblings left under that parent had nowhere left to drop it back
  // in — "ย้ายออกมาแล้วย้ายกลับเข้าไปไม่ได้"). Purely visual/hit-testing state,
  // never touches `topics` itself.
  const [dropIndicator, setDropIndicator] = useState<{ id: string; position: "before" | "after" | "into" } | null>(null);
  // `dragover` fires continuously while the pointer moves — far more often
  // than once a frame — and every setDropIndicator from it re-renders this
  // whole sidebar (~every row, each doing its own childrenOf/filter work).
  // Worse, that re-render mutates the very row the pointer is over (the
  // indicator line is a child node of it), which makes the browser fire
  // more drag events at it, which re-renders again: a render→event→render
  // feedback loop that pins the main thread and reads as the tab freezing
  // mid-drag until a refresh ("พอจะกดลากก็ค้าง"). These two refs coalesce
  // all of that down to at most ONE state update per animation frame, so
  // the handler itself never re-renders anything synchronously.
  const dropIndicatorFrame = useRef<number | null>(null);
  const dropIndicatorNext = useRef<{ id: string; position: "before" | "after" | "into" } | null>(null);
  // Pointer-events drag, not browser-native HTML5 draggable — see the big
  // effect below (right after `topicById`) for why: native drag depends on
  // the browser firing `dragend` back on the exact DOM node a drag started
  // from, and any React re-render that remounts that node instead of
  // updating it in place (a drop reshaping the tree, a store update landing
  // mid-drag, ...) means that event never comes — the drag reads as "stuck"
  // forever with the row dimmed and the whole page unresponsive until a
  // refresh, and zero console error, because nothing actually threw
  // ("กดลากแล้วค้าง...ไม่มีอะไรขึ้นเลย" — this was never a JS exception, it's
  // the browser's own native-drag state machine waiting on an event that
  // will never fire). A handful of narrower patches over time (opacity-40
  // stuck-row fix, the rAF-coalesced dropIndicator below, the sync-hold
  // above) each closed one specific way that could happen — this replaces
  // the fragile foundation itself instead of the next patch. Global
  // pointerup/pointercancel listeners always fire and always clear state,
  // regardless of what got remounted, because they're not tied to any one
  // row's DOM node. Same code path drives mouse AND touch, which also
  // happens to fix drag never having worked on touch at all (native
  // draggable has no touch equivalent — the ▲▼ buttons were the only
  // touch-friendly way to reorder before this).
  const dragCandidateRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const draggedTopicIdRef = useRef<string | null>(null);
  // Reorder is staged locally (pendingTopics), so the background sync poll
  // can't tell an edit is in progress and would happily replace `topics`
  // out from under a drag every 4s — which both re-renders the row being
  // dragged (killing the native drag: its `dragend` never fires, the row
  // stays stuck dimmed) and stalls the main thread parsing the whole feed
  // payload right as someone is trying to drop. Hold the poll off for as
  // long as this session is open; saving still works normally, and the
  // hold is released on "เสร็จ"/"ยกเลิก" or if this unmounts mid-edit.
  useEffect(() => {
    if (!reorderMode) return;
    return holdServerSync();
  }, [reorderMode]);
  // Which room's ⏰ tooltip is open on mobile — base-ui's Tooltip only reacts
  // to hover/focus, neither of which a tap produces on touch, so tapping the
  // badge used to do nothing there at all ("กดนาฬิกาแล้วไม่มีอะไรขึ้นเลย").
  // Controlled per-row on mobile only; desktop still gets the default hover
  // behavior (see the Tooltip below).
  const [openClockRowId, setOpenClockRowId] = useState<string | null>(null);

  function orderKey(t: ReportTopic): number {
    return t.order ?? new Date(t.createdAt).getTime();
  }
  function byOrder(a: ReportTopic, b: ReportTopic): number {
    return orderKey(a) - orderKey(b);
  }

  /** Reindexes one sibling group (same parentId) to 0..n-1 after `movedId`
   * lands in `orderedList` — staged into `pendingTopics` only, nothing
   * written to the real store yet (see commitPendingOrder, fired by "เสร็จ"). */
  function applyLocalReorder(newParentId: string | undefined, orderedList: ReportTopic[], movedId: string) {
    const patchById = new Map<string, Partial<ReportTopic>>();
    orderedList.forEach((t, i) => {
      if (t.id === movedId) patchById.set(t.id, { parentId: newParentId, order: i });
      else if (t.order !== i || t.parentId !== newParentId) patchById.set(t.id, { order: i });
    });
    setPendingTopics((prev) => (prev ?? topicsProp).map((t) => (patchById.has(t.id) ? { ...t, ...patchById.get(t.id) } : t)));
  }

  /** Fired once, by "เสร็จ" — diffs the staged copy against what's actually
   * saved and writes only what really changed. Logs the activity entry only
   * for a topic whose parentId itself changed (via moveTopic); everything
   * that merely got renumbered by the shift uses the quieter
   * updateTopicSettings, so leaving a whole group re-sorted never spams the
   * log with every sibling that just shifted position. */
  function commitPendingOrder() {
    if (!pendingTopics) return;
    const originalById = new Map(topicsProp.map((t) => [t.id, t] as const));
    for (const t of pendingTopics) {
      const original = originalById.get(t.id);
      if (!original || (original.parentId === t.parentId && original.order === t.order)) continue;
      if (original.parentId !== t.parentId) {
        moveTopic(t.id, { parentId: t.parentId, order: t.order ?? 0 }, viewingAsUserId);
      } else {
        updateTopicSettings(t.id, { order: t.order ?? 0 });
      }
    }
  }

  /** How many extra tiers hang below `id` — 0 for a leaf, 1 if its children
   * are themselves all leaves. The 3-tier cap means this is only ever 0 or 1
   * in practice (a depth-2 topic can never have children of its own to begin
   * with — reorderByDrop's own depth check already prevents that), but this
   * walks it for real with its own cycle guard rather than assuming, same
   * reasoning as topicDepth's own `seen` set. */
  function subtreeExtraDepth(id: string, seen: Set<string> = new Set()): number {
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = topics.filter((t) => t.parentId === id);
    if (kids.length === 0) return 0;
    return 1 + Math.max(...kids.map((k) => subtreeExtraDepth(k.id, seen)));
  }

  /** Drop `draggedId` next to `targetId`, joining whatever sibling group
   * `targetId` itself belongs to — dropping on a top-level room's row makes
   * the dragged room top-level too (parentId undefined), dropping on a
   * sub-topic's row joins that sub-topic's parent. A room's own children (if
   * any) come along for the ride, so the 3-tier cap has to hold for the
   * *deepest* one of those after the move, not just for the dragged room
   * itself — see subtreeExtraDepth above. */
  function reorderByDrop(draggedId: string, targetId: string, position: "before" | "after" | "into") {
    if (draggedId === targetId) return;
    const dragged = topics.find((t) => t.id === draggedId);
    const target = topics.find((t) => t.id === targetId);
    if (!dragged || !target) return;
    // "into" (dropped on the middle band of a row, see the dragOver handler
    // below) nests the dragged topic as target's own child instead of its
    // sibling — the only way back in once a topic's been dragged out to
    // become a sibling of its old parent, since dropping on the *parent's*
    // row always meant "join the parent's own siblings," never "become its
    // child" ("ย้ายออกมาแล้วย้ายกลับเข้าไปไม่ได้").
    const newParentId = position === "into" ? targetId : target.parentId;
    // Same 3-tier cap as the create dialog, but checked against the whole
    // subtree that's moving, not just the dragged room's own new depth —
    // used to block moving ANY room with children at all, full stop
    // ("ย้ายห้องที่มีลูกไปเป็นลูกห้องอื่นไม่ได้เลย ต้องย้ายลูกออกทีละตัวก่อน"),
    // which is stricter than the cap actually requires: moving a room and
    // its own children under another *top-level* room keeps every one of
    // them at the exact same depth they already had.
    if (newParentId) {
      const newDraggedDepth = position === "into" ? topicDepth(target, topicById) + 1 : topicDepth(target, topicById);
      if (newDraggedDepth + subtreeExtraDepth(draggedId) > 2) return;
    }
    // Walk newParentId's own ancestor chain and refuse the drop if it ever
    // leads back to draggedId — dropping a topic onto one of its own
    // descendants would reparent it under itself, and every recursive
    // tree-walk below (childrenOf/renderTopicBranch, hasUnreadDescendant,
    // topicDepth) then recurses forever the next time it runs, hanging the
    // whole tab, not just this row ("ค้างทั้งเว็บเลย" — far worse than the
    // row just staying visually stuck). The `seen` set also keeps this walk
    // itself from looping forever against already-bad data.
    if (newParentId) {
      const seen = new Set<string>();
      let cursor: ReportTopic | undefined = topics.find((t) => t.id === newParentId);
      while (cursor) {
        if (cursor.id === draggedId) return;
        if (!cursor.parentId || seen.has(cursor.parentId)) break;
        seen.add(cursor.parentId);
        cursor = topics.find((t) => t.id === cursor!.parentId);
      }
    }
    const siblings = topics.filter((t) => t.parentId === newParentId && t.id !== draggedId).sort(byOrder);
    let insertAt: number;
    if (position === "into") {
      // Lands last among target's existing children — simplest, predictable
      // spot; drag it again afterward (▲▼ or another drop) to reorder within
      // that group same as any other sibling.
      insertAt = siblings.length;
    } else {
      const targetIndex = siblings.findIndex((t) => t.id === targetId);
      if (targetIndex === -1) return;
      insertAt = position === "before" ? targetIndex : targetIndex + 1;
    }
    const nextSiblings = [...siblings.slice(0, insertAt), dragged, ...siblings.slice(insertAt)];
    applyLocalReorder(newParentId, nextSiblings, draggedId);
  }

  /** ▲▼ fallback — swaps `t` with its previous/next sibling (same parentId), then reindexes the group the same way a drag-drop does. */
  function moveTopicStep(t: ReportTopic, direction: -1 | 1) {
    const siblings = topics.filter((x) => x.parentId === t.parentId).sort(byOrder);
    const idx = siblings.findIndex((x) => x.id === t.id);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= siblings.length) return;
    const reordered = [...siblings];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(swapIdx, 0, moved!);
    applyLocalReorder(t.parentId, reordered, t.id);
  }

  // `defaultParentId` lets a top-level topic's own row jump straight into
  // "create a sub-topic here" (see the quick + button in renderTopicRow) —
  // same dialog either way, just pre-set to "หัวข้อย่อย" with the parent
  // already picked.
  function openCreate(defaultParentId?: string) {
    setEditor({ mode: "create" });
    setName("");
    setColor(topicColors[topics.length % topicColors.length]!);
    setIcon(undefined);
    setLogoUrl(undefined);
    setParentId(defaultParentId);
    setQuickCreateParentId(defaultParentId);
    setDescription("");
    setCreateKind(defaultParentId ? "sub" : "main");
    setFeedViewMode("threads");
  }

  function openEdit(t: ReportTopic) {
    setEditor({ mode: "edit", topic: t });
    setName(t.name);
    setColor(t.color);
    setIcon(t.icon);
    setLogoUrl(t.logoUrl);
    setParentId(t.parentId);
    setDescription(t.description ?? "");
  }

  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      setLogoUrl((await uploadCompressedImage(file, 256, 0.85)).url);
    } catch {
      toast.error("อัปโหลดโลโก้ไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const trimmedDescription = description.trim() || undefined;
    // "หัวข้อย่อย"/"หัวข้อย่อยในหัวข้อย่อย" mode always needs a parent picked —
    // the submit button is disabled until one is, so this is just the last
    // line of defense.
    if (editor?.mode === "create" && createKind !== "main" && !parentId) return;
    const effectiveParentId = editor?.mode === "create" && createKind === "main" ? undefined : parentId;
    // Sub-topics are text-only (no custom icon/logo) — strip both on save
    // regardless of leftover local state, rather than trusting the icon
    // section to have stayed hidden the whole time it was set.
    const effectiveIcon = effectiveParentId ? undefined : icon;
    const effectiveLogoUrl = effectiveParentId ? undefined : logoUrl;
    if (editor?.mode === "edit") {
      updateTopicSettings(editor.topic.id, {
        name: trimmed,
        color,
        icon: effectiveIcon,
        logoUrl: effectiveLogoUrl,
        parentId: effectiveParentId,
        description: trimmedDescription,
      });
      setEditor(null);
    } else {
      // A sub-topic starts scoped the same as its parent (e.g. "ฝ่ายขาย"
      // limited to its own department) instead of defaulting to wide-open
      // visibility — a fresh child of a department-scoped room showing up
      // company-wide read as broken, not "override it yourself later" (which
      // is still exactly what the settings page is for, just as a starting
      // point instead of from scratch).
      const parentVisibility = effectiveParentId ? topics.find((t) => t.id === effectiveParentId)?.visibility : undefined;
      const id = addTopic({
        name: trimmed,
        color,
        icon: effectiveIcon,
        logoUrl: effectiveLogoUrl,
        parentId: effectiveParentId,
        description: trimmedDescription,
        visibility: parentVisibility,
        // "stream" is the undefined-equivalent default (see feedViewMode's
        // own comment) — stored as undefined here too so a newly-created
        // Openchat room looks identical to any pre-existing stream room,
        // not a different value that happens to mean the same thing.
        feedViewMode: feedViewMode === "stream" ? undefined : "threads",
        // Back on for "ห้องใหม่แยกอิสระ" — a top-level topic is the
        // department-style header (matches "General Worker": a pure
        // organizing folder, never itself a room to post in), while the
        // auto-created a-talk/daily-report/weekly-report/monthly-report
        // structure below are the actual postable rooms under it.
        isCategory: createKind === "main" ? true : undefined,
        byUserId: viewingAsUserId,
      });
      // Fixed literal names (never derived from the new topic's own name) —
      // matches the hand-built reference this mirrors (General Worker >
      // daily-report > weekly-report, monthly-report). The requested
      // default is "always," not opt-in: unwanted rooms get deleted same as
      // any other room, and more can be added the normal way if these
      // aren't enough. No more auto "a-talk" alongside it — just the report
      // structure itself ("เวลาสร้างหัวข้อใหม่ให้เอา a-talk ออกเลย เอาเหลือไว้
      // แค่ report").
      //
      // Only a depth-0 ("main") topic gets the auto-scaffold — it's a pure
      // category (isCategory, can't hold posts of its own, see above), so
      // creating one bare would leave it with nothing to actually open;
      // it has two tiers of room left under the 3-tier cap (topicDepth's own
      // doc) for the full nested shape: daily-report one tier down,
      // weekly-report/monthly-report nested a further tier under it. A
      // "sub"/"subsub" topic IS itself a real, postable room the moment
      // it's created — auto-filling it with more rooms nobody asked for was
      // never wanted there ("ไม่ต้องสร้างแบบนี้สิ เอาแค่สร้างห้องนั้นมาเลย"),
      // it only made sense for the category case above.
      if (createKind === "main") {
        const dailyId = addTopic({
          name: "daily-report",
          color,
          parentId: id,
          visibility: parentVisibility,
          feedViewMode: feedViewMode === "stream" ? undefined : "threads",
          byUserId: viewingAsUserId,
        });
        addTopic({
          name: "weekly-report",
          color,
          parentId: dailyId,
          visibility: parentVisibility,
          feedViewMode: feedViewMode === "stream" ? undefined : "threads",
          byUserId: viewingAsUserId,
        });
        addTopic({
          name: "monthly-report",
          color,
          parentId: dailyId,
          visibility: parentVisibility,
          feedViewMode: feedViewMode === "stream" ? undefined : "threads",
          byUserId: viewingAsUserId,
        });
      }
      setEditor(null);
      onSelect(id);
    }
  }

  // Valid parents: anything at depth 0 or 1 — picking one puts the new/edited
  // topic at depth 1 or 2, never past the 3-tier cap (topicDepth's own doc).
  // A depth-2 topic itself never shows up here since it can't become a
  // parent — that'd need a 4th tier. Also can't be its own parent while
  // being edited.
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t] as const)), [topics]);

  // Keep a ref mirror of draggedTopicId — the window listeners below read it
  // synchronously (setState itself is async/batched, so reading the state
  // variable directly right after calling its setter inside the same
  // pointermove wouldn't see the update yet).
  useEffect(() => {
    draggedTopicIdRef.current = draggedTopicId;
  }, [draggedTopicId]);

  // Drives the whole pointer-based drag — see dragCandidateRef's own doc
  // comment above for why this replaces native HTML5 draggable. `topics`/
  // `topicById` only actually change once a drop lands (applyLocalReorder),
  // never mid-drag, so this effect re-subscribing when they change doesn't
  // interrupt an active drag — there's nothing active to interrupt at that
  // instant.
  useEffect(() => {
    if (!editingOrder) return;

    // 5px slop before a pointerdown on a row counts as "dragging" rather
    // than "about to be a click" — matches native drag's own built-in
    // threshold, and without it a plain click that jitters by a pixel would
    // start reordering things.
    const DRAG_THRESHOLD_PX = 5;

    function topicRowAt(clientX: number, clientY: number): HTMLElement | null {
      return document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-topic-id]") ?? null;
    }

    function clearDropIndicator() {
      if (dropIndicatorFrame.current !== null) {
        cancelAnimationFrame(dropIndicatorFrame.current);
        dropIndicatorFrame.current = null;
      }
      dropIndicatorNext.current = null;
      setDropIndicator(null);
    }

    function handlePointerMove(e: PointerEvent) {
      const candidate = dragCandidateRef.current;
      if (!draggedTopicIdRef.current && candidate) {
        if (Math.hypot(e.clientX - candidate.x, e.clientY - candidate.y) < DRAG_THRESHOLD_PX) return;
        draggedTopicIdRef.current = candidate.id;
        setDraggedTopicId(candidate.id);
      }
      const draggedId = draggedTopicIdRef.current;
      if (!draggedId) return;
      // Dragging a room shouldn't also select its text or scroll the page
      // like a normal touch drag would.
      e.preventDefault();

      const el = topicRowAt(e.clientX, e.clientY);
      const targetId = el?.dataset.topicId;
      if (!el || !targetId || targetId === draggedId) {
        dropIndicatorNext.current = null;
        if (dropIndicatorFrame.current === null) {
          dropIndicatorFrame.current = requestAnimationFrame(() => {
            dropIndicatorFrame.current = null;
            setDropIndicator((prev) => (prev === null ? prev : null));
          });
        }
        return;
      }
      const target = topicById.get(targetId);
      if (!target) return;
      // Same 3-band hit test the old onDragOver did — top/bottom 30% of the
      // row means "become a sibling here", the middle 40% means "nest
      // inside this one" (only offered when the row can actually take a
      // child). See reorderByDrop for what each position actually does.
      const rect = el.getBoundingClientRect();
      const frac = (e.clientY - rect.top) / rect.height;
      const canNestInto = topicDepth(target, topicById) < 2 && !topics.some((x) => x.parentId === draggedId);
      const position: "before" | "after" | "into" = frac < 0.3 ? "before" : frac > 0.7 || !canNestInto ? "after" : "into";
      dropIndicatorNext.current = { id: targetId, position };
      if (dropIndicatorFrame.current !== null) return;
      dropIndicatorFrame.current = requestAnimationFrame(() => {
        dropIndicatorFrame.current = null;
        const next = dropIndicatorNext.current;
        setDropIndicator((prev) => (prev?.id === next?.id && prev?.position === next?.position ? prev : next));
      });
    }

    // pointerup AND pointercancel both end a drag the same way — a global
    // listener on `window`, not the row that started it, so this always
    // fires no matter what got remounted underneath the pointer since
    // pointerdown. This is the fix: nothing here depends on the original
    // DOM node still existing. Also handles a pointerdown that never
    // crossed the drag threshold before lifting (just a click) — nothing to
    // reorder there, just forget the candidate.
    function finishDrag(e: PointerEvent) {
      const draggedId = draggedTopicIdRef.current;
      dragCandidateRef.current = null;
      if (!draggedId) return;
      const el = topicRowAt(e.clientX, e.clientY);
      const targetId = el?.dataset.topicId;
      const current = dropIndicatorNext.current;
      const position = current && current.id === targetId ? current.position : "after";
      draggedTopicIdRef.current = null;
      setDraggedTopicId(null);
      clearDropIndicator();
      if (targetId && targetId !== draggedId) reorderByDrop(draggedId, targetId, position);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      dragCandidateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingOrder, topics, topicById]);

  const parentOptions = topics.filter(
    (t) =>
      topicDepth(t, topicById) <= 1 &&
      (editor?.mode !== "edit" || (t.id !== editor.topic.id && !isDescendantOf(t.id, editor.topic.id, topicById)))
  );
  // Split for the picker UI so "pick a top-level room" and "pick an
  // existing sub-topic (nests one tier deeper again)" read as two clearly
  // different choices instead of one flat list mixing both — the exact
  // confusion this was reported over ("แยกกันสิ ระหว่างหัวข้อย่อยและย่อยอีกที
  // ใช้คำพูดอะไรให้ไม่งง"). A sub-topic option also shows its own parent's
  // name, since "weekly-sale" alone doesn't say which room it already
  // nests under.
  const topLevelParentOptions = parentOptions.filter(isTopLevel);
  const subParentOptions = parentOptions.filter((t) => !isTopLevel(t));
  // Reached via a top-level topic's own + button — only ITS OWN sub-topics
  // are valid "ชั้น 2" parents ("ตัวเลือกลูกจะเอามาแสดงแค่ห้องในหัวข้อนั้นพอแล้ว"),
  // not every sub-topic company-wide (that full picker below stays for the
  // top-right "+ สร้างหัวข้อ" button, which isn't scoped to any one topic).
  const scopedSubParentOptions = quickCreateParentId
    ? subParentOptions.filter((t) => t.parentId === quickCreateParentId)
    : subParentOptions;
  // The "ชั้น 2" picker's own options are every sub-topic company-wide,
  // flattened — a long undifferentiated list across every room's own
  // sub-topics with no way to tell which department each belonged to
  // ("อยากให้แยกหมวดหมู่ให้ชัดเจนว่าอะไรคืออะไร"). Grouped by each one's real
  // parent room instead, same SelectGroup/SelectLabel pattern the "ชั้น 1"
  // vs "ชั้น 2" split itself used — the inline "(ย่อยของ X)" suffix is
  // redundant once the group header already says it, so it's dropped here.
  const subParentOptionsByParent = useMemo(() => {
    const groups = new Map<string, { parentName: string; items: ReportTopic[] }>();
    for (const t of subParentOptions) {
      const parentName = (t.parentId ? topicById.get(t.parentId)?.name : undefined) ?? "อื่นๆ";
      if (!groups.has(parentName)) groups.set(parentName, { parentName, items: [] });
      groups.get(parentName)!.items.push(t);
    }
    return [...groups.values()].sort((a, b) => a.parentName.localeCompare(b.parentName, "th"));
  }, [subParentOptions, topicById]);
  const canPickParent = editor?.mode !== "edit" || !topics.some((t) => t.parentId === editor.topic.id);
  // A sub-topic is text-only — no icon/logo picker, in the form or anywhere
  // else — so this mirrors the same effective-parent check `save()` uses.
  const isSubTopic = editor?.mode === "create" ? createKind !== "main" : !!parentId;

  function confirmDelete() {
    if (!deleteTarget) return;
    const wasActive = deleteTarget === activeId;
    removeTopic(deleteTarget, viewingAsUserId);
    if (wasActive) {
      const next = topics.find((t) => t.id !== deleteTarget);
      onSelect(next?.id ?? "");
    }
    setDeleteTarget(null);
  }

  // Live preview in the dialog — carries over the room's existing visibility
  // (for the department-icon fallback) when editing, blank when creating new.
  const previewTopic: ReportTopic = {
    id: "preview",
    name: name.trim() || "หัวข้อใหม่",
    color,
    icon,
    logoUrl,
    createdAt: "",
    minImages: 0,
    cutoffs: [],
    visibility: editor?.mode === "edit" ? editor.topic.visibility : undefined,
  };

  // Favorites are per-viewer (favoritedBy), not a global pin — a favorited
  // topic gets a pinned DUPLICATE row up top for quick access, but its real
  // position in the "หัวข้อของฉัน" tree never moves. Earlier this removed a
  // favorited topic from the tree entirely, which meant favoriting a PARENT
  // orphaned every one of its children — each one suddenly popped out to its
  // own top-level row with no parent to nest under, reading as everything
  // shuffling around at random ("ห้องแม่ห้องลูกขยับมั่วซั่ว") for something
  // that was only ever supposed to add a shortcut. The tree below is now
  // always built from every topic, favorited or not, so nothing can ever be
  // pulled out from under its parent by starring it.
  const favoriteTopics = topics.filter((t) => t.favoritedBy?.includes(viewingAsUserId)).sort(byOrder);
  const topLevelTopics = topics.filter((t) => isTopLevel(t) || !topics.some((p) => p.id === t.parentId)).sort(byOrder);
  // A sub-topic the viewer hid (Teams' "hide channel") stays in the tree —
  // dimmed, see below — rather than disappearing with no way back to it
  // short of a link from somewhere else. Its own "..." menu (renderTopicRow)
  // toggles it back on directly.
  const childrenOf = (parentId: string) => topics.filter((t) => t.parentId === parentId).sort(byOrder);

  // Discord-style notify preference, per room per viewer: "all" (default —
  // every new post lights the room up), "mentions" (only @you does), or "off"
  // (muted — no unread signal at all, and the row reads dimmed). Stored on the
  // topic (notifyPreference), set from the room settings sheet. Honoring it
  // here is what makes muting a room actually go quiet in the sidebar.
  const notifyPrefFor = (t: ReportTopic): "all" | "mentions" | "off" => t.notifyPreference?.[viewingAsUserId] ?? "all";
  const postCountsUnread = (post: ReportPost, pref: "all" | "mentions" | "off", t: ReportTopic) => {
    if (pref === "off") return false;
    if (!post.unreadFor.includes(viewingAsUserId)) return false;
    if (pref === "mentions") return postMentionsUser(post, viewingAsUserId, t);
    return true;
  };
  // Posts in a room that count as unread for this viewer, after its notify
  // preference — the single source the dot, the bold, the count badge and the
  // collapsed-still-visible rule all read from, so they never disagree.
  const topicUnreadPosts = (t: ReportTopic) => {
    const pref = notifyPrefFor(t);
    return posts.filter((post) => post.topicId === t.id && postCountsUnread(post, pref, t));
  };
  // Unread activity "about you" — @mentions (in a post or a reply) AND
  // comments someone left on your own posts — shown as Discord's red pill.
  // This is the exact same count the "รายงาน" nav badge sums across rooms
  // (see aboutMeCountInPost), so the sidebar and the menu never disagree.
  // Shown for "all" and "mentions" rooms alike, silenced only when muted.
  const topicAboutMeCount = (t: ReportTopic) =>
    notifyPrefFor(t) === "off"
      ? 0
      : posts
          .filter((post) => post.topicId === t.id)
          .reduce((sum, post) => sum + aboutMeCountInPost(post, viewingAsUserId, t), 0);

  const isMobile = useIsMobile();

  function renderTopicRow(t: ReportTopic, opts?: { depth?: number; hasChildren?: boolean }) {
    const depth = opts?.depth ?? 0;
    const hasChildren = opts?.hasChildren ?? false;
    // `isCategory` (set at creation, see openCreate/handleSubmit) makes a
    // topic an organizing folder forever, even before it has any children
    // yet — a topic made this way is a category, never a room. Every other
    // topic stays postable regardless of whether it's picked up children —
    // gaining a sub-topic used to silently turn a normal room into a
    // click-to-expand-only folder with nothing of its own to open, which
    // read as the room having broken ("ห้องหลักกดเข้าไปไม่ได้") rather than
    // "now organizes sub-topics too." The two aren't mutually exclusive:
    // the chevron button below handles expand/collapse independently
    // (its own onClick + stopPropagation), so a parent with children can be
    // both postable AND expandable — no longer forced into "pick one."
    // Archived stays in the tree (dimmed, see opacity-50 below) so its own
    // "..." menu is still reachable to un-archive — but that menu's click
    // already stopPropagation()s independently of this row's onClick, so
    // opening the room itself here is never actually needed for that. Feed/
    // composer/round-status code downstream all assumes "current" rooms
    // only, so letting a click through to onSelect() here just hands them
    // an id they don't handle, which read as the whole page hanging
    // ("กดแล้วค้าง") instead of a normal room open.
    const canOpenDirectly = !t.isCategory && !t.archived;
    const hiddenForMe = depth > 0 && (t.hiddenBy?.includes(viewingAsUserId) ?? false);
    // Collapse works the same in reorder mode as it does normally now —
    // used to force-expand every group while reordering (a collapsed group
    // has nothing to drag its own children onto/into), which made a long
    // tree impossible to tuck away just to reposition the *parent* rooms
    // themselves ("ห้องที่มีลูกจะต้องเลื่อนผ่านลูกมันไปเรื่อยๆ...อยากย่อได้").
    // The trade-off is real but narrow: a collapsed group can still be
    // reordered among its own siblings and can still receive a drop as a
    // new last child (reorderByDrop only needs the group's own header row,
    // always rendered regardless of collapse) — only reordering *among* a
    // collapsed group's existing children needs it expanded first, since
    // those rows aren't in the DOM to drag/drop onto while hidden.
    const collapsed = collapsedTopicIds.has(t.id);
    const muted = notifyPrefFor(t) === "off";
    // Unread dot/badge/red-pill — each one filters (or, for the descendant
    // check below, recursively filters) the WHOLE posts array per topic.
    // None of it changes what editingOrder renders (no dot, no badge, no
    // pill shown in that mode — just the drag handle/▲▼), so it's skipped
    // there entirely rather than computed and thrown away: a drag-over event
    // re-renders every visible row many times a second, and this was the
    // other big chunk of per-row work still running unconditionally on every
    // one of those re-renders even after hoverRows (below) was already
    // gated the same way — still enough on its own to freeze a sidebar with
    // any real number of posts while dragging ("กดเข้าไปละลากห้องไปมามันก็
    // ค้าง").
    // Count honors this room's notify preference (muted -> 0, "mentions" ->
    // only @you), so a muted room shows no dot and no badge, like Discord.
    const unreadCount = editingOrder ? 0 : topicUnreadPosts(t).length;
    // Red pill count (Discord) — unread activity about this viewer: @mentions
    // plus comments on their own posts; suppressed when the room is muted.
    const aboutMeCountHere = editingOrder ? 0 : topicAboutMeCount(t);
    // A parent topic almost never has posts of its own (it's an organizing
    // folder), so its own unreadCount is normally 0 even when a child
    // sub-topic underneath it has something new. Collapsed, that new post
    // would be invisible with no signal at all to expand and look — so the
    // dot (not the numeric badge, which stays this topic's own count only)
    // also lights up from descendants, each child weighed by its own
    // notify preference.
    // Recurses past immediate children too — a depth-0 parent must still
    // light up from an unread post on a depth-2 grandchild tucked under a
    // depth-1 child it hasn't expanded, not just its own direct children.
    function hasUnreadDescendant(topic: ReportTopic): boolean {
      return childrenOf(topic.id).some((c) => topicUnreadPosts(c).length > 0 || hasUnreadDescendant(c));
    }
    const descendantUnread = !editingOrder && hasChildren && hasUnreadDescendant(t);
    const hasUnread = unreadCount > 0 || descendantUnread;
    const active = t.id === activeId;
    const favorited = t.favoritedBy?.includes(viewingAsUserId) ?? false;

    // 2) Hover ห้องที่มีรอบส่ง — the ⏰ shows for any room tracked with a
    // round in force today, regardless of who's on the hook for it (an
    // owner/admin just browsing still gets to see the room's own schedule).
    // Only the red "ยังไม่ส่ง" label + each row's posted/late status are
    // scoped to what *this viewer* personally owes (viewerRoundIds) — someone
    // not listed as a submitter for a round sees it as "na", not "late".
    //
    // None of this ever renders while editingOrder (the ⏰ badge/tooltip is
    // gated `!editingOrder` below) — skipped entirely in that case rather
    // than computed and thrown away, since dragging over a row fires this
    // same per-row work (posts.some(...) scans the WHOLE posts array per
    // round) dozens of times a second for every visible row, which read as
    // the whole page freezing while dragging ("กดจัดลำดับและลากห้อง...ค้าง").
    const today = todayIso();
    const roundsToday = editingOrder ? [] : effectiveRoundsOf(t).filter((r) => roundRunsOnDay(r, today));
    // A day this viewer is on leave/holiday/routine day-off owes nothing —
    // same exemption the report-feed compliance pills already honor.
    const viewerExemptToday = !editingOrder && isExemptDate(complianceExemptions, viewingAsUserId, today);
    const viewerRoundIds = editingOrder || viewerExemptToday
      ? new Set<string>()
      : new Set(roundsForUserOnDay(t, viewingAsUserId, today, submitterGroups).map((r) => r.id));
    // Only show the ⏰ status at all to someone with a reason to care about
    // it: a real submitter of one of today's rounds, the CEO/owner, or the
    // head of one of the room's own departments — see canSeeRoomSubmissionStatus.
    const canSeeStatus = !editingOrder && (viewerRoundIds.size > 0 || canSeeRoomSubmissionStatus(t.visibility, viewingAsUserId));
    const nowMinutes = (() => {
      const n = new Date();
      return n.getHours() * 60 + n.getMinutes();
    })();
    const hoverRows = editingOrder
      ? []
      : roundsToday
          .slice()
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((r) => {
            const owesIt = viewerRoundIds.has(r.id);
            const posted = posts.some(
              (p) =>
                p.topicId === t.id &&
                p.authorId === viewingAsUserId &&
                !p.excludeFromSubmission &&
                localDateStr(new Date(p.createdAt)) === today &&
                attributePostToRound(p, roundsToday)?.id === r.id
            );
            const [h, m] = r.time.split(":").map(Number) as [number, number];
            const cutoffMinutes = h * 60 + m;
            const status: "posted" | "late" | "pending" | "na" = !owesIt
              ? "na"
              : posted
                ? "posted"
                : cutoffMinutes < nowMinutes
                  ? "late"
                  : "pending";
            return { id: r.id, label: r.label, time: r.time, status };
          });
    // "late" (missed a cutoff that already passed) is the only urgent state —
    // "pending" just means a later round hasn't come due yet, which used to
    // get lumped into the same red "ยังไม่ส่ง" count as an actual miss and
    // read as contradictory next to that same round's own "ยังไม่ถึงเวลา" row
    // ("บอกว่ายังไม่ส่ง แต่ก็บอกว่ายังไม่ถึงเวลา งงว่าตกลงต้องรีบไหม").
    const lateHoverCount = hoverRows.filter((r) => r.status === "late").length;
    const pendingHoverCount = hoverRows.filter((r) => r.status === "pending").length;
    return (
      <div
        key={t.id}
        data-tour="topic-row"
        data-topic-id={t.id}
        data-topic-name={t.name}
        // Pointer-events drag, not native HTML5 draggable — see
        // dragCandidateRef's own doc comment (near the other reorder state,
        // above) for why. Only arms a *candidate*; the window-level
        // pointermove effect promotes it to an actual drag once the pointer
        // has moved past a small threshold, so a plain click never counts
        // as "started dragging" for one shaky pixel of mouse jitter — same
        // guarantee `draggable`'s own built-in threshold used to give for
        // free. Skips interactive descendants (▲▼, "...", chevron, star,
        // +) — those still work as plain clicks/taps.
        onPointerDown={(e) => {
          if (!editingOrder || e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button, a")) return;
          dragCandidateRef.current = { id: t.id, x: e.clientX, y: e.clientY };
        }}
        className={cn(
          editingOrder && "touch-none",
          // select-none — without it, clicking a row fast/repeatedly (double-
          // click timing) makes the BROWSER select the room's name as plain
          // text instead of just opening it; the next mouse-move while that
          // selection is live starts a native "drag this selected text"
          // operation, which eats input the same way the old always-on
          // `draggable` bug did — nothing responds until it ends, reading as
          // the whole page freezing ("กดเลือกห้องเร็วๆก็ค้างเลย"), even now
          // that `draggable` itself is reorder-mode-only. A row's text is
          // never meant to be selected/copied on its own anyway.
          "group relative flex items-center gap-2 rounded-xl pr-2 cursor-pointer select-none transition-colors duration-200 w-full",
          depth > 0 ? "pl-2 py-1.5 text-[13px]" : "pl-1.5 py-2 text-sm",
          // Hidden-for-me stays in the tree (so its own "..." menu is always
          // reachable to un-hide it) but reads as clearly dimmed either way.
          // Archived (Phase 6) reads the same way, for the same reason —
          // still findable to un-archive from its own ⚙, not hard-hidden.
          (hiddenForMe || t.archived || (muted && !active)) && "opacity-50",
          editingOrder && draggedTopicId === t.id && "opacity-40",
          dropIndicator?.id === t.id && dropIndicator.position === "into" && "ring-2 ring-[var(--brand-green)] bg-[var(--accent)]",
          active
            ? "bg-[var(--accent)] font-semibold"
            : cn(
                // bg-white, not bg-soft — bg-soft is close enough to this
                // sidebar's own new tinted background (see the outer wrapper
                // above) that hovering barely read as a state change anymore.
                "hover:bg-white",
                // Unread reads as full-strength ink regardless of depth — a
                // sub-topic with something new to see shouldn't be stuck at
                // the same muted gray as one nobody's posted in for weeks,
                // which was the only signal here before (a small count pill
                // easy to miss at a glance).
                depth > 0 && !hasUnread ? "text-[var(--ink-soft)]" : "text-[var(--ink)]"
              )
        )}
        // Sub-topics indent the whole row (icon + text + right-side actions
        // move together), not just the label — otherwise the icon would
        // stay flush with the parent's and the nesting wouldn't read at a
        // glance. 32px keeps it clearly deeper than the parent's own
        // chevron+icon (~26px) without eating too much of a narrow sidebar.
        // The inline `width` shrinks by the same 32px so `w-full` (100%)
        // plus this marginLeft never adds up to more than the row's own
        // container width — a fixed marginLeft next to an explicit 100%
        // width overflows unless the width itself is reduced to match.
        style={depth > 0 ? { marginLeft: depth * 32, width: `calc(100% - ${depth * 32}px)` } : undefined}
        // Only a pure category (isCategory, "ห้องใหม่แยกอิสระ") has nothing of
        // its own to open — clicking its row expands/collapses instead, same
        // as the chevron button. Every other topic opens/selects on click
        // regardless of whether it has children (the chevron still handles
        // expand/collapse independently — see its own onClick above). In
        // reorder mode the row itself no longer navigates/collapses — only
        // the grip handle / ▲▼ act on it, so a stray tap while reordering
        // doesn't also jump into the room.
        onClick={() => {
          if (editingOrder) return;
          if (!canOpenDirectly) toggleCollapsed(t.id);
          else onSelect(t.id);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (editingOrder) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!canOpenDirectly) toggleCollapsed(t.id);
            else onSelect(t.id);
          }
        }}
      >
        {dropIndicator?.id === t.id && (dropIndicator.position === "before" || dropIndicator.position === "after") && (
          // The "become a sibling here" line — top edge for "before", bottom
          // edge for "after", same green as the active-room bar so it reads
          // as "this is where it'll land" at a glance (Discord's own line).
          <span
            className={cn(
              "absolute left-1 right-1 h-[2px] rounded-full bg-[var(--brand-green)]",
              dropIndicator.position === "before" ? "-top-[1px]" : "-bottom-[1px]"
            )}
          />
        )}
        {active && (
          // Brand green, not this topic's own arbitrary color (t.color can
          // land on red/orange for plenty of topics, purely as a visual
          // label for telling rooms apart elsewhere) — a green "selected"
          // background paired with a red/orange left bar reads as two
          // colors fighting over what they mean on the same row.
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--brand-green-dark)]" />
        )}
        {!active && hasUnread && (
          // Discord's unread "notch" — a short pill hugging the far-left
          // edge of the rail. It's the at-a-glance "there's something new in
          // here" mark that reads even when you scan straight past the label,
          // and it works at every depth (sub-topics have no logo dot). An
          // open row shows the green selector bar above instead of this.
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 h-2 w-1 rounded-r-full bg-[var(--ink)]"
            aria-hidden
          />
        )}
        {editingOrder && (
          // The one drag handle — doubles as the "this row is now
          // reorderable" affordance. The row itself is draggable all the
          // time (see `draggable` above, no separate mode to enter first),
          // so no handle is needed to START a drag — this only shows once
          // one's already underway, same idea as Discord (grab the channel
          // itself, no dedicated grip at rest). Not a button itself (no
          // click action of its own beyond dragging); ▲▼ below is the tap/
          // keyboard-reachable equivalent for mobile or anyone who'd rather
          // not drag, once a session's open.
          <span
            className="shrink-0 flex h-5 w-5 items-center justify-center text-[var(--ink-soft)] cursor-grab active:cursor-grabbing"
            aria-hidden
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
        {hasChildren ? (
          // Any tier can carry this now, not just depth 0 — a depth-1
          // sub-topic that's picked up sub-topics of its own (depth 2) needs
          // the exact same expand/collapse affordance the top tier always had.
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(t.id);
            }}
            aria-label={collapsed ? `ขยาย ${t.name}` : `ย่อ ${t.name}`}
            className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--ink-soft)] hover:text-[var(--ink)]"
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", !collapsed && "rotate-90")} />
          </button>
        ) : depth === 0 ? (
          <span className="shrink-0 w-3.5" />
        ) : null}
        {/* Sub-topics are text-only — no icon, no "#" glyph (read as visual
            noise once every row in a channel list carried one). The
            unread/read distinction still comes through via font weight+color
            just below, so nothing is lost by dropping the marker. */}
        {depth === 0 && (
          <span className="relative shrink-0">
            <TopicLogo topic={t} size="h-6 w-6" />
            {/* The explicit "something's new here" signal — same small-dot
                language as a phone app icon's notification badge, so it reads
                as unread/read at a glance without parsing text weight or
                hunting for a number. */}
            {hasUnread && (
              <span
                className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--chart-red)] ring-2 ring-white"
                aria-hidden
              />
            )}
          </span>
        )}
        <span
          className={cn(
            "truncate flex-1 leading-none [&::first-letter]:uppercase",
            depth === 0 || hasUnread ? "font-semibold" : "font-normal",
            active && "text-[var(--brand-green-dark)]"
          )}
        >
          {t.name}
        </span>
        {/* 2) Hover ห้องที่มีรอบส่ง — ⏰ always shows for a tracked room; the
            red "เลยเวลา" label only once an actual cutoff has passed with
            nothing posted (not merely "a later round hasn't come due yet",
            which isn't urgent and used to red-flag the same as a real miss). */}
        {!editingOrder && canSeeStatus && hoverRows.length > 0 && (
          <Tooltip
            {...(isMobile
              ? {
                  open: openClockRowId === t.id,
                  onOpenChange: (open: boolean) => setOpenClockRowId(open ? t.id : null),
                }
              : {})}
          >
            <TooltipTrigger
              render={
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isMobile) setOpenClockRowId((cur) => (cur === t.id ? null : t.id));
                  }}
                  className={cn(
                    "shrink-0 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    lateHoverCount > 0 ? "text-[var(--chart-red)] bg-red-50" : "text-[var(--ink-soft)]"
                  )}
                >
                  <span aria-hidden>⏰</span>
                  {lateHoverCount > 0 && <span>เลยเวลา</span>}
                </span>
              }
            />
            <TooltipContent className="w-48 max-w-[calc(100vw-24px)] p-2" side="right">
              <p className="text-[11px] font-semibold leading-snug">
                {viewerRoundIds.size === 0
                  ? "ห้องนี้ไม่ใช่รอบที่คุณต้องส่ง"
                  : lateHoverCount > 0
                    ? `เลยเวลาส่งแล้ว ${lateHoverCount} รอบ`
                    : pendingHoverCount > 0
                      ? `เหลืออีก ${pendingHoverCount} รอบที่ต้องส่งวันนี้`
                      : "ส่งครบทุกรอบวันนี้แล้ว"}
              </p>
              <div className="mt-1.5 space-y-1 border-t border-white/15 pt-1.5">
                {hoverRows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-1.5 text-[10px] leading-snug">
                    <span className="opacity-90 truncate">
                      {r.label} <span className="opacity-60">· {r.time} น.</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium",
                        r.status === "posted" && "bg-emerald-400/15 text-emerald-300",
                        r.status === "late" && "bg-red-400/15 text-red-300",
                        r.status === "pending" && "bg-white/10 text-current opacity-70",
                        r.status === "na" && "bg-white/10 text-current opacity-50"
                      )}
                    >
                      {r.status === "posted" && "✓ ส่งแล้ว"}
                      {r.status === "late" && "เลยเวลา"}
                      {r.status === "pending" && "ยังไม่ถึง"}
                      {r.status === "na" && "ไม่ใช่ผู้ส่ง"}
                    </span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
        {editingOrder && (
          // ▲▼ fallback for mobile/keyboard — same reorder logic the drag
          // handle drives, one step at a time within the same sibling group.
          <span className="shrink-0 flex flex-col">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                moveTopicStep(t, -1);
              }}
              aria-label={`ย้าย ${t.name} ขึ้น`}
              className="flex h-3.5 w-4 items-center justify-center text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                moveTopicStep(t, 1);
              }}
              aria-label={`ย้าย ${t.name} ลง`}
              className="flex h-3.5 w-4 items-center justify-center text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </span>
        )}
        {aboutMeCountHere > 0 && (
          // Activity about this viewer earns a red number here (Discord-style):
          // @mentions and comments on their own posts. Plain "unread" is
          // already carried by the left notch + bold label, so a second green
          // count sitting next to it was redundant ("ตัวเลขเขียวเอาออก").
          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--chart-red)] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
            {aboutMeCountHere}
          </span>
        )}
        {/* Quick "add a sub-topic here" — opens the same create dialog as
            the main "+ สร้างหัวข้อ" button, just with this topic already
            picked as the parent, so you don't have to hunt for it in the
            dropdown. Only top-level topics can take a sub-topic. */}
        {!editingOrder && depth === 0 && canManageTopics && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openCreate(t.id);
            }}
            className={cn("shrink-0 flex h-5 w-5 items-center justify-center rounded text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity", isMobile && "hidden")}
            aria-label={`สร้างหัวข้อย่อยใต้ ${t.name}`}
            title={`สร้างหัวข้อย่อยใต้ "${t.name}"`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Only a pure category has nothing of its own to browse/post in —
            favoriting only makes sense on a room you can
            actually open, i.e. a leaf topic or a sub-topic. */}
        {!editingOrder && canOpenDirectly && (
          <button
            data-tour="topic-star"
            onClick={(e) => {
              e.stopPropagation();
              toggleFavoriteTopic(t.id, viewingAsUserId);
            }}
            className={cn(
              "shrink-0 flex h-5 w-5 items-center justify-center rounded text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] transition-opacity",
              favorited || tourOnStarStep
                ? "opacity-100 text-amber-400 hover:text-amber-500"
                : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
              isMobile && !favorited && !tourOnStarStep && "hidden"
            )}
            aria-label={favorited ? `เลิกติดดาว ${t.name}` : `ติดดาว ${t.name}`}
            title={favorited ? "เลิกติดดาว" : "ติดดาว"}
          >
            <Star className="h-3.5 w-3.5" fill={favorited ? "currentColor" : "none"} />
          </button>
        )}
        {/* Renaming/re-icon-ing a room's settings stays department-head
            editable (canEditReportTopic); creating a sub-topic or deleting
            the room outright is the narrower CEO-or-delegate gate
            (canManageTopics). Hiding a sub-topic from your own sidebar is a
            personal preference, not an edit — every viewer gets that item
            regardless, so the menu also opens for a plain viewer of a
            sub-topic even with neither of the other two rights. */}
        {!editingOrder && (canEditReportTopic(t.visibility, viewingAsUserId) || canManageTopics || depth > 0 || canOpenDirectly) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "shrink-0 flex items-center justify-center rounded text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] transition-opacity",
                    // Mobile has no hover, so this always stays visible there
                    // (a "tap to reveal" version read as broken — "ให้ ...
                    // ใช้ไม่ได้") — just noticeably smaller than the desktop
                    // hover-revealed version so it doesn't read as loud/busy
                    // sitting on screen permanently ("ขอให้ดูเล็กๆหน่อย").
                    isMobile
                      ? "h-4 w-4 opacity-100"
                      : cn(
                          "h-5 w-5 opacity-100 pointer-events-auto",
                          !hiddenForMe && "lg:opacity-0 lg:pointer-events-none lg:group-hover:opacity-100 lg:group-hover:pointer-events-auto"
                        )
                  )}
                  aria-label={`ตัวเลือกหัวข้อ ${t.name}`}
                >
                  <MoreHorizontal className={isMobile ? "h-3 w-3" : "h-3.5 w-3.5"} />
                </button>
              }
            />
            <DropdownMenuContent
              align="end"
              // The row underneath opens/selects this topic on click
              // (onSelect/toggleCollapsed). This menu's content renders into
              // a portal, but React still bubbles its clicks up through the
              // *component* tree rather than the DOM tree a portal actually
              // sits in — so every item click here was also firing the row's
              // own onClick underneath, silently navigating into (or
              // collapsing) the topic every single time any menu action was
              // used ("กด ...แล้วกด ติดดาว ทำไมเด้งไปหน้าอื่น"). One guard on
              // the whole popup, not per item, so nothing added here later
              // falls back into the same trap.
              onClick={(e) => e.stopPropagation()}
            >
              {/* Mobile: no hover, so the standalone ⭐/+ row buttons are
                  unreachable — surface them here instead so a phone user can
                  still favorite / add a sub-topic from the one ⋯ menu. */}
              {isMobile && canOpenDirectly && (
                <DropdownMenuItem onClick={() => toggleFavoriteTopic(t.id, viewingAsUserId)}>
                  <Star className="h-3.5 w-3.5" fill={favorited ? "currentColor" : "none"} />
                  {favorited ? "เลิกติดดาว" : "ติดดาว"}
                </DropdownMenuItem>
              )}
              {isMobile && depth === 0 && canManageTopics && (
                <DropdownMenuItem onClick={() => openCreate(t.id)}>
                  <Plus className="h-3.5 w-3.5" />
                  สร้างหัวข้อย่อย
                </DropdownMenuItem>
              )}
              {isMobile && (canOpenDirectly || (depth === 0 && canManageTopics)) && <DropdownMenuSeparator />}
              {/* Per-viewer notification preference — Discord's channel mute,
                  reachable straight from the room's own "..." so nobody has to
                  dig into full room settings just to quiet a room. Shown for
                  any real room (a leaf topic or a sub-topic); a category folder
                  has no posts of its own to notify from, so it's skipped. */}
              {(canOpenDirectly || depth > 0) && (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {notifyPrefFor(t) === "off" ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                      การแจ้งเตือน
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={notifyPrefFor(t)}
                        onValueChange={(v) => v && setNotifyPreference(t.id, viewingAsUserId, v as "all" | "mentions" | "off")}
                      >
                        <DropdownMenuRadioItem value="all">
                          <Bell className="h-3.5 w-3.5" />
                          ทุกโพสต์
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="mentions">
                          <AtSign className="h-3.5 w-3.5" />
                          เฉพาะที่กล่าวถึงฉัน
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="off">
                          <BellOff className="h-3.5 w-3.5" />
                          ปิดการแจ้งเตือน
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {(canEditReportTopic(t.visibility, viewingAsUserId) || canManageTopics || depth > 0) && <DropdownMenuSeparator />}
                </>
              )}
              {/* Creating a sub-topic goes through the same "+ สร้างหัวข้อ"
                  dialog as any other topic — its own "หัวข้อหลัก" picker
                  already covers this, so no separate shortcut here. */}
              {canEditReportTopic(t.visibility, viewingAsUserId) && (
                <DropdownMenuItem onClick={() => openEdit(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                  แก้ไขหัวข้อ
                </DropdownMenuItem>
              )}
              {canEditReportTopic(t.visibility, viewingAsUserId) && onOpenSettings && (
                <DropdownMenuItem onClick={() => onOpenSettings(t.id)}>
                  <Settings2 className="h-3.5 w-3.5" />
                  ตั้งค่าห้อง
                </DropdownMenuItem>
              )}
              {depth > 0 && (
                <DropdownMenuItem onClick={() => toggleHiddenTopic(t.id, viewingAsUserId)}>
                  {hiddenForMe ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {hiddenForMe ? "แสดงในเมนู" : "ซ่อนจากเมนู"}
                </DropdownMenuItem>
              )}
              {canManageTopics && (
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(t.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  ลบหัวข้อ
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  }

  // One row plus (if expanded) its own indented children, recursively — a
  // depth-1 sub-topic with sub-topics of its own renders exactly the same
  // way a top-level topic does, just one tier deeper. Used by
  // renderTopicBranch below for the top of each branch, and calls itself for
  // any deeper tier.
  function renderTopicSubtree(t: ReportTopic, depth: number) {
    // The tree is only ever meant to go 3 tiers deep (topicDepth's own
    // doc) — a `parentId` chain that loops back on itself (see topicDepth's
    // `seen` guard) would otherwise make this recurse into itself forever
    // through childrenOf, hanging the whole tab on every render, not just
    // when something calls topicDepth ("กดจัดลำดับและลากห้องย้ายห้องนี่ค้าง
    // เลย...ค้างจริง ต้องรีเฟรช"). A depth this far past the real cap only
    // happens with corrupted data, so just stop recursing rather than
    // render an obviously-wrong tree.
    if (depth > 8) return null;
    const children = childrenOf(t.id);
    const hasChildren = children.length > 0;
    // Collapse works during reorder mode too now — see the matching
    // `collapsed` in renderTopicRow for why the old force-expand-while-
    // reordering behavior got dropped.
    const isCollapsed = collapsedTopicIds.has(t.id);
    // Discord-style collapse: a collapsed category still keeps any channel
    // that's unread or currently open on screen — only the read/idle ones
    // tuck away — so a new post is never hidden behind a folded folder and
    // whatever room you're standing in stays visible while you collapse the
    // rest. Expanded shows everything, exactly as before. A child's own
    // unread posts count even if its collapse state hides ITS children in
    // turn — topicUnreadPosts is about that one room's own posts, not its
    // descendants, so each tier's collapse only ever hides its own idle kids.
    // ("อยากให้เวลาย่อไว้และถ้ามีอันที่เรายังไม่ได้อ่านละมีเตือนให้ขึ้นคาไว้จนกว่า
    // จะอ่าน...พออ่านละก็หายไปเหมือนเดิม" — คอนเฟิร์มว่าต้องการพฤติกรรมนี้จริง)
    const visibleChildren = isCollapsed
      ? children.filter((c) => c.id === activeId || topicUnreadPosts(c).length > 0)
      : children;
    return (
      <Fragment key={t.id}>
        {renderTopicRow(t, { depth, hasChildren })}
        {visibleChildren.length > 0 && (
          <div className="relative">
            {/* Guide line down to this parent's own children — every child
                at THIS depth lines up under it, and any grandchildren
                (rendered by this same call one level deeper) get their own
                line further in again, never lining up with this one. Plain
                indentation alone read as "each row just shifted right a
                bit," not "these specific rows belong to that specific
                parent" ("อยากให้แสดงให้ชัดเจนว่าลูก 1 เท่ากับลูก1...แต่ลูก1 จะ
                ไม่เท่ากับแม่"). */}
            <span className="absolute top-0 bottom-1 w-px bg-[var(--line)]" style={{ left: (depth + 1) * 32 - 16 }} aria-hidden />
            {visibleChildren.map((child) => renderTopicSubtree(child, depth + 1))}
          </div>
        )}
      </Fragment>
    );
  }

  // A top-level topic plus (if expanded) its indented sub-topics — the
  // Teams "team, then its channels" block as one unit, with a guide line
  // (see renderTopicSubtree above) down to its own children.
  function renderTopicBranch(t: ReportTopic) {
    const children = childrenOf(t.id);
    const isCollapsed = collapsedTopicIds.has(t.id);
    const visibleChildren = isCollapsed
      ? children.filter((c) => c.id === activeId || topicUnreadPosts(c).length > 0)
      : children;
    const showChildren = visibleChildren.length > 0;
    // A little extra room after this group's last child before the next
    // parent starts, on top of the list's own space-y-1 — keeps groups
    // visually separated without opening up large gaps within a group.
    return (
      <div key={t.id} className={showChildren ? "mb-2 space-y-0.5" : undefined}>
        {renderTopicRow(t, { depth: 0, hasChildren: children.length > 0 })}
        {showChildren && (
          <div className="relative">
            <span className="absolute top-0 bottom-1 w-px bg-[var(--line)]" style={{ left: 32 - 16 }} aria-hidden />
            {visibleChildren.map((child) => renderTopicSubtree(child, 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    // Two layers: the outer one stays overflow-visible so the floating
    // collapse button (positioned half outside the panel's own right edge)
    // doesn't get sliced into a clipped blob by the inner overflow-hidden —
    // that inner div is what actually needs the clip (it's the one with the
    // tinted fill and the flex-col content).
    <div className={cn("relative w-full lg:w-[280px] lg:h-full lg:shrink-0", fillHeight ? "h-full" : "h-64")}>
      <div
        className={cn(
          // No card frame at all — a border+white-fill box sitting right next
          // to the room panel's own box read as two stacked "this is a boxed
          // thing" signals before a single post even came into view
          // ("กรอบซ้อนกันหลายชั้น"). A faint tinted background instead of
          // white is enough on its own to read as "a different area" next to
          // the room panel's white, the same way Notion/Linear separate a nav
          // rail from its content with color contrast, not a drawn line.
          "h-full w-full bg-[color-mix(in_srgb,var(--bg-soft)_55%,white)] flex flex-col min-h-0 overflow-hidden"
        )}
      >
      {/* Header separated by spacing (extra bottom padding) instead of a
          border-b now — one less hard rule stacking on top of the section
          divider just below it and the card's own outer border, all three
          of which used to draw in the same tight space. */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex items-center gap-1">
          <p className="text-[15px] font-semibold">หัวข้อ</p>
        </div>
        {canManageTopics && (
          <div className="flex items-center gap-1.5">
            {reorderMode ? (
              // ทิ้ง pendingTopics เฉยๆ — ไม่เคยเขียนอะไรลง store จริงเลย
              // ตราบใดที่ยังไม่กด "เสร็จ" เลยไม่มีอะไรต้อง revert
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full px-3.5 text-xs"
                  onClick={() => {
                    setPendingTopics(null);
                    setDraggedTopicId(null);
                    setDropIndicator(null);
                    setReorderMode(false);
                  }}
                >
                  ยกเลิก
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1 rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white px-3.5 text-xs"
                  onClick={() => {
                    commitPendingOrder();
                    setPendingTopics(null);
                    setDraggedTopicId(null);
                    setDropIndicator(null);
                    setReorderMode(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  เสร็จ
                </Button>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => {
                          setPendingTopics(null); // defensive — should already be null, see "เสร็จ"/"ยกเลิก"
                          setReorderMode(true);
                        }}
                        aria-label="จัดลำดับห้อง"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] transition-colors"
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                    }
                  />
                  <TooltipContent className="text-xs">จัดลำดับห้อง</TooltipContent>
                </Tooltip>
                <Button
                  size="sm"
                  variant="outline"
                  // Outline instead of a solid fill — a filled button read as
                  // heavier/more opaque than the rest of this now-lighter panel
                  // ("ปุ่มไม่ต้องใหญ่หรือทึบเกินไป"); still unmistakably the
                  // primary action here via the brand-colored border/text.
                  className="h-8 gap-1 rounded-full border-[var(--brand-green)]/50 text-[var(--brand-green-dark)] hover:bg-[var(--accent)] hover:border-[var(--brand-green)] px-3.5 text-xs transition-transform active:scale-[0.99]"
                  onClick={() => openCreate()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  หัวข้อใหม่
                </Button>
              </>
            )}
          </div>
        )}
      </div>


      <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-1">
        {favoriteTopics.length > 0 && (
          <>
            <p className="px-2.5 pt-1 pb-1 text-[11px] font-semibold text-[var(--ink-soft)] uppercase tracking-wide">รายการโปรด</p>
            {favoriteTopics.map((t) => renderTopicRow(t))}
            {/* Spacing instead of a full-contrast rule — a hairline this close
            to the section above and the one below it read as one more hard
            line in a panel already asked to feel less boxed-in. Still a
            border, just faint enough to read as a gap between sections
            rather than a divider. */}
        <div className="my-3 border-t border-[var(--line)]/50" />
          </>
        )}
        {topLevelTopics.length > 0 && (
          <p className="px-2.5 pt-1 pb-1 text-[11px] font-semibold text-[var(--ink-soft)] uppercase tracking-wide">หัวข้อของฉัน</p>
        )}
        {topLevelTopics.map(renderTopicBranch)}

        {topics.length === 0 && (
          <p className="text-xs text-[var(--ink-soft)] px-2.5 py-3">ยังไม่มีหัวข้อ กด + หัวข้อใหม่ เพื่อเริ่มต้น</p>
        )}
      </div>
      </div>

      {onCollapse && (
        // Rests as a small unobtrusive nub on the panel's edge, then widens
        // into the same labeled-pill shape the old inline button used
        // ("ย่ออะไร" needs the word, not just an arrow) once hovered — so it
        // doesn't compete for attention while idle but is unambiguous the
        // moment someone's about to click it.
        <button
          type="button"
          onClick={onCollapse}
          title="ย่อหัวข้อ"
          aria-label="ย่อหัวข้อ"
          className="group absolute top-1/2 -right-3 -translate-y-1/2 z-10 hidden lg:flex h-7 items-center gap-1.5 rounded-full border border-[var(--line)] bg-white pl-1.5 pr-1.5 text-[var(--ink-soft)] shadow-sm transition-colors hover:border-[var(--brand-green)]/50 hover:bg-[var(--accent)] hover:text-[var(--brand-green-dark)] hover:pr-3"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-semibold transition-[max-width] duration-200 group-hover:max-w-[64px]">
            หัวข้อ
          </span>
        </button>
      )}

      <Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="sm:max-w-md p-0 gap-0 max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle>{editor?.mode === "edit" ? "แก้ไขหัวข้อ" : "สร้างหัวข้อใหม่"}</DialogTitle>
            <DialogDescription>
              {isSubTopic ? "ตั้งชื่อและสีประจำห้อง — แก้ทีหลังได้เสมอ" : "ตั้งชื่อ สี และไอคอน/รูปประจำห้อง — แก้ทีหลังได้เสมอ"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Live preview — the same "logo" every room row/header renders,
                so what you see here is exactly what shows up once saved. */}
            <div className="flex flex-col items-center gap-2 py-1">
              {isSubTopic ? (
                <span className="flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold text-[var(--ink-soft)] bg-[var(--bg-soft)]" aria-hidden>
                  #
                </span>
              ) : (
                <div className="rounded-full p-1" style={{ boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 20%, transparent)` }}>
                  <TopicLogo topic={previewTopic} size="h-14 w-14" />
                </div>
              )}
              <span className="text-sm font-semibold truncate max-w-full">{previewTopic.name}</span>
            </div>

            {/* ข้อมูลพื้นฐาน */}
            <div className="rounded-xl border border-[var(--line)] overflow-hidden">
              <p className="px-3.5 py-2 text-xs font-semibold bg-[var(--bg-soft)] border-b border-[var(--line)]">ข้อมูลพื้นฐาน</p>
              <div className="p-3.5 space-y-3.5">
                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--ink-soft)]">ชื่อหัวข้อ</Label>
                  <Input
                    ref={nameInputRef}
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="เช่น ทีมการเงิน"
                    onKeyDown={(e) => e.key === "Enter" && save()}
                  />
                </div>

                {editor?.mode === "create" ? (
                  // Boxed as its own card — this whole block (kind, parent
                  // picker) is one decision, and reads that way better set
                  // apart from the plain name/description fields around it
                  // ("อยากได้แบ่งเป็นแบบนี้").
                  <div className="space-y-1.5 rounded-lg border border-[var(--line)] p-3">
                    {/* Three explicit buttons, not two-plus-a-dropdown-that-
                        silently-changes-the-tier — "sub" and "subsub" used to
                        be one button ("ห้องย่อยในห้องเดิม") whose resulting
                        depth depended on which row you picked from a combined
                        dropdown underneath, which read as one choice hiding
                        another ("ต้องมี 3 ล็อคให้เลือกสิ อันใหม่ที่เป็นย่อยใน
                        ย่อยต้องอยู่ในนี้ด้วยสิ"). Each button's own parent
                        picker below now only ever lists options at the one
                        tier that button actually means. */}
                    <Label className="text-xs text-[var(--ink-soft)]">สร้างห้องแบบไหน</Label>
                    <div className={cn("grid gap-2", quickCreateParentId ? "grid-cols-2" : "grid-cols-3")}>
                      {/* Opened via a specific topic's own + (quickCreateParentId
                          set) — "ห้องใหม่แยกอิสระ" doesn't belong here at all: a
                          brand-new independent top-level topic has nothing to do
                          with the topic you clicked + on, and offering it just
                          invites picking the wrong tab by habit. That flow lives
                          only behind the top-right "+ หัวข้อใหม่" button now
                          ("อยากสร้างหัวข้อใหม่ให้สร้างที่ + หัวข้อใหม่บนขวาเท่านั้น
                          ลดการสับสน"). */}
                      {!quickCreateParentId && (
                        <button
                          type="button"
                          onClick={() => setCreateKind("main")}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2.5 text-center transition-colors",
                            createKind === "main" ? "border-[var(--brand-green)] bg-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                          )}
                        >
                          <Hash className="h-4 w-4" />
                          <span className="text-xs font-medium">ห้องใหม่แยกอิสระ</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={topLevelParentOptions.length === 0}
                        onClick={() => setCreateKind("sub")}
                        title={topLevelParentOptions.length === 0 ? "ยังไม่มีหัวข้อหลักให้เลือก — สร้างหัวข้อหลักก่อน" : undefined}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2.5 text-center transition-colors",
                          topLevelParentOptions.length === 0
                            ? "border-[var(--line)] opacity-40 cursor-not-allowed"
                            : createKind === "sub"
                              ? "border-[var(--brand-green)] bg-[var(--accent)]"
                              : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                        )}
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span className="text-xs font-medium">ห้องย่อย ชั้น 1</span>
                      </button>
                      <button
                        type="button"
                        disabled={subParentOptions.length === 0}
                        onClick={() => setCreateKind("subsub")}
                        title={subParentOptions.length === 0 ? "ยังไม่มีหัวข้อย่อยให้เลือก — สร้างหัวข้อย่อยก่อน" : undefined}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2.5 text-center transition-colors",
                          subParentOptions.length === 0
                            ? "border-[var(--line)] opacity-40 cursor-not-allowed"
                            : createKind === "subsub"
                              ? "border-[var(--brand-green)] bg-[var(--accent)]"
                              : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                        )}
                      >
                        <ChevronsRight className="h-4 w-4" />
                        <span className="text-xs font-medium">ห้องย่อย ชั้น 2</span>
                      </button>
                    </div>
                    {createKind === "main" ? (
                      // Set expectations up front — a top-level topic is a
                      // category to organize sub-topics under, not a room in
                      // its own right, but it's never left empty: "daily-report"
                      // (itself holding "weekly-report"/"monthly-report") comes
                      // along automatically (delete any of them after if
                      // unwanted). No more "a-talk" alongside it.
                      <p className="text-[11px] text-[var(--ink-soft)]">
                        หัวข้อหลักไว้จัดหมวดหมู่เท่านั้น กดแชทเองไม่ได้ — มาพร้อมห้องย่อย &quot;daily-report&quot; (ที่มี &quot;weekly-report&quot;/&quot;monthly-report&quot; ซ้อนอยู่ข้างใน) ให้อัตโนมัติ
                      </p>
                    ) : createKind === "sub" ? (
                      <div className="space-y-1.5">
                        {/* Ties the label back to what the button said —
                            "ชั้น 1" alone on the button, explained in one
                            plain sentence here so it's never just a number
                            to interpret ("งง ยุ" — the button label change
                            alone wasn't enough on its own). */}
                        <p className="text-[11px] text-[var(--ink-soft)]">ห้องย่อยชั้น 1 — ซ้อนอยู่ใต้ห้องหลักโดยตรง เป็นห้องที่กดแชทได้เองเลย{quickCreateParentId ? "" : " เลือกห้องหลักที่จะซ้อนเข้าไป:"}</p>
                        {quickCreateParentId ? (
                          // มาจากปุ่ม + ที่หัวข้อใดหัวข้อหนึ่งโดยตรง (openCreate(t.id))
                          // — รู้อยู่แล้วว่าจะซ้อนใต้หัวข้อไหน ไม่ต้องโชว์ดรอปดาวน์
                          // ให้เลือกได้ทุกหัวข้อหลักในบริษัทอีก ("เลือกได้ทุกห้อง
                          // เลยมันเยอะเกินไป") — อยากได้หัวข้ออื่น ปิดแล้วกด
                          // "+ หัวข้อใหม่" จากแถบด้านล่างแทน
                          <p className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-[12.5px] text-[var(--ink)]">
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
                            ซ้อนอยู่ใต้หัวข้อ &quot;{topics.find((t) => t.id === quickCreateParentId)?.name}&quot;
                          </p>
                        ) : topLevelParentOptions.length === 0 ? (
                          <p className="text-[11px] text-[var(--ink-soft)]">ยังไม่มีหัวข้อหลักในระบบเลย — สร้างหัวข้อหลักก่อนอันนี้ แล้วค่อยกลับมาสร้างหัวข้อย่อยใต้มันทีหลังได้</p>
                        ) : (
                          <Select value={parentId ?? ""} onValueChange={(v) => v && setParentId(v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue>{parentId ? topics.find((t) => t.id === parentId)?.name : "เลือกหัวข้อหลัก..."}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {topLevelParentOptions.map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    ) : createKind === "subsub" ? (
                      <div className="space-y-1.5">
                        {/* Opened via a specific topic's own + (quickCreateParentId
                            set) — only that topic's own sub-topics belong here,
                            not every sub-topic company-wide ("ตัวเลือกลูกจะเอามา
                            แสดงแค่ห้องในหัวข้อนั้นพอแล้ว"). Want to nest under a
                            sub-topic somewhere else entirely? That's what the
                            top-right "+ สร้างหัวข้อ" button (no quickCreateParentId,
                            full company-wide grouped list below) is for. */}
                        <p className="text-[11px] text-[var(--ink-soft)]">ห้องย่อยชั้น 2 — ซ้อนอยู่ใต้ห้องย่อยชั้น 1 อีกที (ลึกสุด) เลือกห้องย่อยที่จะซ้อนเข้าไป:</p>
                        {quickCreateParentId ? (
                          scopedSubParentOptions.length === 0 ? (
                            <p className="text-[11px] text-[var(--ink-soft)]">หัวข้อ &quot;{topics.find((t) => t.id === quickCreateParentId)?.name}&quot; ยังไม่มีหัวข้อย่อยชั้น 1 เลย — สร้างหัวข้อย่อยชั้น 1 ก่อน แล้วค่อยกลับมาสร้างชั้น 2 ทีหลังได้</p>
                          ) : (
                            <Select value={parentId ?? ""} onValueChange={(v) => v && setParentId(v)}>
                              <SelectTrigger className="w-full">
                                <SelectValue>
                                  {parentId
                                    ? topics.find((t) => t.id === parentId)?.name
                                    : "เลือกหัวข้อย่อยที่จะซ้อนเข้าไป..."}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {scopedSubParentOptions.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )
                        ) : subParentOptions.length === 0 ? (
                          <p className="text-[11px] text-[var(--ink-soft)]">ยังไม่มีหัวข้อย่อยในระบบเลย — สร้างหัวข้อย่อยชั้น 1 ก่อนอันนี้ แล้วค่อยกลับมาสร้างหัวข้อย่อยชั้น 2 ทีหลังได้</p>
                        ) : (
                          <Select value={parentId ?? ""} onValueChange={(v) => v && setParentId(v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue>
                                {parentId
                                  ? topics.find((t) => t.id === parentId)?.name
                                  : "เลือกหัวข้อย่อยที่จะซ้อนเข้าไป..."}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {subParentOptionsByParent.map(({ parentName, items }) => {
                                const collapsed = collapsedSubParentGroups.has(parentName);
                                return (
                                  <SelectGroup key={parentName}>
                                    {/* A clickable header, not the plain
                                        SelectLabel every other group uses —
                                        stopPropagation so toggling a group
                                        never also closes the dropdown or
                                        reads as picking an item. */}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggleSubParentGroupCollapsed(parentName);
                                      }}
                                      className="flex w-full items-center gap-1 px-1.5 py-1 text-xs text-muted-foreground hover:text-[var(--ink)] cursor-pointer"
                                    >
                                      <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", !collapsed && "rotate-90")} />
                                      {parentName}
                                    </button>
                                    {!collapsed && items.map((t) => (
                                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                    ))}
                                  </SelectGroup>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  // Read-only now, on purpose — this used to be an editable
                  // picker with the full list of topics to move to that had
                  // no cycle guard of its own (unlike drag reorder, which
                  // does), so choosing one of this topic's own descendants
                  // as its new parent was a real, reachable way to hang the
                  // whole tab. Moving a topic between parents now happens
                  // only through the sidebar's own drag reorder (see the ⠿
                  // "จัดลำดับห้อง" button), which already checks for exactly
                  // that — one place that can move a topic, one place that
                  // has to stay safe, instead of two ("อยากให้แค่เก็บข้อมูลพอ
                  // ให้ไปย้ายที่ตรงที่ลากให้ก่อนหน้าเป็นหลัก เพราะมันจะได้ใช้
                  // งานได้ง่ายกว่า").
                  canPickParent && parentOptions.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--ink-soft)]">หัวข้อนี้อยู่ภายใต้หัวข้อหลักไหน?</Label>
                      <p className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--ink)]">
                        {parentId ? topics.find((t) => t.id === parentId)?.name : "ไม่มี (หัวข้อนี้เป็นหัวข้อหลักเอง)"}
                      </p>
                      <p className="text-[11px] text-[var(--ink-soft)]">
                        จะย้ายหัวข้อนี้ไปที่อื่น ปิดหน้าต่างนี้แล้วลากในแถบข้าง (ปุ่ม ⠿ &quot;จัดลำดับห้อง&quot;) แทน
                      </p>
                    </div>
                  )
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--ink-soft)]">คำอธิบาย (ถ้ามี)</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="บอกคร่าวๆ ว่าหัวข้อนี้ไว้คุยเรื่องอะไร"
                    rows={2}
                    className="resize-none"
                  />
                </div>
              </div>
            </div>

            {/* รูปแบบห้อง — create-only, matches the "Room Mode Picker" mockup:
                chosen once here, then locked (see feedViewMode's own comment
                on ReportTopic and room-settings-sheet.tsx). Rooms from before
                FEED_VIEW_MODE_LOCK_CUTOFF never went through this and stay
                editable in settings, so this section only exists in create mode. */}
            {editor?.mode === "create" && (
              <div className="rounded-xl border border-[var(--line)] overflow-hidden">
                <p className="px-3.5 py-2 text-xs font-semibold bg-[var(--bg-soft)] border-b border-[var(--line)]">รูปแบบห้อง</p>
                <div className="p-3.5 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFeedViewMode("threads")}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        feedViewMode === "threads" ? "border-[var(--brand-green)] bg-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">Thread</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--bg-soft)] text-[var(--ink-soft)]">Microsoft Teams</span>
                      </span>
                      <span className="text-[11px] text-[var(--ink-soft)] leading-snug">แต่ละโพสต์เป็นการ์ดเต็ม พร้อมตอบกลับในเธรดใต้โพสต์</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedViewMode("stream")}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        feedViewMode === "stream" ? "border-[var(--brand-green)] bg-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">Openchat</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--bg-soft)] text-[var(--ink-soft)]">Discord</span>
                      </span>
                      <span className="text-[11px] text-[var(--ink-soft)] leading-snug">ข้อความไหลต่อเนื่องเรียงเวลา เหมือนแชทกลุ่มทั่วไป</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--ink-soft)]">🔒 เลือกแล้วแก้ไม่ได้ — เปลี่ยนได้เฉพาะห้องที่สร้างไว้ก่อนหน้านี้</p>
                </div>
              </div>
            )}

            {/* รูปลักษณ์ — เหลือแค่ไอคอน; ช่องเลือก "สี" ถูกเอาออกไปแล้ว
                (เหมือน room-settings-sheet.tsx) เพราะ TopicLogo (ไอคอนจริง
                ที่แสดงในแถบข้าง/หัวห้อง) ไม่ได้ใช้สีนี้มาสักพักแล้ว — เลือก
                สีในนี้ไปก็ไม่มีผลอะไรให้เห็นจริงเลยสักที่ ("สีใช้งานไม่ได้") */}
            <div className="rounded-xl border border-[var(--line)] overflow-hidden">
              <p className="px-3.5 py-2 text-xs font-semibold bg-[var(--bg-soft)] border-b border-[var(--line)]">รูปลักษณ์</p>
              <div className="p-3.5 space-y-3.5">
                {/* Sub-topics are text-only (Discord/Slack "# channel" style) —
                    no custom icon or logo upload, only a top-level topic gets one. */}
                {!isSubTopic && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-[var(--ink-soft)]">ไอคอน</Label>
                      {logoUrl && (
                        <button
                          type="button"
                          onClick={() => setLogoUrl(undefined)}
                          className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--chart-red)]"
                        >
                          <X className="h-3 w-3" /> เอารูปที่อัปโหลดออก
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 rounded-lg bg-[var(--bg-soft)] p-2">
                      {iconOptions.map(({ key, icon: Icon }) => {
                        const selected = !logoUrl && icon === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setIcon(key);
                              setLogoUrl(undefined);
                            }}
                            aria-label={`เลือกไอคอน ${key}`}
                            className={cn(
                              "h-8 w-8 rounded-full flex items-center justify-center transition-colors",
                              selected
                                ? "bg-[var(--accent)] text-[var(--brand-green-dark)] ring-2 ring-offset-1 ring-[var(--line)]"
                                : "bg-white text-[var(--ink-soft)]"
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </button>
                        );
                      })}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleLogoFile(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)] transition-colors disabled:opacity-50 pt-0.5"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      {uploading ? "กำลังอัปโหลด..." : logoUrl ? "เปลี่ยนรูปโลโก้" : "หรืออัปโหลดรูปเป็นโลโก้ห้อง"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 px-5 py-3.5 border-t border-[var(--line)] bg-[var(--bg-soft)]">
            <Button variant="outline" onClick={() => setEditor(null)}>
              ยกเลิก
            </Button>
            <Button
              className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
              disabled={!name.trim() || (editor?.mode === "create" && createKind !== "main" && !parentId)}
              onClick={save}
            >
              {editor?.mode === "edit" ? "บันทึก" : "สร้างหัวข้อ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบหัวข้อนี้?</AlertDialogTitle>
            <AlertDialogDescription>โพสต์รีพอตทั้งหมดในหัวข้อนี้จะถูกลบไปด้วย — ย้อนกลับไม่ได้</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction className="bg-[var(--chart-red)] hover:bg-red-700 text-white" onClick={confirmDelete}>
              ลบหัวข้อ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
