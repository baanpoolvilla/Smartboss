"use client";

import { useRef, useState } from "react";
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
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";
import {
  Bell,
  Briefcase,
  Check,
  ChevronRight,
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
  Search,
  Settings2,
  ShoppingCart,
  Sparkles,
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
  return (
    <span
      className={cn("relative shrink-0 rounded-full flex items-center justify-center", size)}
      style={{ backgroundColor: `color-mix(in srgb, ${topic.color} 16%, white)` }}
    >
      <Icon className="h-3.5 w-3.5" style={{ color: topic.color }} />
    </span>
  );
}

/** Selecting this instead of a real topic id switches the main panel to the merged "ภาพรวมทั้งหมด" feed (see report-all-posts-feed.tsx) — a sentinel rather than a real topic since it isn't one. */
export const ALL_TOPICS_ID = "__all__";

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
}: {
  /** Pre-filtered to what this viewer can see — see canSeeReportTopic in the parent page. */
  topics: ReportTopic[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Full height instead of the desktop-layout's fixed `h-64`/`lg:h-full`
   * split — for reuse inside the mobile topics Sheet (3.5.5), which already
   * gives it a definite height of its own to fill. */
  fillHeight?: boolean;
}) {
  const posts = useReportFeedStore((s) => s.posts);
  const addTopic = useReportFeedStore((s) => s.addTopic);
  const removeTopic = useReportFeedStore((s) => s.removeTopic);
  const updateTopicSettings = useReportFeedStore((s) => s.updateTopicSettings);
  const seedDemoData = useReportFeedStore((s) => s.seedDemoData);
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
      updateTopicSettings(editor.topic.id, { name: trimmed, color, icon: effectiveIcon, logoUrl: effectiveLogoUrl, parentId: effectiveParentId, description: trimmedDescription });
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

  const [query, setQuery] = useState("");
  const visibleTopics = query.trim() ? topics.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase())) : topics;
  // Favorites are per-viewer (favoritedBy), not a global pin — split into
  // their own section above the rest so the rooms someone cares about most
  // don't get lost scrolling past everything else. Hierarchy only applies
  // within "the rest" — a favorited sub-topic surfaces on its own up top,
  // Teams-style quick access, rather than dragging its parent team along.
  const favoriteTopics = visibleTopics.filter((t) => t.favoritedBy?.includes(viewingAsUserId));
  const restTopics = visibleTopics.filter((t) => !t.favoritedBy?.includes(viewingAsUserId));
  // A sub-topic whose parent didn't make it into `restTopics` (favorited,
  // filtered out by search, or deleted) has nothing to nest under here, so
  // it renders as its own top-level row instead of vanishing.
  const topLevelRestTopics = restTopics.filter((t) => isTopLevel(t) || !restTopics.some((p) => p.id === t.parentId));
  // A sub-topic the viewer hid (Teams' "hide channel") stays in the tree —
  // dimmed, see below — rather than disappearing with no way back to it
  // short of a link from somewhere else. Its own "..." menu (renderTopicRow)
  // toggles it back on directly.
  const childrenOf = (parentId: string) => restTopics.filter((t) => t.parentId === parentId);

  function renderTopicRow(t: ReportTopic, opts?: { depth?: number; hasChildren?: boolean }) {
    const depth = opts?.depth ?? 0;
    const hasChildren = opts?.hasChildren ?? false;
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
                "hover:bg-[var(--bg-soft)]",
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
        onClick={() => (depth === 0 && hasChildren ? toggleCollapsed(t.id) : onSelect(t.id))}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (depth === 0 && hasChildren) toggleCollapsed(t.id);
            else onSelect(t.id);
          }
        }}
      >
        {active && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
            style={{ backgroundColor: t.color }}
          />
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
        <span className="relative shrink-0">
          {/* Sub-topics don't carry a custom icon/logo — a plain "#" keeps
              the row to text only, same as the sub-topic create/edit form. */}
          {depth > 0 ? (
            <span className="flex h-5 w-5 items-center justify-center text-[var(--ink-soft)] font-semibold" aria-hidden>
              #
            </span>
          ) : (
            <TopicLogo topic={t} size="h-6 w-6" />
          )}
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
            to browse/post — favoriting only makes sense on an actual leaf
            room, whether that's a standalone topic or a sub-topic. */}
        {!hasChildren && (
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
        "w-full lg:w-[280px] lg:h-full lg:shrink-0 rounded-2xl border border-[var(--line)] bg-white shadow-sm flex flex-col min-h-0 overflow-hidden",
        fillHeight ? "h-full border-none rounded-none shadow-none" : "h-64"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-4 border-b border-[var(--line)]">
        <p className="text-[15px] font-semibold">หัวข้อทั้งหมด</p>
        {canManageTopics && (
          <Button
            size="sm"
            className="h-8 gap-1 rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white px-3.5 text-xs transition-transform active:scale-[0.99]"
            onClick={() => openCreate()}
          >
            <Plus className="h-3.5 w-3.5" />
            สร้างหัวข้อ
          </Button>
        )}
      </div>

      <div className="px-3.5 pt-3.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาหัวข้อ..."
            aria-label="ค้นหาหัวข้อ"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] pl-8 pr-2.5 py-1.5 text-xs outline-none focus:border-[var(--brand-green)]/50 focus:bg-white transition-colors"
          />
        </div>
      </div>

      <div className="px-2.5 pt-2.5">
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
          ภาพรวมทั้งหมด
        </button>
        <div className="my-2 border-t border-[var(--line)]" />
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-1">
        {favoriteTopics.length > 0 && (
          <>
            <p className="px-2.5 pt-1 pb-1 text-[11px] font-semibold text-[var(--ink-soft)] uppercase tracking-wide">รายการโปรด</p>
            {favoriteTopics.map((t) => renderTopicRow(t))}
            <div className="my-2 border-t border-[var(--line)]" />
          </>
        )}
        {topLevelRestTopics.map(renderTopicBranch)}

        {topics.length === 0 && (
          <p className="text-xs text-[var(--ink-soft)] px-2.5 py-3">ยังไม่มีหัวข้อ กด + สร้างหัวข้อ เพื่อเริ่มต้น</p>
        )}
        {topics.length > 0 && visibleTopics.length === 0 && (
          <p className="text-xs text-[var(--ink-soft)] px-2.5 py-3">ไม่พบหัวข้อที่ตรงกับ &quot;{query}&quot;</p>
        )}
      </div>

      <button
        onClick={() => {
          seedDemoData();
          onSelect("topic-demo-dev");
        }}
        className="flex items-center gap-1.5 px-3.5 py-3 text-xs text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)] border-t border-[var(--line)]"
      >
        <Sparkles className="h-3.5 w-3.5" />
        โหลดข้อมูลตัวอย่าง
      </button>

      <Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editor?.mode === "edit" ? "แก้ไขหัวข้อ" : "สร้างหัวข้อใหม่"}</DialogTitle>
            <DialogDescription>
              {isSubTopic ? "ตั้งชื่อและสีประจำห้อง — แก้ทีหลังได้เสมอ" : "ตั้งชื่อ สี และไอคอน/รูปประจำห้อง — แก้ทีหลังได้เสมอ"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-2 py-2">
            {isSubTopic ? (
              <span className="flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold text-[var(--ink-soft)]" aria-hidden>
                #
              </span>
            ) : (
              <div className="rounded-full p-1" style={{ boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 20%, transparent)` }}>
                <TopicLogo topic={previewTopic} size="h-14 w-14" />
              </div>
            )}
            <span className="text-sm font-semibold truncate max-w-full">{previewTopic.name}</span>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">ชื่อหัวข้อใหม่</Label>
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
                <Label className="text-xs text-[var(--ink-soft)]">ประเภทหัวข้อ</Label>
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
                    <span className="text-xs font-medium">หัวข้อหลักใหม่</span>
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
                    <span className="text-xs font-medium">หัวข้อย่อยของหัวข้อหลักที่มี</span>
                  </button>
                </div>
                {parentOptions.length === 0 ? (
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

            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">สี</Label>
              <div className="flex items-center gap-2.5 flex-wrap">
                {topicColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`เลือกสี ${c}`}
                    className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-transform",
                      color === c && "scale-110 ring-2 ring-offset-2 ring-[var(--line)]"
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {color === c && <Check className="h-3.5 w-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </div>

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
                <div className="flex flex-wrap gap-2">
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
                        className="h-8 w-8 rounded-full flex items-center justify-center transition-colors"
                        style={
                          selected
                            ? { backgroundColor: `color-mix(in srgb, ${color} 18%, white)`, color }
                            : { backgroundColor: "var(--bg-soft)", color: "var(--ink-soft)" }
                        }
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

          <DialogFooter>
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
