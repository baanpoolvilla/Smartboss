"use client";

import { useMemo, useRef, useState } from "react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/modules/report_task/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { useReportFeedStore, topicColors, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useSettingsAccessStore } from "@/modules/report_task/store/settings-access-store";
import { canEditReportTopic, canManageReportTopics } from "@/modules/report_task/lib/permissions";
import { DRAG_MENTION_TOPIC_MIME } from "@/modules/report_task/components/report-feed/report-post-fields";
import { useTourStore, tourStepsByPage } from "@/modules/report_task/store/tour-store";
import { uploadCompressedImage } from "@/modules/report_task/lib/image-resize";
import { pendingToday } from "@/modules/report_task/lib/report-feed-compliance";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { postMentionsUser } from "@/modules/report_task/lib/report-feed-mentions";
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";
import {
  AtSign,
  Bell,
  Briefcase,
  ChevronRight,
  Clock,
  Code2,
  Crown,
  Eye,
  EyeOff,
  Flag,
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
  Rows3,
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

// Depth is capped at 2 (team > channel) to match MS Teams — a topic that
// already has children of its own can't also become someone else's child.
function isTopLevel(t: ReportTopic) {
  return !t.parentId;
}

export function TopicSidebar({
  topics,
  activeId,
  onSelect,
  fillHeight,
  onOpenSettings,
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
}) {
  const posts = useReportFeedStore((s) => s.posts);
  const addTopic = useReportFeedStore((s) => s.addTopic);
  const removeTopic = useReportFeedStore((s) => s.removeTopic);
  const updateTopicSettings = useReportFeedStore((s) => s.updateTopicSettings);
  const toggleFavoriteTopic = useReportFeedStore((s) => s.toggleFavoriteTopic);
  const toggleHiddenTopic = useReportFeedStore((s) => s.toggleHiddenTopic);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
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
  const [name, setName] = useState("");
  const [color, setColor] = useState(topicColors[0]!);
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  // Create-only: an explicit either/or instead of a dropdown defaulting to
  // "none" — you pick "หัวข้อหลัก" (a brand-new top-level topic) or
  // "หัวข้อย่อย" (nested under an existing one) up front, and the parent
  // picker only appears once "หัวข้อย่อย" is chosen. Forced to "หัวข้อหลัก"
  // when there's nothing eligible to nest under yet.
  const [createKind, setCreateKind] = useState<"main" | "sub">("main");
  // Create-only, same as createKind — chosen once here and never surfaced
  // again as an editable field for this room afterward (see room-settings-
  // sheet.tsx and feedViewMode's own comment on ReportTopic).
  const [feedViewMode, setFeedViewMode] = useState<"stream" | "threads">("stream");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Collapsed = chevron pointing right, hiding the sub-topics — every
  // top-level topic starts expanded so a first-time viewer sees the
  // Teams-style hierarchy immediately instead of a wall of collapsed rows.
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<Set<string>>(() => new Set());
  function toggleCollapsed(id: string) {
    setCollapsedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    setDescription("");
    setCreateKind(defaultParentId ? "sub" : "main");
    setFeedViewMode("stream");
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
      setLogoUrl(await uploadCompressedImage(file, 256, 0.85));
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
    // "หัวข้อย่อย" mode always needs a parent picked — the submit button is
    // disabled until one is, so this is just the last line of defense.
    if (editor?.mode === "create" && createKind === "sub" && !parentId) return;
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
        // Always on for "ห้องใหม่แยกอิสระ" — a top-level topic is a category
        // to organize sub-topics under, not a room in its own right. Only a
        // sub-topic is ever an actual place to post; create one under this
        // to get a working chat ("ต้องสร้างลูกก่อนถึงจะแชทได้").
        isCategory: createKind === "main" ? true : undefined,
      });
      setEditor(null);
      onSelect(id);
    }
  }

  // A topic that already has sub-topics of its own can't become a child
  // (keeps nesting to the two Teams-style levels) — and it obviously can't
  // be its own parent while being edited.
  const parentOptions = topics.filter(
    (t) => isTopLevel(t) && (editor?.mode !== "edit" || t.id !== editor.topic.id)
  );
  const canPickParent = editor?.mode !== "edit" || !topics.some((t) => t.parentId === editor.topic.id);
  // A sub-topic is text-only — no icon/logo picker, in the form or anywhere
  // else — so this mirrors the same effective-parent check `save()` uses.
  const isSubTopic = editor?.mode === "create" ? createKind === "sub" : !!parentId;

  function confirmDelete() {
    if (!deleteTarget) return;
    const wasActive = deleteTarget === activeId;
    removeTopic(deleteTarget);
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

  const exemptions = useReportComplianceExemptions();
  // Rooms this viewer personally still owes a report to today (⏰) and posts
  // anywhere they're @mentioned (@) — the two extra "มุมมองรวม" entries
  // above the topic tree, same data the room-scoped KPIs elsewhere already
  // compute, just re-scoped to "for me" instead of "for everyone"/"in this room".
  const pendingCount = useMemo(
    () => pendingToday(topics, posts, exemptions).filter((e) => e.userId === viewingAsUserId).length,
    [topics, posts, exemptions, viewingAsUserId]
  );
  // Unread only (not "ever mentioned") — clears once the post's actually
  // been opened (its own room, or the ที่กล่าวถึงฉัน view itself), same as
  // any other unread badge in this sidebar.
  const mentionCount = useMemo(() => {
    const visibleTopicIds = new Set(topics.map((t) => t.id));
    return posts.filter(
      (p) => visibleTopicIds.has(p.topicId) && p.unreadFor.includes(viewingAsUserId) && p.authorId !== viewingAsUserId && postMentionsUser(p, viewingAsUserId)
    ).length;
  }, [posts, topics, viewingAsUserId]);

  // Favorites are per-viewer (favoritedBy), not a global pin — split into
  // their own section above the rest so the rooms someone cares about most
  // don't get lost scrolling past everything else. Hierarchy only applies
  // within "the rest" — a favorited sub-topic surfaces on its own up top,
  // Teams-style quick access, rather than dragging its parent team along.
  const favoriteTopics = topics.filter((t) => t.favoritedBy?.includes(viewingAsUserId));
  const restTopics = topics.filter((t) => !t.favoritedBy?.includes(viewingAsUserId));
  // A sub-topic whose parent didn't make it into `restTopics` (favorited or
  // deleted) has nothing to nest under here, so it renders as its own
  // top-level row instead of vanishing.
  const topLevelRestTopics = restTopics.filter((t) => isTopLevel(t) || !restTopics.some((p) => p.id === t.parentId));
  // A sub-topic the viewer hid (Teams' "hide channel") stays in the tree —
  // dimmed, see below — rather than disappearing with no way back to it
  // short of a link from somewhere else. Its own "..." menu (renderTopicRow)
  // toggles it back on directly.
  const childrenOf = (parentId: string) => restTopics.filter((t) => t.parentId === parentId);

  function renderTopicRow(t: ReportTopic, opts?: { depth?: number; hasChildren?: boolean }) {
    const depth = opts?.depth ?? 0;
    const hasChildren = opts?.hasChildren ?? false;
    // `isCategory` (set at creation, see openCreate/handleSubmit) makes a
    // topic an organizing folder forever, even before it has any children
    // yet — a topic made this way is a category, never a room. Older topics
    // (created before this field existed) don't have it, so they keep the
    // grandfathered rule: postable on their own right up until they get
    // their first child, same as always.
    const canOpenDirectly = !t.isCategory && !hasChildren;
    const hiddenForMe = depth > 0 && (t.hiddenBy?.includes(viewingAsUserId) ?? false);
    const collapsed = collapsedTopicIds.has(t.id);
    const topicPosts = posts.filter((p) => p.topicId === t.id);
    const unreadCount = topicPosts.filter((p) => p.unreadFor.includes(viewingAsUserId)).length;
    // A parent topic almost never has posts of its own (it's an organizing
    // folder), so its own unreadCount is normally 0 even when a child
    // sub-topic underneath it has something new. Collapsed, that new post
    // would be invisible with no signal at all to expand and look — so the
    // dot (not the numeric badge, which stays this topic's own count only)
    // also lights up from descendants.
    const descendantUnread = hasChildren
      ? childrenOf(t.id).some((c) => posts.some((p) => p.topicId === c.id && p.unreadFor.includes(viewingAsUserId)))
      : false;
    const hasUnread = unreadCount > 0 || descendantUnread;
    const active = t.id === activeId;
    const favorited = t.favoritedBy?.includes(viewingAsUserId) ?? false;
    return (
      <div
        key={t.id}
        data-tour="topic-row"
        data-topic-id={t.id}
        data-topic-name={t.name}
        draggable
        onDragStart={(e) => {
          // Lets a room be tagged in a post by dragging it straight from
          // here into the composer's text box (report-post-fields.tsx),
          // instead of only via typing "@ห้องชื่อ" and picking it.
          e.dataTransfer.setData(DRAG_MENTION_TOPIC_MIME, JSON.stringify({ id: t.id, name: t.name }));
          e.dataTransfer.effectAllowed = "copy";
        }}
        className={cn(
          "group relative flex items-center gap-2 rounded-xl pr-2 cursor-pointer transition-colors duration-200 w-full",
          depth > 0 ? "pl-2 py-1.5 text-[13px]" : "pl-1.5 py-2 text-sm",
          // Hidden-for-me stays in the tree (so its own "..." menu is always
          // reachable to un-hide it) but reads as clearly dimmed either way.
          // Archived (Phase 6) reads the same way, for the same reason —
          // still findable to un-archive from its own ⚙, not hard-hidden.
          (hiddenForMe || t.archived) && "opacity-50",
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
        // A parent (has sub-topics) is an organizing folder only — clicking
        // its row just expands/collapses the sub-topic list underneath, same
        // as the chevron button. It has nothing of its own to "open" anymore
        // (see report-topic-children-panel.tsx, now settings-only).
        onClick={() => (depth === 0 && !canOpenDirectly ? toggleCollapsed(t.id) : onSelect(t.id))}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (depth === 0 && !canOpenDirectly) toggleCollapsed(t.id);
            else onSelect(t.id);
          }
        }}
      >
        {active && (
          // Brand green, not this topic's own arbitrary color (t.color can
          // land on red/orange for plenty of topics, purely as a visual
          // label for telling rooms apart elsewhere) — a green "selected"
          // background paired with a red/orange left bar reads as two
          // colors fighting over what they mean on the same row.
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--brand-green-dark)]" />
        )}
        {depth === 0 ? (
          hasChildren ? (
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
          ) : (
            <span className="shrink-0 w-3.5" />
          )
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
                className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--brand-green)] ring-2 ring-white"
                aria-hidden
              />
            )}
          </span>
        )}
        <span
          className={cn(
            "truncate flex-1 leading-none",
            depth === 0 || hasUnread ? "font-semibold" : "font-normal",
            active && "text-[var(--brand-green-dark)]"
          )}
        >
          {t.name}
        </span>
        {unreadCount > 0 && (
          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--brand-green)] text-[var(--ink)] text-[10px] font-semibold flex items-center justify-center tabular-nums">
            {unreadCount}
          </span>
        )}
        {/* Quick "add a sub-topic here" — opens the same create dialog as
            the main "+ สร้างหัวข้อ" button, just with this topic already
            picked as the parent, so you don't have to hunt for it in the
            dropdown. Only top-level topics can take a sub-topic. */}
        {depth === 0 && canManageTopics && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openCreate(t.id);
            }}
            className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
            aria-label={`สร้างหัวข้อย่อยใต้ ${t.name}`}
            title={`สร้างหัวข้อย่อยใต้ "${t.name}"`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        {/* A parent (has sub-topics) is an organizing folder, not somewhere
            to browse/post — favoriting only makes sense on a room you can
            actually open, i.e. a leaf topic or a sub-topic. */}
        {canOpenDirectly && (
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
                : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
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
        {(canEditReportTopic(t.visibility, viewingAsUserId) || canManageTopics || depth > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "shrink-0 flex h-5 w-5 items-center justify-center rounded text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] transition-opacity",
                    hiddenForMe
                      ? "opacity-100"
                      : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                  )}
                  aria-label={`ตัวเลือกหัวข้อ ${t.name}`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              }
            />
            <DropdownMenuContent align="end">
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

  // A top-level topic plus (if expanded) its indented sub-topics — the
  // Teams "team, then its channels" block as one unit. Plain indentation,
  // no connector line — just tucked further right under the parent.
  function renderTopicBranch(t: ReportTopic) {
    const children = childrenOf(t.id);
    const hasChildren = children.length > 0;
    const showChildren = hasChildren && !collapsedTopicIds.has(t.id);
    // A little extra room after this group's last child before the next
    // parent starts, on top of the list's own space-y-1 — keeps groups
    // visually separated without opening up large gaps within a group.
    return (
      <div key={t.id} className={showChildren ? "mb-2 space-y-0.5" : undefined}>
        {renderTopicRow(t, { depth: 0, hasChildren })}
        {showChildren && children.map((child) => renderTopicRow(child, { depth: 1 }))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        // No card frame at all — a border+white-fill box sitting right next
        // to the room panel's own box read as two stacked "this is a boxed
        // thing" signals before a single post even came into view
        // ("กรอบซ้อนกันหลายชั้น"). A faint tinted background instead of
        // white is enough on its own to read as "a different area" next to
        // the room panel's white, the same way Notion/Linear separate a nav
        // rail from its content with color contrast, not a drawn line.
        "w-full lg:w-[280px] lg:h-full lg:shrink-0 bg-[color-mix(in_srgb,var(--bg-soft)_55%,white)] flex flex-col min-h-0 overflow-hidden",
        fillHeight ? "h-full" : "h-64"
      )}
    >
      {/* Header separated by spacing (extra bottom padding) instead of a
          border-b now — one less hard rule stacking on top of the section
          divider just below it and the card's own outer border, all three
          of which used to draw in the same tight space. */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <p className="text-[15px] font-semibold">หัวข้อ</p>
        {canManageTopics && (
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
        )}
      </div>

      <div className="px-2.5 pt-1">
        <p className="px-2.5 pb-1 text-[11px] font-semibold text-[var(--ink-soft)] uppercase tracking-wide">ภาพรวม</p>
        {/* Not a real topic — a merged read-across-everything view (see
            ReportAllPostsFeed), pinned above the tree since it isn't part
            of the hierarchy it's summarizing. */}
        <button
          onClick={() => onSelect(ALL_TOPICS_ID)}
          className={cn(
            "w-full flex items-center gap-2.5 rounded-xl pl-3 pr-2 py-2.5 text-sm text-left transition-colors duration-200",
            activeId === ALL_TOPICS_ID ? "bg-[var(--accent)] font-semibold text-[var(--brand-green-dark)]" : "hover:bg-[var(--bg-soft)] text-[var(--ink)]"
          )}
        >
          <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)]">
            <Rows3 className="h-3.5 w-3.5" />
          </span>
          โพสต์ทั้งหมด
        </button>
        {/* ที่ฉันต้องส่ง — rooms this viewer personally hasn't posted to yet
            today (PendingTopicsPanel). ที่กล่าวถึงฉัน — every post/reply
            anywhere they're @mentioned (ReportAllPostsFeed, pre-filtered). */}
        <button
          onClick={() => onSelect(PENDING_ID)}
          className={cn(
            "w-full flex items-center gap-2.5 rounded-xl pl-3 pr-2 py-2.5 text-sm text-left transition-colors duration-200",
            activeId === PENDING_ID ? "bg-[var(--accent)] font-semibold text-[var(--brand-green-dark)]" : "hover:bg-[var(--bg-soft)] text-[var(--ink)]"
          )}
        >
          <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 text-[var(--chart-amber)]">
            <Clock className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 truncate">รอฉันส่ง</span>
          {pendingCount > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--chart-red)] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => onSelect(MENTIONS_ID)}
          className={cn(
            "w-full flex items-center gap-2.5 rounded-xl pl-3 pr-2 py-2.5 text-sm text-left transition-colors duration-200",
            activeId === MENTIONS_ID ? "bg-[var(--accent)] font-semibold text-[var(--brand-green-dark)]" : "hover:bg-[var(--bg-soft)] text-[var(--ink)]"
          )}
        >
          <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-[var(--chart-blue)]">
            <AtSign className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 truncate">กล่าวถึงฉัน</span>
          {mentionCount > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--chart-red)] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
              {mentionCount}
            </span>
          )}
        </button>
        {/* Spacing instead of a full-contrast rule — a hairline this close
            to the section above and the one below it read as one more hard
            line in a panel already asked to feel less boxed-in. Still a
            border, just faint enough to read as a gap between sections
            rather than a divider. */}
        <div className="my-3 border-t border-[var(--line)]/50" />
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
        {topLevelRestTopics.length > 0 && (
          <p className="px-2.5 pt-1 pb-1 text-[11px] font-semibold text-[var(--ink-soft)] uppercase tracking-wide">หัวข้อของฉัน</p>
        )}
        {topLevelRestTopics.map(renderTopicBranch)}

        {topics.length === 0 && (
          <p className="text-xs text-[var(--ink-soft)] px-2.5 py-3">ยังไม่มีหัวข้อ กด + หัวข้อใหม่ เพื่อเริ่มต้น</p>
        )}
      </div>

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
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="เช่น ทีมการเงิน"
                    onKeyDown={(e) => e.key === "Enter" && save()}
                  />
                </div>

                {editor?.mode === "create" ? (
                  <div className="space-y-1.5">
                    {/* Was "ประเภทหัวข้อ" + "หัวข้อย่อยของหัวข้อหลักที่มี" — a label
                        that reads as a generic category picker, paired with an
                        option long enough to need a second read to parse
                        ("อ่านละ งงๆ"). Renamed to what each button actually
                        does — a standalone room, or one nested under a room
                        that already exists — with a one-line caption under
                        each so the choice never depends on remembering what
                        "หัวข้อย่อย" means elsewhere in the app. */}
                    <Label className="text-xs text-[var(--ink-soft)]">สร้างห้องแบบไหน</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCreateKind("main")}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors",
                          createKind === "main" ? "border-[var(--brand-green)] bg-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                        )}
                      >
                        <Hash className="h-4 w-4" />
                        <span className="text-xs font-medium">ห้องใหม่แยกอิสระ</span>
                      </button>
                      <button
                        type="button"
                        disabled={parentOptions.length === 0}
                        onClick={() => setCreateKind("sub")}
                        title={parentOptions.length === 0 ? "ยังไม่มีหัวข้อหลักให้เลือก — สร้างหัวข้อหลักก่อน" : undefined}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors",
                          parentOptions.length === 0
                            ? "border-[var(--line)] opacity-40 cursor-not-allowed"
                            : createKind === "sub"
                              ? "border-[var(--brand-green)] bg-[var(--accent)]"
                              : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                        )}
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span className="text-xs font-medium">ห้องย่อยในห้องเดิม</span>
                      </button>
                    </div>
                    {createKind === "main" ? (
                      // Set expectations up front — a top-level topic is a
                      // category to group sub-topics under, not a chat room
                      // itself, even before it has any children yet. Saying
                      // this here (not just after the fact when it turns out
                      // un-clickable) is what a topic created without
                      // reading this used to get wrong ("งงทำไมกดแชทไม่ได้").
                      <p className="text-[11px] text-[var(--ink-soft)]">
                        หัวข้อหลักไว้จัดหมวดหมู่เท่านั้น กดแชทเองไม่ได้ — สร้างหัวข้อย่อยใต้มันทีหลังเพื่อเริ่มแชทจริง
                      </p>
                    ) : parentOptions.length === 0 ? (
                      <p className="text-[11px] text-[var(--ink-soft)]">ยังไม่มีหัวข้อหลักในระบบเลย — สร้างหัวข้อหลักก่อนอันนี้ แล้วค่อยกลับมาสร้างหัวข้อย่อยใต้มันทีหลังได้</p>
                    ) : createKind === "sub" ? (
                      <Select value={parentId ?? ""} onValueChange={(v) => v && setParentId(v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue>{parentId ? topics.find((t) => t.id === parentId)?.name : "เลือกหัวข้อหลัก..."}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {parentOptions.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                ) : (
                  canPickParent && parentOptions.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--ink-soft)]">หัวข้อนี้อยู่ภายใต้หัวข้อหลักไหน?</Label>
                      <Select value={parentId ?? "none"} onValueChange={(v) => setParentId(!v || v === "none" ? undefined : v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue>{parentId ? topics.find((t) => t.id === parentId)?.name : "ไม่มี (หัวข้อนี้เป็นหัวข้อหลักเอง)"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">ไม่มี (หัวข้อนี้เป็นหัวข้อหลักเอง)</SelectItem>
                          {parentOptions.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
              disabled={!name.trim() || (editor?.mode === "create" && createKind === "sub" && !parentId)}
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
