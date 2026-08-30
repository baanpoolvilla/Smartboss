"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Button } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/modules/report_task/components/ui/dialog";
import { NewTaskDialog } from "@/modules/report_task/components/kanban/new-task-dialog";
import { getUser, users as directoryUsers, departments } from "@/modules/report_task/lib/directory";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import {
  useReportFeedStore,
  topicColors,
  type ReportPost,
  type ReportPostImage,
  type ReportPostReply,
  type ReportTopic,
} from "@/modules/report_task/store/report-feed-store";
import { lateCutoffFor, minImagesNow, onTimeCutoffFor } from "@/modules/report_task/lib/report-cutoff";
import { localDateStr } from "@/modules/report_task/lib/now";
import {
  bulletsTextToHtml,
  CHECKLIST_CHECKED,
  CHECKLIST_UNCHECKED,
  htmlEditorToBulletsText,
  renderRichBulletText,
  renderSectionBullets,
  type MentionType,
} from "@/modules/report_task/lib/report-feed-rich-text";
import { uploadCompressedImage } from "@/modules/report_task/lib/image-resize";
import { ReportPostFields, newSection, type DraftSection } from "@/modules/report_task/components/report-feed/report-post-fields";
import { useReportTagStore } from "@/modules/report_task/store/report-tag-store";
import { ReportTagChip } from "@/modules/report_task/components/report-feed/report-tag-chip";
import { ReportImageLightbox } from "@/modules/report_task/components/report-feed/report-image-lightbox";
import { ReportReply } from "@/modules/report_task/components/report-feed/report-reply";
import { LinkInsertPopover } from "@/modules/report_task/components/report-feed/link-insert-popover";
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";
import { TimeAgo } from "@/modules/report_task/components/shared/time-ago";
import {
  Bold,
  Bookmark,
  BookmarkCheck,
  Building2,
  Check,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  ImagePlus,
  Italic,
  Link2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Quote,
  Reply as ReplyIcon,
  Send,
  Share2,
  SmilePlus,
  Trash2,
  TriangleAlert,
  Underline,
  User,
  X,
} from "lucide-react";

const reactionEmojis = ["👍", "❤️", "🎉", "😂", "😮", "😢"];
const LONG_POST_BULLET_THRESHOLD = 8;
const MAX_VISIBLE_IMAGES = 5;

interface ReplyMentionItem {
  type: MentionType;
  id: string;
  label: string;
  sublabel?: string;
}

/** Walks up from `el` to find the nearest scrolling ancestor's viewport
 * bounds — the mention menu opens above or below the caret depending on
 * which direction actually has room within *that* box, not the window
 * (this editor sits inside a card inside a scrollable feed). Same helper
 * as openchat-feed.tsx's, duplicated rather than shared since each
 * composer's mention wiring is already its own local, self-contained block. */
function nearestScrollableBounds(el: HTMLElement): { top: number; bottom: number } {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }
    node = node.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

/** Looks for `@query` immediately before the caret in the current text node
 * and returns its position — null when the caret isn't inside `el`, isn't in
 * a text node, or there's no unfinished `@word` right before it. */
function detectMentionTrigger(el: HTMLElement): { query: string; rect: DOMRect; containerTop: number; containerBottom: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || !el.contains(sel.getRangeAt(0).startContainer)) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const before = (node.textContent ?? "").slice(0, range.startOffset);
  const match = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const caretRange = range.cloneRange();
  const rect = caretRange.getClientRects()[0] ?? caretRange.getBoundingClientRect();
  const bounds = nearestScrollableBounds(el);
  return { query: match[1]!, rect, containerTop: bounds.top, containerBottom: bounds.bottom };
}

export function ReportCard({
  post,
  topic,
  highlighted,
  highlightReplyId,
  topicBadge,
  onOpenTask,
}: {
  post: ReportPost;
  topic: ReportTopic;
  highlighted?: boolean;
  /** A specific reply to scroll to and flash on mount — from a "copy link" deep link that pointed at one comment, not just the post. */
  highlightReplyId?: string | null;
  /** "ทีมพัฒนา › เช็คอินประจำวัน" breadcrumb tag in the post's own header —
   * only ภาพรวมทั้งหมด passes this (V3): inside a single room's own feed the
   * topic is already implicit from the room you're looking at. */
  topicBadge?: { label: string; onClick: () => void };
  /** "เปิดเป็นงาน" — opens the Task Board's detail sheet in place, for a post
   * already linked to a task. Absent means the page hosting this card hasn't
   * wired up a task sheet, so the menu item silently no-ops. */
  onOpenTask?: (taskId: string) => void;
}) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const toggleReaction = useReportFeedStore((s) => s.toggleReaction);
  const addReply = useReportFeedStore((s) => s.addReply);
  const editReplyAction = useReportFeedStore((s) => s.editReply);
  const deleteReplyAction = useReportFeedStore((s) => s.deleteReply);
  const toggleReplyReaction = useReportFeedStore((s) => s.toggleReplyReaction);
  const removePost = useReportFeedStore((s) => s.removePost);
  const editPost = useReportFeedStore((s) => s.editPost);
  const togglePin = useReportFeedStore((s) => s.togglePin);
  const toggleSave = useReportFeedStore((s) => s.toggleSave);
  const toggleUnread = useReportFeedStore((s) => s.toggleUnread);
  const setPostLinkedTask = useReportFeedStore((s) => s.setPostLinkedTask);
  const allTags = useReportTagStore((s) => s.tags);
  const postTags = allTags.filter((t) => post.tagIds.includes(t.id));
  const author = getUser(post.authorId);
  const viewer = getUser(viewingAsUserId);
  const isOwn = post.authorId === viewingAsUserId;
  const isSaved = post.savedBy.includes(viewingAsUserId);
  const isUnread = post.unreadFor.includes(viewingAsUserId);
  const lateCutoff = lateCutoffFor(post.createdAt, topic.cutoffs);
  const onTimeCutoff = !lateCutoff ? onTimeCutoffFor(post.createdAt, topic.cutoffs) : null;
  const allPosts = useReportFeedStore((s) => s.posts);
  // Once you're past a cutoff, *every* post you make that day gets flagged
  // "ส่งช้า" — technically true of each one, but posting twice just repeated
  // the same fact back and read as if something new had gone wrong each
  // time ("จะแสดงแค่ส่งช้าอันเดียวสิ...โพสอีกมันก็เด้งขึ้นว่าโพสช้าอีกอัน").
  // Only the earliest post by this author, in this room, under this same
  // round, on this same day actually shows the badge — later ones already
  // said it once.
  const isFirstLateOfRound =
    !lateCutoff ||
    !allPosts.some(
      (p) =>
        p.id !== post.id &&
        p.topicId === post.topicId &&
        p.authorId === post.authorId &&
        localDateStr(new Date(p.createdAt)) === localDateStr(new Date(post.createdAt)) &&
        lateCutoffFor(p.createdAt, topic.cutoffs)?.id === lateCutoff.id &&
        new Date(p.createdAt).getTime() < new Date(post.createdAt).getTime()
    );

  const [replyText, setReplyText] = useState("");
  const [replyImages, setReplyImages] = useState<ReportPostImage[]>([]);
  const [replyHighlight, setReplyHighlight] = useState<string | undefined>(undefined);
  const [replyUploading, setReplyUploading] = useState(false);
  const [replyColorPickerOpen, setReplyColorPickerOpen] = useState(false);
  const replyEditorRef = useRef<HTMLDivElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  // @mention in the reply box — this composer never got the trigger/insert
  // mechanics the main post composer and Openchat's flat composer both have
  // (report-post-fields.tsx, openchat-feed.tsx), so typing "@" here did
  // nothing at all in Thread mode ("แบบ thread ไม่เห็น@และขึ้นเลย"). Same
  // marker format (`@[label](type:id)`, see report-feed-rich-text.tsx) and
  // detection logic as those two, just scoped to people/departments — this
  // component only has the one topic it's rendering into, not the full topic
  // list a room mention would need to search across.
  //
  // Users are filtered to who can actually see *this* room (same rule the
  // member-count button and RoomMembersDialog use) — the first version
  // listed the whole company directory regardless of room, which meant you
  // could @tag someone with no access to the conversation at all ("ต้อง
  // แสดงเฉพาะคนที่อยู่ในห้องนั้นไหม"). Departments stay unfiltered — a dept
  // mention is a notify-this-group action, not scoped to room membership.
  const replyMentionCandidates = useMemo<ReplyMentionItem[]>(
    () => [
      ...directoryUsers
        .filter((u) => canSeeReportTopic(topic.visibility, u.id))
        .map((u): ReplyMentionItem => ({ type: "user", id: u.id, label: u.name, sublabel: u.role })),
      ...departments.map((d): ReplyMentionItem => ({ type: "dept", id: d.id, label: d.name, sublabel: "แผนก" })),
    ],
    [topic.visibility]
  );
  const [replyMentionMenu, setReplyMentionMenu] = useState<{ query: string; rect: DOMRect; containerTop: number; containerBottom: number; index: number } | null>(null);

  function replyMentionMatches(query: string): ReplyMentionItem[] {
    const q = query.trim().toLowerCase();
    const all = q ? replyMentionCandidates.filter((m) => m.label.toLowerCase().includes(q)) : replyMentionCandidates;
    return all.slice(0, 8);
  }

  function syncReplyMentionMenu(el: HTMLElement) {
    const trigger = detectMentionTrigger(el);
    setReplyMentionMenu(trigger ? { ...trigger, index: 0 } : null);
  }

  function insertReplyMention(item: ReplyMentionItem) {
    const el = replyEditorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const nodeText = node.textContent ?? "";
    const before = nodeText.slice(0, range.startOffset);
    const atIndex = before.lastIndexOf("@");
    if (atIndex === -1) return;
    const afterCaret = nodeText.slice(range.startOffset);
    const parent = node.parentNode;
    if (!parent) return;

    const chip = document.createElement("span");
    chip.className = "mention-chip inline-flex items-center rounded bg-[var(--accent)] text-[var(--brand-green-dark)] px-1 font-medium";
    chip.contentEditable = "false";
    chip.setAttribute("data-mention-type", item.type);
    chip.setAttribute("data-mention-id", item.id);
    chip.textContent = `@${item.label}`;

    const afterNode = document.createTextNode(afterCaret);
    const spaceNode = document.createTextNode(" ");
    parent.replaceChild(afterNode, node);
    parent.insertBefore(document.createTextNode(nodeText.slice(0, atIndex)), afterNode);
    parent.insertBefore(chip, afterNode);
    parent.insertBefore(spaceNode, afterNode);

    const newRange = document.createRange();
    newRange.setStart(spaceNode, spaceNode.length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setReplyMentionMenu(null);
    setReplyText(htmlEditorToBulletsText(el));
  }
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteReplyTarget, setDeleteReplyTarget] = useState<string | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Touch's combined react/reply/edit/more menu — separate from moreOpen
  // (the hover toolbar's own "..." submenu) since the two triggers are
  // mutually exclusive by media query and would otherwise fight over the
  // same open/close state.
  const [touchMenuOpen, setTouchMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [editing, setEditing] = useState(false);
  // Collapsed comment box's formatting toolbar (B/I/U/link/highlight) only
  // shows once the input actually has focus — attach/send stay visible
  // either way so the box still reads as "you can reply here" at rest.
  const [replyFocused, setReplyFocused] = useState(false);
  const [repliesExpanded, setRepliesExpanded] = useState(false);
  // Teams-style "Reply in thread" — replies + the compose box used to render
  // unconditionally under every single post (a permanently-open text box on
  // a room with 50 posts read as a wall of empty input fields, not a chat
  // feed). Collapsed by default now; opens on the reply icon, the reply-
  // count link, or a deep link into a specific reply (see the effects below).
  const [threadOpen, setThreadOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [replyLightbox, setReplyLightbox] = useState<{ images: ReportPostImage[]; index: number } | null>(null);
  // Which reply the box is currently answering, if any — shows a quoted
  // reference above the input and tags the new reply with replyToId.
  const [replyingTo, setReplyingTo] = useState<ReportPostReply | null>(null);
  // "reply" (clicked ตอบกลับ on a specific comment) vs "quote" (clicked
  // อ้างอิงโพสต์นี้ on the post itself) — same replyToId/banner machinery
  // underneath, but labeled differently so it's obvious which one this is,
  // instead of both reading as an identical generic "ตอบกลับ" tag.
  const [quoteKind, setQuoteKind] = useState<"reply" | "quote" | null>(null);
  // Whatever a quote block was just clicked to jump to (a reply id, or the
  // post's own id) — briefly flashed so it's obvious what "อ้างอิง" pointed
  // at, since scrolling alone can leave you unsure which item is the target.
  const [flashTargetId, setFlashTargetId] = useState<string | null>(null);

  const bulletCount = post.sections.reduce((n, s) => n + s.bullets.length, 0);
  const isLong = bulletCount > LONG_POST_BULLET_THRESHOLD;
  const visibleSections = !isLong || showFull ? post.sections : post.sections.slice(0, 2);

  const activeReactions = reactionEmojis
    .map((emoji) => ({ emoji, users: post.reactions[emoji] ?? [] }))
    .filter((r) => r.users.length > 0);

  // Teams-style collapsed thread summary ("การตอบกลับ 2 รายการ จาก Waratta-Nok
  // และ Kenika-bell") — asked for explicitly after a Teams screenshot showed
  // nothing but this one link until it's tapped, not even the most recent
  // reply. Names in order of first appearance, capped at 2 with "และอีก N คน"
  // once a thread has more distinct repliers than that.
  const replySummary = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const r of post.replies) {
      const name = getUser(r.authorId)?.name;
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    const shown = names.slice(0, 2);
    const extra = names.length - shown.length;
    const who = extra > 0 ? `${shown.join(", ")} และอีก ${extra} คน` : shown.join(" และ ");
    return post.replies.length === 1
      ? `การตอบกลับ 1 รายการ จาก ${who}`
      : `การตอบกลับ ${post.replies.length} รายการ จาก ${who}`;
  }, [post.replies]);

  // Uses the browser's native bold/italic/underline so the reply box shows
  // real formatting live as you type, same as the post composer's editor —
  // instead of literal **/__ marker text sitting in a plain <input>.
  // htmlEditorToBulletsText serializes it back to the same marker text
  // renderRichBulletText expects once posted.
  function execReplyFormat(command: string) {
    const el = replyEditorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false);
    setReplyText(htmlEditorToBulletsText(el));
  }

  // A bare http(s) URL is all renderRichBulletText needs to linkify a
  // reply — no separate marker syntax, so pasting/typing one directly works
  // the same as clicking this button.
  function insertReplyLink(url: string) {
    const el = replyEditorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand("insertText", false, url);
    setReplyText(htmlEditorToBulletsText(el));
  }

  function submitReply() {
    if (!replyText.trim() && replyImages.length === 0) return;
    addReply(post.id, viewingAsUserId, replyText.trim(), {
      images: replyImages.length > 0 ? replyImages : undefined,
      highlightColor: replyHighlight,
      replyToId: replyingTo?.id,
    });
    setReplyText("");
    setReplyImages([]);
    setReplyHighlight(undefined);
    setReplyingTo(null);
    setQuoteKind(null);
    // The editor is uncontrolled (like the composer's), so clear its DOM too.
    if (replyEditorRef.current) replyEditorRef.current.innerHTML = "";
  }

  function startReplyTo(reply: ReportPostReply) {
    setReplyingTo(reply);
    setQuoteKind("reply");
    setThreadOpen(true);
    requestAnimationFrame(() => replyEditorRef.current?.focus());
  }

  // Lets a reply quote the original post itself, not just another reply —
  // reuses the same replyingTo/quote-banner machinery by treating the post
  // as a reply-shaped { id, authorId, body }.
  function quotePost() {
    setReplyingTo({
      id: post.id,
      authorId: post.authorId,
      body: post.title,
      createdAt: post.createdAt,
    });
    setQuoteKind("quote");
    setThreadOpen(true);
    requestAnimationFrame(() => replyEditorRef.current?.focus());
    setMoreOpen(false);
  }

  // A quoted reference always points somewhere inside this same post (either
  // the post itself or one of its own replies), so this can stay a plain
  // local scroll — no cross-post lookup or page-level routing needed.
  //
  // Replies are all-or-nothing now (Teams-style: a collapsed summary link,
  // nothing rendered until it's expanded) — any reply target needs the
  // thread expanded first, or clicking a quote scrolled to nothing, silently,
  // since the element isn't in the DOM yet. Scroll happens on the next tick
  // once React's had a chance to render it.
  function jumpToQuote(id: string) {
    const needsExpand = id !== post.id && !repliesExpanded;
    if (needsExpand) setRepliesExpanded(true);
    const scroll = () => {
      const elId = id === post.id ? `report-post-${post.id}` : `report-reply-${id}`;
      document.getElementById(elId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashTargetId(id);
      setTimeout(() => setFlashTargetId((cur) => (cur === id ? null : cur)), 2000);
    };
    if (needsExpand) {
      setTimeout(scroll, 0);
    } else {
      scroll();
    }
  }

  // A deep link to a reply that's currently folded away behind the
  // collapsed summary link needs the thread expanded before there's
  // anything to scroll to — runs first so the effect below finds the reply
  // already in the DOM once `repliesExpanded` flips true and it re-runs.
  useEffect(() => {
    if (!highlightReplyId || repliesExpanded) return;
    if (!post.replies.some((r) => r.id === highlightReplyId)) return;
    setThreadOpen(true);
    const timer = setTimeout(() => setRepliesExpanded(true), 0);
    return () => clearTimeout(timer);
  }, [highlightReplyId, repliesExpanded, post.replies]);

  // A "copy link" deep link that pointed at one specific reply (?reply=) —
  // same scroll+flash as clicking a quote, just triggered by the URL instead
  // of a click, and only for a reply that actually belongs to this post.
  useEffect(() => {
    if (!highlightReplyId) return;
    if (!post.replies.some((r) => r.id === highlightReplyId)) return;
    // Wait for the expand effect above to actually apply before scrolling —
    // otherwise the target reply isn't in the DOM yet to scroll to.
    if (!repliesExpanded) return;
    // Deferred a tick — jumpToQuote's setState must not run synchronously
    // inside the effect body itself.
    const timer = setTimeout(() => jumpToQuote(highlightReplyId), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightReplyId, repliesExpanded]);

  async function handleReplyFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setReplyUploading(true);
    const next: ReportPostImage[] = [];
    try {
      for (const file of Array.from(files).slice(0, 6 - replyImages.length)) {
        const url = await uploadCompressedImage(file);
        next.push({ id: `img-${crypto.randomUUID()}`, url, name: file.name });
      }
    } catch {
      toast.error("แนบรูปไม่สำเร็จบางไฟล์ — ลองใหม่อีกครั้ง");
    } finally {
      // Keep whatever uploaded successfully before the failure — no reason
      // to throw away images that already finished just because a later one broke.
      if (next.length > 0) setReplyImages((prev) => [...prev, ...next]);
      setReplyUploading(false);
      if (replyFileInputRef.current) replyFileInputRef.current.value = "";
    }
  }

  function toggleChecklistItem(sectionId: string, bulletIndex: number) {
    const sections = post.sections.map((sec) => {
      if (sec.id !== sectionId) return sec;
      const bullets = sec.bullets.map((b, i) => {
        if (i !== bulletIndex) return b;
        if (b.startsWith(CHECKLIST_UNCHECKED)) return CHECKLIST_CHECKED + b.slice(CHECKLIST_UNCHECKED.length);
        if (b.startsWith(CHECKLIST_CHECKED)) return CHECKLIST_UNCHECKED + b.slice(CHECKLIST_CHECKED.length);
        return b;
      });
      return { ...sec, bullets };
    });
    editPost(post.id, { title: post.title, sections, images: post.images, tagIds: post.tagIds });
  }

  // With replyId, the link deep-links to that one comment (?reply=) instead
  // of just the post — same idea as Teams' parentMessageId, minus the
  // tenant/team/channel routing this single-tenant app doesn't need.
  function postUrl(replyId?: string) {
    const base = `${window.location.origin}${window.location.pathname}?topic=${topic.id}&post=${post.id}`;
    return replyId ? `${base}&reply=${replyId}` : base;
  }

  function copyLink(replyId?: string) {
    const url = postUrl(replyId);
    if (!navigator.clipboard) {
      toast.error("คัดลอกลิงก์ไม่สำเร็จ");
    } else {
      navigator.clipboard
        .writeText(url)
        .then(() => toast.success(replyId ? "คัดลอกลิงก์ความคิดเห็นแล้ว" : "คัดลอกลิงก์โพสต์แล้ว"))
        .catch(() => toast.error("คัดลอกลิงก์ไม่สำเร็จ"));
    }
    setMoreOpen(false);
  }

  // Anyone opening this link needs their own login on this app either way
  // (it's not a public page) — the point of these buttons is just skipping
  // "copy link, switch app, paste" for people who already have access,
  // same as sharing any internal Notion/Confluence page link around.
  async function sharePost() {
    setMoreOpen(false);
    const url = postUrl();
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title || "โพสต์จาก Smartboss", url });
        return;
      } catch {
        // User cancelled the native share sheet, or the browser rejected it
        // (e.g. no user gesture in its eyes) — fall through to the picker
        // instead of leaving the click looking like it did nothing.
      }
    }
    setShareOpen(true);
  }

  function handleOpenAsTask() {
    setMoreOpen(false);
    if (post.linkedTaskId) {
      onOpenTask?.(post.linkedTaskId);
    } else {
      setCreateTaskOpen(true);
    }
  }

  function openReplyLightbox(images: ReportPostImage[], index: number) {
    setReplyLightbox({ images, index });
  }

  // Shared between the hover toolbar's "..." submenu and the touch-only
  // combined menu — same items either way, just a different close callback
  // per trigger (setMoreOpen vs setTouchMenuOpen).
  function postMenuItems(close: () => void) {
    return (
      <>
        <MenuButton icon={ReplyIcon} label="อ้างอิงโพสต์นี้" onClick={quotePost} />
        <MenuButton icon={post.pinned ? PinOff : Pin} label={post.pinned ? "เลิกปักหมุด" : "ปักหมุดโพสต์นี้"} onClick={() => { togglePin(post.id); close(); }} />
        <MenuButton
          icon={isSaved ? BookmarkCheck : Bookmark}
          label={isSaved ? "เลิกบันทึก" : "บันทึกข้อความนี้"}
          onClick={() => { toggleSave(post.id, viewingAsUserId); close(); }}
        />
        <MenuButton icon={Link2} label="คัดลอกลิงก์" onClick={() => copyLink()} />
        <MenuButton icon={Share2} label="แชร์โพสต์" onClick={sharePost} />
        <MenuButton
          icon={ClipboardList}
          label={post.linkedTaskId ? "เปิดงานที่เชื่อมไว้" : "เปิดเป็นงาน"}
          onClick={handleOpenAsTask}
        />
        <MenuButton
          icon={isUnread ? Eye : EyeOff}
          label={isUnread ? "ทำเครื่องหมายว่าอ่านแล้ว" : "ทำเครื่องหมายว่ายังไม่อ่าน"}
          onClick={() => { toggleUnread(post.id, viewingAsUserId); close(); }}
        />
        {isOwn && (
          <MenuButton
            icon={Trash2}
            label="ลบโพสต์"
            destructive
            onClick={() => {
              close();
              setConfirmDeleteOpen(true);
            }}
          />
        )}
      </>
    );
  }

  if (editing) {
    return (
      <EditPostForm
        post={post}
        topic={topic}
        onCancel={() => setEditing(false)}
        onSave={(data) => {
          editPost(post.id, data);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      id={`report-post-${post.id}`}
      className={cn(
        // A hairline (with or without zebra tint behind it) was tried and
        // reverted for the same complaint four times running — posts vary
        // wildly in height (one line vs. a full reply thread), so a boundary
        // that isn't a closed shape never reads as "this ended, that begins"
        // while scanning fast. Asked for explicitly as "กรอบของใครของมัน...
        // แบบ thread": each post is now its own bordered, rounded card
        // (Teams/Slack-thread style) sitting on the feed's soft tinted
        // ground (see report-feed.tsx) — that's what actually gives a card a
        // surface to contrast against, which flattening the page to plain
        // white specifically removed the first time cards were tried here.
        // Padding/radius scale down on a narrow phone — the desktop sizing
        // (px-5 py-6, rounded-2xl) was applied unconditionally, so on a
        // ~360px screen a single card's own chrome ate a real slice of the
        // width before any content even started ("ใหญ่มากจนมองได้แค่นี้เอง").
        "group/post relative rounded-xl sm:rounded-2xl border border-[var(--line)] bg-[var(--bg)] px-3.5 py-3.5 sm:px-5 sm:py-5 md:py-6 shadow-sm transition-shadow duration-150 hover:shadow-md",
        (highlighted || flashTargetId === post.id) && "bg-[var(--accent)] border-[var(--brand-green)]/40",
        // Unread keeps its own accent, now as a ring around the whole card
        // (a plain border-l reads oddly once the corners are rounded).
        isUnread && "ring-2 ring-[var(--chart-blue)]/70 ring-offset-0"
      )}
    >
      {/* Teams-style floating hover toolbar — anchored inside this post's own
          top edge (not offset above it) so it never reads as belonging to
          the post above it. Mouse/hover only now — touch gets its own
          single quiet "⋯" below instead of this whole 4-icon row
          permanently visible on every post, which read as too prominent and
          cluttered once several posts sat close together
          ("เด่นและลกมาก" — same complaint, same fix as Openchat's own
          message-action row got). */}
      <div
        className={cn(
          "absolute top-2 right-3 z-10 flex items-center gap-0.5 rounded-lg border border-[var(--line)] bg-white shadow-sm p-0.5 opacity-0 pointer-events-none transition-opacity",
          "[@media(hover:hover)]:group-hover/post:opacity-100 [@media(hover:hover)]:group-hover/post:pointer-events-auto",
          "[@media(hover:none)]:!hidden",
          (reactionPickerOpen || moreOpen) && "[@media(hover:hover)]:opacity-100 [@media(hover:hover)]:pointer-events-auto"
        )}
      >
        <Popover open={reactionPickerOpen} onOpenChange={setReactionPickerOpen}>
          <PopoverTrigger
            render={
              <button className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]" aria-label="เพิ่มปฏิกิริยา">
                <SmilePlus className="h-4 w-4" />
              </button>
            }
          />
          {/* flex-row explicitly — PopoverContent's own base classes default to
              flex-col, and twMerge only drops a class when the override
              actually names its replacement, so without this the row of
              emoji rendered as an unclickable-looking vertical stack instead
              ("ไม่เห็นกดได้เลยอีโมจิอะไรแบบนี้"). Same fix applied everywhere
              else this same base component is used for a horizontal row. */}
          <PopoverContent className="w-auto p-1.5 flex flex-row items-center gap-0.5">
            {reactionEmojis.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  toggleReaction(post.id, emoji, viewingAsUserId);
                  setReactionPickerOpen(false);
                }}
                className={cn(
                  "h-8 w-8 flex items-center justify-center rounded-md text-base hover:bg-[var(--bg-soft)] transition-transform hover:scale-110",
                  (post.reactions[emoji] ?? []).includes(viewingAsUserId) && "bg-[var(--accent)]"
                )}
              >
                {emoji}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <button
          onClick={() => {
            setThreadOpen(true);
            requestAnimationFrame(() => replyEditorRef.current?.focus());
          }}
          className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
          aria-label="ตอบกลับ"
          title="ตอบกลับ"
        >
          <MessageCircle className="h-4 w-4" />
        </button>
        {isOwn && (
          <button
            onClick={() => setEditing(true)}
            className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
            aria-label="แก้ไขโพสต์"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger
            render={
              <button className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]" aria-label="ตัวเลือกเพิ่มเติม">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          />
          <PopoverContent className="w-auto p-1 flex flex-col min-w-40">
            {postMenuItems(() => setMoreOpen(false))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Touch's single quiet "⋯" — nothing shows next to a post until
          tapped, same fix as Openchat's own per-message row got (all of
          react/reply/edit/more collapsed into one tap-to-reveal menu instead
          of a permanently-visible bordered 4-icon row next to every single
          post, "เด่นและลกมาก"). Only rendered under [@media(hover:none)], so
          a mouse user never sees a redundant second trigger next to the
          hover toolbar above. */}
      <div className="absolute top-2 right-3 z-10 hidden [@media(hover:none)]:block">
        <Popover open={touchMenuOpen} onOpenChange={setTouchMenuOpen}>
          <PopoverTrigger
            render={
              <button className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--ink-faint)]" aria-label="ตัวเลือกโพสต์">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          />
          <PopoverContent className="w-auto p-1 flex flex-col min-w-44" align="end">
            <div className="flex flex-row gap-0.5 p-0.5">
              {reactionEmojis.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    toggleReaction(post.id, emoji, viewingAsUserId);
                    setTouchMenuOpen(false);
                  }}
                  className={cn(
                    "h-8 w-8 flex items-center justify-center rounded-md text-base hover:bg-[var(--bg-soft)]",
                    (post.reactions[emoji] ?? []).includes(viewingAsUserId) && "bg-[var(--accent)]"
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="h-px bg-[var(--line)] mx-1 my-0.5" />
            <MenuButton
              icon={MessageCircle}
              label="ตอบกลับ"
              onClick={() => {
                setTouchMenuOpen(false);
                setThreadOpen(true);
                requestAnimationFrame(() => replyEditorRef.current?.focus());
              }}
            />
            {isOwn && <MenuButton icon={Pencil} label="แก้ไขโพสต์" onClick={() => { setTouchMenuOpen(false); setEditing(true); }} />}
            <div className="h-px bg-[var(--line)] mx-1 my-0.5" />
            {postMenuItems(() => setTouchMenuOpen(false))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Identity reads as two lines — who on top, where-and-when under it —
          instead of one row that ran name, role, time, "แก้ไขแล้ว", unread and
          the room name together and truncated whichever lost the race. The
          avatar is a rounded square, the same shape the room icons and status
          tiles use elsewhere in the module, so a person reads as a person and
          not as one more round chip in a row of round chips. */}
      <div className="flex items-start gap-2.5 sm:gap-3.5">
        <Avatar className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-xl after:rounded-xl">
          <AvatarFallback className="rounded-xl text-xs font-semibold bg-[var(--accent)] text-[var(--brand-green-dark)]">{author?.avatar}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {post.pinned && <Pin className="h-3.5 w-3.5 text-[var(--brand-green-dark)] shrink-0" />}
                <p className="text-sm font-semibold truncate">{author?.name}</p>
                {isUnread && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--chart-blue)] shrink-0" aria-label="ยังไม่อ่าน" />
                )}
              </div>
              <p className="flex items-center gap-1 text-xs text-[var(--ink-soft)] truncate">
                {author?.role && <span className="truncate">{author.role} ·</span>}
                <TimeAgo date={post.createdAt} />
                {post.editedAt && <span>· แก้ไขแล้ว</span>}
              </p>
            </div>
            {topicBadge && (
              <button
                onClick={topicBadge.onClick}
                title={`ไปที่หัวข้อ "${topicBadge.label}"`}
                className="shrink-0 truncate max-w-[200px] rounded-full bg-[var(--bg-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)] hover:bg-[var(--accent)] transition-colors"
              >
                {topicBadge.label}
              </button>
            )}
          </div>
          {/* renderRichBulletText, not raw {post.title} — an Openchat-style
              post has no sections, so its whole message (bold/links/
              mentions the composer wrote as marker text) lives entirely in
              `title`. Rendering it raw meant none of that ever actually
              rendered: a pasted URL stayed plain unlinked text with no
              break-all, which is exactly what overflowed the card on a long
              unbroken link ("มันล้นการ์ด") — this is the one and only place
              a flat Openchat post's body gets shown, so it's also the only
              place that formatting could ever have applied. */}
          <p className="text-[14.5px] sm:text-[16px] font-semibold mt-2 leading-snug break-words">{renderRichBulletText(post.title)}</p>
          {postTags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-1.5">
              {postTags.map((t) => (
                <ReportTagChip key={t.id} tag={t} />
              ))}
            </div>
          )}
          {lateCutoff && isFirstLateOfRound ? (
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                <TriangleAlert className="h-2.5 w-2.5" />
                {/* "ส่งช้า (เลยรอบ t 14:00)" read as cryptic shorthand, and a
                    short/placeholder round label ("t", "00") made it worse —
                    "ส่งเกินกำหนด · กำหนด 14:00" states the actual fact
                    plainly, with the round's name only when it's long enough
                    to actually mean something (same rule the room-header
                    metadata row uses). */}
                ส่งเกินกำหนด{lateCutoff.label.trim().length > 2 ? ` (${lateCutoff.label.trim()})` : ""} · กำหนด {lateCutoff.time}
              </span>
            </div>
          ) : !lateCutoff && onTimeCutoff ? (
            // The positive counterpart to "ส่งช้า" (C10) — without it, a
            // room with a schedule only ever showed a warning badge, never
            // confirmation that a post actually met it.
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--accent)] text-[var(--brand-green-dark)] border border-[var(--brand-green)]/20">
                <Check className="h-2.5 w-2.5" />
                ตรงเวลา · รอบ{onTimeCutoff.label}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {visibleSections.length > 0 && (
        <div className="space-y-3 pl-[42px] sm:pl-14 mt-2.5">
          {visibleSections.map((s) => (
            <div key={s.id}>
              {s.heading && <p className="text-sm sm:text-base font-semibold mb-1">{s.heading}</p>}
              {s.bullets.length > 0 && renderSectionBullets(s.bullets, (bulletIndex) => toggleChecklistItem(s.id, bulletIndex))}
            </div>
          ))}
        </div>
      )}

      {isLong && (
        <button
          onClick={() => setShowFull((v) => !v)}
          className="pl-[42px] sm:pl-14 mt-1.5 text-xs font-medium text-[var(--brand-green-dark)] hover:underline"
        >
          {showFull ? "ย่อ" : "ดูเพิ่มเติม"}
        </button>
      )}

      {post.images.length > 0 && (
        <div className="pl-[42px] sm:pl-14 mt-3.5">
          <PostImageCollage
            images={post.images.slice(0, MAX_VISIBLE_IMAGES)}
            remaining={Math.max(0, post.images.length - MAX_VISIBLE_IMAGES)}
            onOpen={setLightboxIndex}
          />
        </div>
      )}

      {lightboxIndex !== null && (
        <ReportImageLightbox
          images={post.images}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {activeReactions.length > 0 && (
        <div className="pl-[42px] sm:pl-14 flex items-center gap-1.5 pt-3 flex-wrap">
          {activeReactions.map(({ emoji, users }) => {
            const active = users.includes(viewingAsUserId);
            return (
              <button
                key={emoji}
                onClick={() => toggleReaction(post.id, emoji, viewingAsUserId)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors",
                  active
                    ? "bg-[var(--accent)] border-[var(--brand-green)]/40 text-[var(--brand-green-dark)]"
                    : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-white"
                )}
              >
                <span>{emoji}</span>
                <span className="tabular-nums">{users.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Existing replies stay visible inline (Teams shows them straight
          under the post, same as it always has) — only the *compose box*
          for adding a new one hides behind "ตอบกลับในเธรด" below, matching
          where Teams' own link sits (after the last reply, not in place of
          them). Getting this backwards (hiding replies too) was the first
          pass at this — a real Teams screenshot showing replies rendered
          in full caught it.

          The divider+link row itself always renders now, even on a post
          with zero comments — a real Teams screenshot showed "Reply in
          thread" under every single post, quiet ones included, not just
          ones already talked about. Previously gated on having a reply (or
          an open composer) already, on the idea that the hover toolbar's 💬
          icon was affordance enough on a quiet post — asked for explicitly
          after that read as *missing* the invite to reply, not as
          intentionally quiet. */}
      <div className="space-y-3 pt-3 mt-3 border-t border-[var(--line)]">
          {/* Collapsed shows just the single latest reply, not the full
              recent-N or the zero-reply Teams summary link tried before —
              asked for explicitly ("ให้แสดงแค่คอมเม้นล่าสุดพอ") after a real
              thread of 16 replies made even "who replied" alone still read
              as too little context to be useful. The "N การตอบกลับ" line
              only shows (as a "view all" link) once there's more than the
              one already on screen. Once expanded, the thread hangs off the
              same vertical line + indent as before (the "these belong to
              the post above" cue every thread UI uses), with a collapse
              link at the bottom so closing a long thread doesn't mean
              scrolling back up past everything just read. */}
          {post.replies.length > 0 && (
            <div className="ml-1 border-l border-[var(--line)] pl-3 sm:pl-4">
              {!repliesExpanded ? (
                <>
                  {post.replies.length > 1 && (
                    <button
                      onClick={() => setRepliesExpanded(true)}
                      className="mb-1.5 block text-left text-xs font-medium text-[var(--brand-green-dark)] hover:underline"
                    >
                      {replySummary}
                    </button>
                  )}
                  <ReportReply
                    reply={post.replies[post.replies.length - 1]!}
                    allReplies={post.replies}
                    postQuote={{ id: post.id, authorId: post.authorId, body: post.title }}
                    flashed={flashTargetId === post.replies[post.replies.length - 1]!.id}
                    isOwn={post.replies[post.replies.length - 1]!.authorId === viewingAsUserId}
                    onOpenLightbox={openReplyLightbox}
                    onReplyTo={startReplyTo}
                    onJumpToQuote={jumpToQuote}
                    onCopyLink={() => copyLink(post.replies[post.replies.length - 1]!.id)}
                    onToggleReaction={(emoji) =>
                      toggleReplyReaction(post.id, post.replies[post.replies.length - 1]!.id, emoji, viewingAsUserId)
                    }
                    onEdit={(body) =>
                      editReplyAction(post.id, post.replies[post.replies.length - 1]!.id, {
                        body,
                        images: post.replies[post.replies.length - 1]!.images,
                      })
                    }
                    onDelete={() => setDeleteReplyTarget(post.replies[post.replies.length - 1]!.id)}
                  />
                </>
              ) : (
                <>
                  <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                    {post.replies.length} การตอบกลับ
                  </p>
                  <div className="space-y-2.5">
                    {post.replies.map((r) => (
                      <ReportReply
                        key={r.id}
                        reply={r}
                        allReplies={post.replies}
                        postQuote={{ id: post.id, authorId: post.authorId, body: post.title }}
                        flashed={flashTargetId === r.id}
                        isOwn={r.authorId === viewingAsUserId}
                        onOpenLightbox={openReplyLightbox}
                        onReplyTo={startReplyTo}
                        onJumpToQuote={jumpToQuote}
                        onCopyLink={() => copyLink(r.id)}
                        onToggleReaction={(emoji) => toggleReplyReaction(post.id, r.id, emoji, viewingAsUserId)}
                        onEdit={(body) => editReplyAction(post.id, r.id, { body, images: r.images })}
                        onDelete={() => setDeleteReplyTarget(r.id)}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => setRepliesExpanded(false)}
                    className="mt-2 text-[11px] font-medium text-[var(--brand-green-dark)] hover:underline"
                  >
                    ซ่อนการตอบกลับ
                  </button>
                </>
              )}
            </div>
          )}

          {/* ปิดคอมเมนต์ (Phase 6) — existing replies above stay visible (read-only history), just no way to add a new one. */}
          {topic.commentsDisabled ? (
            <p className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
              <Lock className="h-3 w-3 shrink-0" />
              ห้องนี้ปิดการแสดงความคิดเห็น
            </p>
          ) : !threadOpen ? (
            /* Teams-style — the link sits after the last reply (or alone,
               with none yet), not up by the reactions row, and is the only
               thing standing between a quiet post and a compose box for
               every single one of them. */
            <button
              onClick={() => {
                setThreadOpen(true);
                requestAnimationFrame(() => replyEditorRef.current?.focus());
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--brand-green-dark)] hover:underline"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              ตอบกลับ
            </button>
          ) : (
          <>
            {replyingTo && (
              <div className="flex items-start gap-2 pl-2.5 pr-2 py-2 rounded-lg bg-[var(--accent)] border-l-4 border-[var(--brand-green)]">
                <Quote className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--brand-green-dark)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-green-dark)]">
                    {quoteKind === "quote" ? "กำลังอ้างอิงโพสต์นี้" : "กำลังตอบกลับความคิดเห็น"}
                  </p>
                  <p className="text-xs truncate">
                    <span className="font-medium text-[var(--ink)]">{getUser(replyingTo.authorId)?.name}</span>
                    {replyingTo.body && (
                      <span className="text-[var(--ink-soft)]">: {replyingTo.body.split("\n")[0]?.slice(0, 60)}</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setReplyingTo(null);
                    setQuoteKind(null);
                  }}
                  aria-label="ยกเลิกการตอบกลับ"
                  className="shrink-0 h-5 w-5 flex items-center justify-center rounded-full hover:bg-white/70"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {replyImages.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-1">
                {replyImages.map((img) => (
                  <div key={img.id} className="relative h-12 w-12 rounded-md overflow-hidden border border-[var(--line)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url ?? img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                    <button
                      onClick={() => setReplyImages((prev) => prev.filter((i) => i.id !== img.id))}
                      className="absolute top-0 right-0 h-4 w-4 flex items-center justify-center bg-black/60 text-white rounded-bl-md"
                      aria-label={`ลบรูป ${img.name}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              className={cn(
                "flex items-center gap-1 border bg-white pl-1 pr-1 py-1 focus-within:border-[var(--brand-green)]/50 transition-colors",
                // Collapsed at rest ("[avatar] [input] 📎 ➤") stays a plain
                // capsule, but expanding it to also fit bold/italic/
                // underline/link/highlight inline (see below) left no room
                // for the text itself on a narrow phone — the input got
                // squeezed down to a handful of px and its placeholder
                // wrapped one character per line. flex-wrap plus a real
                // min-width on the input (below) lets the toolbar spill onto
                // its own second line there instead of stealing the input's
                // width; rounded-2xl (not rounded-full) is what actually
                // looks right once this row can be two lines tall.
                replyFocused || replyColorPickerOpen ? "flex-wrap rounded-2xl" : "rounded-full"
              )}
              style={replyHighlight ? { borderColor: replyHighlight } : { borderColor: "var(--line)" }}
            >
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{viewer?.avatar}</AvatarFallback>
              </Avatar>
              <div
                ref={(el) => {
                  replyEditorRef.current = el;
                  // Uncontrolled like the composer's editor — only seed it once;
                  // afterwards submitReply() clears the DOM directly.
                  if (el && el.innerHTML === "" && replyText !== "") el.innerHTML = bulletsTextToHtml(replyText);
                }}
                contentEditable
                role="textbox"
                aria-label="พิมพ์ความคิดเห็น"
                aria-multiline="true"
                suppressContentEditableWarning
                data-placeholder="เขียนคำตอบ..."
                onInput={(e) => {
                  setReplyText(htmlEditorToBulletsText(e.currentTarget));
                  syncReplyMentionMenu(e.currentTarget);
                }}
                onKeyUp={(e) => syncReplyMentionMenu(e.currentTarget)}
                onFocus={() => setReplyFocused(true)}
                onBlur={() => {
                  setReplyFocused(false);
                  setReplyMentionMenu(null);
                }}
                className="flex-1 min-w-[100px] bg-transparent text-sm outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--ink-soft)]"
                onKeyDown={(e) => {
                  if (replyMentionMenu) {
                    const matches = replyMentionMatches(replyMentionMenu.query);
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setReplyMentionMenu({ ...replyMentionMenu, index: matches.length === 0 ? 0 : (replyMentionMenu.index + 1) % matches.length });
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setReplyMentionMenu({ ...replyMentionMenu, index: matches.length === 0 ? 0 : (replyMentionMenu.index - 1 + matches.length) % matches.length });
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      const picked = matches[replyMentionMenu.index];
                      if (picked) insertReplyMention(picked);
                      else setReplyMentionMenu(null);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setReplyMentionMenu(null);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!replyUploading) submitReply();
                  }
                }}
              />
              {replyMentionMenu &&
                (() => {
                  const matches = replyMentionMatches(replyMentionMenu.query);
                  const spaceBelow = replyMentionMenu.containerBottom - replyMentionMenu.rect.bottom - 8;
                  const spaceAbove = replyMentionMenu.rect.top - replyMentionMenu.containerTop - 8;
                  const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
                  const maxHeight = Math.max(120, Math.min(224, openAbove ? spaceAbove : spaceBelow));
                  return (
                    <div
                      style={{
                        position: "fixed",
                        left: replyMentionMenu.rect.left,
                        maxHeight,
                        ...(openAbove
                          ? { bottom: window.innerHeight - replyMentionMenu.rect.top + 4 }
                          : { top: replyMentionMenu.rect.bottom + 4 }),
                      }}
                      className="z-50 w-64 rounded-lg border border-[var(--line)] bg-white shadow-lg py-1 overflow-y-auto"
                    >
                      {matches.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-[var(--ink-soft)]">ไม่พบที่ตรงกับ &quot;{replyMentionMenu.query}&quot;</p>
                      ) : (
                        matches.map((item, i) => {
                          const Icon = item.type === "user" ? User : Building2;
                          return (
                            <button
                              key={`${item.type}-${item.id}`}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insertReplyMention(item)}
                              className={cn(
                                "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                                i === replyMentionMenu.index ? "bg-[var(--bg-soft)]" : "hover:bg-[var(--bg-soft)]"
                              )}
                            >
                              <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
                              <span className="truncate flex-1">{item.label}</span>
                              {item.sublabel && <span className="text-[11px] text-[var(--ink-soft)] shrink-0">{item.sublabel}</span>}
                            </button>
                          );
                        })
                      )}
                    </div>
                  );
                })()}
              {/* Collapsed at rest — [avatar] [input] 📎 ➤ — the formatting
                  toolbar only earns its space once you're actually typing. */}
              {(replyFocused || replyColorPickerOpen) && (
                <>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => execReplyFormat("bold")}
                    aria-label="ตัวหนา"
                    title="ตัวหนา"
                    className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => execReplyFormat("italic")}
                    aria-label="ตัวเอียง"
                    title="ตัวเอียง"
                    className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                  >
                    <Italic className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => execReplyFormat("underline")}
                    aria-label="ขีดเส้นใต้"
                    title="ขีดเส้นใต้"
                    className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                  >
                    <Underline className="h-3.5 w-3.5" />
                  </button>
                  <LinkInsertPopover
                    onInsert={insertReplyLink}
                    className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                  />
                </>
              )}
              <input
                ref={replyFileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleReplyFiles(e.target.files)}
              />
              <button
                onClick={() => replyFileInputRef.current?.click()}
                disabled={replyUploading || replyImages.length >= 6}
                aria-label="แนบรูป"
                className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] disabled:opacity-40"
              >
                {replyUploading ? <ImagePlus className="h-4 w-4 animate-pulse" /> : <Paperclip className="h-4 w-4" />}
              </button>
              {(replyFocused || replyColorPickerOpen || replyHighlight) && (
                <Popover open={replyColorPickerOpen} onOpenChange={setReplyColorPickerOpen}>
                  <PopoverTrigger
                    render={
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        aria-label="ไฮไลต์สี"
                        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full hover:bg-[var(--bg-soft)]"
                        style={{ color: replyHighlight ?? "var(--ink-soft)" }}
                      >
                        <Palette className="h-4 w-4" />
                      </button>
                    }
                  />
                  <PopoverContent className="w-auto p-1.5 flex flex-row items-center gap-1">
                    <button
                      onClick={() => {
                        setReplyHighlight(undefined);
                        setReplyColorPickerOpen(false);
                      }}
                      aria-label="ไม่ไฮไลต์"
                      className="h-6 w-6 rounded-full border border-[var(--line)] flex items-center justify-center text-[var(--ink-soft)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {topicColors.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setReplyHighlight(c);
                          setReplyColorPickerOpen(false);
                        }}
                        aria-label={`ไฮไลต์สี ${c}`}
                        className="h-6 w-6 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: c }}
                      >
                        {replyHighlight === c && <Check className="h-3 w-3 text-white" />}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
              <button
                onClick={submitReply}
                disabled={replyUploading || (!replyText.trim() && replyImages.length === 0)}
                aria-label="ส่งข้อความ"
                className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full bg-[var(--brand-green)] text-[var(--ink)] disabled:bg-[var(--bg-soft)] disabled:text-[var(--ink-soft)] transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
          )}
        </div>

        {replyLightbox && (
          <ReportImageLightbox
            images={replyLightbox.images}
            index={replyLightbox.index}
            onIndexChange={(index) => setReplyLightbox((cur) => (cur ? { ...cur, index } : cur))}
            onClose={() => setReplyLightbox(null)}
          />
        )}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบโพสต์นี้?</AlertDialogTitle>
            <AlertDialogDescription>ลบแล้วย้อนกลับไม่ได้ ความคิดเห็นและปฏิกิริยาทั้งหมดจะหายไปด้วย</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction className="bg-[var(--chart-red)] hover:bg-red-700 text-white" onClick={() => removePost(post.id)}>
              ลบโพสต์
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteReplyTarget} onOpenChange={(open) => !open && setDeleteReplyTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบความคิดเห็นนี้?</AlertDialogTitle>
            <AlertDialogDescription>ลบแล้วย้อนกลับไม่ได้</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={() => {
                if (deleteReplyTarget) deleteReplyAction(post.id, deleteReplyTarget);
                setDeleteReplyTarget(null);
              }}
            >
              ลบความคิดเห็น
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogClose render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}>
            <X />
            <span className="sr-only">Close</span>
          </DialogClose>
          <DialogHeader>
            <DialogTitle>แชร์โพสต์</DialogTitle>
            <DialogDescription>
              คนที่เปิดลิงก์นี้ต้องมีบัญชีในระบบอยู่แล้วถึงจะเข้าดูโพสต์ได้ — ไม่ใช่ลิงก์สาธารณะ
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(postUrl())}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--bg-soft)] transition-colors"
            >
              LINE
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl())}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--bg-soft)] transition-colors"
            >
              Facebook
            </a>
            <a
              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(postUrl())}&text=${encodeURIComponent(post.title || "โพสต์จาก Smartboss")}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--bg-soft)] transition-colors"
            >
              X (Twitter)
            </a>
            <button
              onClick={() => copyLink()}
              className="flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--bg-soft)] transition-colors"
            >
              <Copy className="h-4 w-4" /> คัดลอกลิงก์
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {createTaskOpen && (
        <NewTaskDialog
          open={createTaskOpen}
          onOpenChange={setCreateTaskOpen}
          defaultType="task"
          allowedTypes={["task"]}
          defaultTitle={post.title}
          onCreated={(taskId) => {
            setPostLinkedTask(post.id, taskId);
            setCreateTaskOpen(false);
            onOpenTask?.(taskId);
          }}
        />
      )}
    </div>
  );
}

/** A single post's attached images, laid out by count (C8/V4) instead of a
 * flat fixed-height grid: 1 = one big block, 2 = even pair, 3+ = a large
 * lead image (2fr) beside a stacked column (1fr) with a "+N" overlay on the
 * last thumbnail once there are more than fit. */
function PostImageCollage({
  images,
  remaining,
  onOpen,
}: {
  images: ReportPostImage[];
  remaining: number;
  onOpen: (index: number) => void;
}) {
  if (images.length === 1) {
    return (
      <div className="rounded-lg border border-[var(--line)] overflow-hidden">
        <PostImageThumb img={images[0]!} onClick={() => onOpen(0)} className="w-full" fitToImage />
      </div>
    );
  }
  if (images.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {images.map((img, i) => (
          <PostImageThumb key={img.id} img={img} onClick={() => onOpen(i)} className="h-[190px] w-full rounded-lg border border-[var(--line)] overflow-hidden" />
        ))}
      </div>
    );
  }
  // Lead image (2fr) beside a stacked column (1fr) holding whatever's left
  // — up to 4 more, since `images` arrives already capped at MAX_VISIBLE_IMAGES.
  const rest = images.slice(1);
  return (
    // `grid-rows-1 min-h-0` on every level down to the <img> — a grid/flex
    // item's default `min-height: auto` lets its *content's* intrinsic size
    // (here, the photo's natural 408x657-ish aspect) override an ancestor's
    // fixed height and blow the row way past h-[280px] otherwise (this
    // rendered a single lead photo ~2000px tall before the min-h-0 chain).
    <div className="grid grid-cols-[2fr_1fr] grid-rows-1 gap-2.5 h-[280px] min-h-0">
      <PostImageThumb img={images[0]!} onClick={() => onOpen(0)} className="h-full min-h-0 w-full rounded-lg border border-[var(--line)] overflow-hidden" />
      <div className="grid gap-2.5 min-h-0" style={{ gridTemplateRows: `repeat(${rest.length}, minmax(0, 1fr))` }}>
        {rest.map((img, i) => {
          const index = i + 1;
          const isLast = index === images.length - 1;
          return (
            <div key={img.id} className="relative min-h-0 rounded-lg border border-[var(--line)] overflow-hidden">
              <PostImageThumb img={img} onClick={() => onOpen(index)} className="h-full w-full" />
              {isLast && remaining > 0 && (
                <span className="absolute inset-0 bg-black/50 text-white text-sm font-semibold flex items-center justify-center pointer-events-none">
                  +{remaining}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** object-cover by default; switches to object-contain on a gray backdrop
 * once the image turns out to be a very wide/short screenshot-style aspect
 * ratio, so it doesn't get cropped down to an unreadable sliver (V4). */
function PostImageThumb({
  img,
  onClick,
  className,
  fitToImage,
}: {
  img: ReportPostImage;
  onClick: () => void;
  className?: string;
  /** For the single-image case only — a fixed h-230 box with object-contain
   * used to letterbox a wide image (e.g. a landscape screenshot) with blank
   * bg-soft bars on the sides, which read as the image having shrunk
   * ("หดเข้าไปทำไม") rather than as intentional "not cropped". Sizing the
   * box to the image's own aspect ratio instead fills the full card width
   * with no cropping *and* no dead space — there's nothing left to letterbox. */
  fitToImage?: boolean;
}) {
  const [wide, setWide] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative block hover:opacity-90 transition-opacity",
        !fitToImage && wide && "bg-[var(--bg-soft)]",
        // 60vh let a tall portrait screenshot (very common for this feed) eat
        // up to a third of the screen on both desktop and mobile — capping
        // instead keeps the "no letterbox, fill the width" behavior for
        // normal photos while stopping a single image from dominating the
        // post the way multi-image posts never do (they're capped at
        // 190/280px, see PostImageCollage above). Lower cap on a narrow
        // phone specifically — asked for explicitly along with the rest of
        // the post's own responsive sizing ("ขนาดให้ตัวเล็กลงตาม responsive").
        fitToImage && ratio && "max-h-[260px] sm:max-h-[380px]",
        className
      )}
      style={fitToImage && ratio ? { aspectRatio: ratio, height: "auto" } : undefined}
      aria-label={`ดูรูป ${img.name} เต็มจอ`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.url ?? img.dataUrl}
        alt={img.name}
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth / el.naturalHeight > 1.6) setWide(true);
          if (fitToImage) setRatio(el.naturalWidth / el.naturalHeight);
        }}
        className={cn("h-full w-full", !fitToImage && wide ? "object-contain" : "object-cover")}
      />
    </button>
  );
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: typeof Pin;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm w-full text-left hover:bg-[var(--bg-soft)]",
        destructive && "text-[var(--chart-red)] hover:bg-[var(--chart-red)]/10"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

function EditPostForm({
  post,
  topic,
  onCancel,
  onSave,
}: {
  post: ReportPost;
  topic: ReportTopic;
  onCancel: () => void;
  onSave: (data: { title: string; sections: ReturnType<typeof buildSections>; images: ReportPostImage[]; tagIds: string[] }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(post.title);
  const [sections, setSections] = useState<DraftSection[]>(
    post.sections.length > 0
      ? post.sections.map((s) => ({ ...s, bulletsText: s.bullets.join("\n") }))
      : [newSection()]
  );
  const [images, setImages] = useState<ReportPostImage[]>(post.images);
  const [tagIds, setTagIds] = useState<string[]>(post.tagIds);
  const [busy, setBusy] = useState(false);

  const minImagesRequired = minImagesNow(topic);
  const missingRequiredImage = images.length < minImagesRequired;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const next: ReportPostImage[] = [];
    try {
      for (const file of Array.from(files).slice(0, 6 - images.length)) {
        const url = await uploadCompressedImage(file);
        next.push({ id: `img-${crypto.randomUUID()}`, url, name: file.name });
      }
    } catch {
      toast.error("แนบรูปไม่สำเร็จบางไฟล์ — ลองใหม่อีกครั้ง");
    } finally {
      // Keep whatever uploaded successfully before the failure — no reason
      // to throw away images that already finished just because a later one broke.
      if (next.length > 0) setImages((prev) => [...prev, ...next]);
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleSave() {
    if (!title.trim() || missingRequiredImage) return;
    onSave({
      title: title.trim(),
      sections: buildSections(sections),
      images,
      tagIds,
    });
  }

  return (
    <div className="rounded-2xl border border-[var(--brand-green)]/40 bg-white p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--brand-green-dark)]">กำลังแก้ไขโพสต์</p>
        <button onClick={onCancel} className="text-[var(--ink-soft)] hover:text-[var(--ink)]" aria-label="ยกเลิกการแก้ไข">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ReportPostFields
        topicId={topic.id}
        title={title}
        onTitleChange={setTitle}
        sections={sections}
        onSectionsChange={setSections}
        images={images}
        onImagesChange={setImages}
        tagIds={tagIds}
        onTagIdsChange={setTagIds}
        minImages={minImagesRequired}
        fileInputRef={fileInputRef}
        busy={busy}
        onFilesSelected={handleFiles}
      />
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button size="sm" disabled={!title.trim() || missingRequiredImage || busy} onClick={handleSave}>
          บันทึกการแก้ไข
        </Button>
      </div>
    </div>
  );
}

function buildSections(sections: DraftSection[]) {
  return sections
    .map((s) => ({
      id: s.id,
      heading: s.heading.trim(),
      bullets: s.bulletsText.split("\n").map((b) => b.trim()).filter(Boolean),
    }))
    .filter((s) => s.heading || s.bullets.length > 0);
}
