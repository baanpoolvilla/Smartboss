"use client";

import { useEffect, useRef, useState } from "react";
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
import { getUser } from "@/modules/report_task/lib/directory";
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
import {
  bulletsTextToHtml,
  CHECKLIST_CHECKED,
  CHECKLIST_UNCHECKED,
  htmlEditorToBulletsText,
  renderSectionBullets,
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
  X,
} from "lucide-react";

const reactionEmojis = ["👍", "❤️", "🎉", "😂", "😮", "😢"];
const LONG_POST_BULLET_THRESHOLD = 8;
const MAX_VISIBLE_IMAGES = 5;

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

  const [replyText, setReplyText] = useState("");
  const [replyImages, setReplyImages] = useState<ReportPostImage[]>([]);
  const [replyHighlight, setReplyHighlight] = useState<string | undefined>(undefined);
  const [replyUploading, setReplyUploading] = useState(false);
  const [replyColorPickerOpen, setReplyColorPickerOpen] = useState(false);
  const replyEditorRef = useRef<HTMLDivElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteReplyTarget, setDeleteReplyTarget] = useState<string | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [editing, setEditing] = useState(false);
  // Collapsed comment box's formatting toolbar (B/I/U/link/highlight) only
  // shows once the input actually has focus — attach/send stay visible
  // either way so the box still reads as "you can reply here" at rest.
  const [replyFocused, setReplyFocused] = useState(false);
  const RECENT_REPLY_COUNT = 3;
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
  function jumpToQuote(id: string) {
    const elId = id === post.id ? `report-post-${post.id}` : `report-reply-${id}`;
    document.getElementById(elId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashTargetId(id);
    setTimeout(() => setFlashTargetId((cur) => (cur === id ? null : cur)), 2000);
  }

  // A deep link to an older reply that's currently folded away (see C6
  // below) needs the thread expanded before there's anything to scroll to —
  // runs first so the effect below finds the reply already in the DOM once
  // `repliesExpanded` flips true and it re-runs.
  useEffect(() => {
    if (!highlightReplyId || repliesExpanded) return;
    if (!post.replies.some((r) => r.id === highlightReplyId)) return;
    setThreadOpen(true);
    const recentIds = new Set(post.replies.slice(-RECENT_REPLY_COUNT).map((r) => r.id));
    if (recentIds.has(highlightReplyId)) return;
    const timer = setTimeout(() => setRepliesExpanded(true), 0);
    return () => clearTimeout(timer);
  }, [highlightReplyId, repliesExpanded, post.replies]);

  // A "copy link" deep link that pointed at one specific reply (?reply=) —
  // same scroll+flash as clicking a quote, just triggered by the URL instead
  // of a click, and only for a reply that actually belongs to this post.
  useEffect(() => {
    if (!highlightReplyId) return;
    if (!post.replies.some((r) => r.id === highlightReplyId)) return;
    const recentIds = new Set(post.replies.slice(-RECENT_REPLY_COUNT).map((r) => r.id));
    // Wait for the expand effect above to actually apply before scrolling —
    // otherwise the target reply isn't in the DOM yet to scroll to.
    if (!recentIds.has(highlightReplyId) && !repliesExpanded) return;
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
        // Each post is its own card on the feed's tinted background, which is
        // what Teams actually does and — more to the point — what finally
        // answered "ตัวคั่นระหว่างโพสมองยากมาก งงมาก".
        //
        // This went the other way twice before: posts as flat edge-to-edge
        // rows separated by a hairline, then the same rows with a deliberately
        // darkened hairline. Both kept failing for the same reason, which is
        // worth writing down so nobody flattens them a third time. A single
        // line is the weakest boundary a layout has, and these posts don't
        // give it any help: they're wildly uneven in height (one line of text,
        // or a title plus tags plus an image plus a reply thread), so the eye
        // can't fall back on a regular rhythm to tell "new post" from "more of
        // the same post". Darkening the line only makes a faint boundary
        // slightly less faint — it doesn't change what the boundary has to do.
        //
        // A card closes the shape on all four sides, so where one post ends is
        // never in question no matter how tall or short it is. The gap between
        // cards comes from the feed's own spacing (see report-feed.tsx), which
        // is also what separates a post from its own replies *inside* the card
        // — the two now read at clearly different levels instead of competing.
        "group/post relative rounded-xl border border-[var(--line)] px-5 py-4 shadow-[0_1px_2px_rgba(17,17,17,0.04)] transition-colors duration-200",
        highlighted || flashTargetId === post.id ? "bg-[var(--accent)]" : "bg-white hover:border-[color-mix(in_srgb,var(--line),var(--ink-soft)_45%)]",
        // Unread reads as a left accent + a dot under the author's name (see
        // below) instead of a background tint — a background collided with
        // `highlighted`'s bg-accent (both fighting for the same visual slot).
        // Unread keeps its left accent — on a card it reads as a colored edge
        // on the card itself, which is stronger than it was on a flat row.
        isUnread && "border-l-[3px] border-l-[var(--chart-blue)]"
      )}
    >
      {/* Teams-style floating hover toolbar — anchored inside this post's own
          top edge (not offset above it) so it never reads as belonging to
          the post above it. */}
      <div
        className={cn(
          "absolute top-2 right-3 z-10 flex items-center gap-0.5 rounded-lg border border-[var(--line)] bg-white shadow-sm p-0.5 opacity-0 pointer-events-none transition-opacity",
          "group-hover/post:opacity-100 group-hover/post:pointer-events-auto",
          // No hover on touch (C4) — opacity-0 would otherwise need a tap
          // that does nothing (just reveals the toolbar) before the real tap.
          "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
          (reactionPickerOpen || moreOpen) && "opacity-100 pointer-events-auto"
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
          <PopoverContent className="w-auto p-1.5 flex items-center gap-0.5">
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
          aria-label="ตอบกลับในเธรด"
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
            <MenuButton icon={ReplyIcon} label="อ้างอิงโพสต์นี้" onClick={quotePost} />
            <MenuButton icon={post.pinned ? PinOff : Pin} label={post.pinned ? "เลิกปักหมุด" : "ปักหมุดโพสต์นี้"} onClick={() => { togglePin(post.id); setMoreOpen(false); }} />
            <MenuButton
              icon={isSaved ? BookmarkCheck : Bookmark}
              label={isSaved ? "เลิกบันทึก" : "บันทึกข้อความนี้"}
              onClick={() => { toggleSave(post.id, viewingAsUserId); setMoreOpen(false); }}
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
              onClick={() => { toggleUnread(post.id, viewingAsUserId); setMoreOpen(false); }}
            />
            {isOwn && (
              <MenuButton
                icon={Trash2}
                label="ลบโพสต์"
                destructive
                onClick={() => {
                  setMoreOpen(false);
                  setConfirmDeleteOpen(true);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-start gap-5">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="text-xs bg-[var(--accent)] text-[var(--brand-green-dark)]">{author?.avatar}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {post.pinned && <Pin className="h-3.5 w-3.5 text-[var(--brand-green-dark)] shrink-0" />}
            <p className="text-[13px] font-semibold truncate">{author?.name}</p>
            {author?.role && (
              <span className="shrink-0 text-xs font-medium text-[var(--chart-blue)] bg-blue-50 rounded-full px-1.5 py-0.5 truncate max-w-[140px]">
                {author.role}
              </span>
            )}
            <TimeAgo date={post.createdAt} className="text-xs text-[var(--ink-soft)] shrink-0" />
            {post.editedAt && <span className="text-xs text-[var(--ink-soft)] shrink-0">· แก้ไขแล้ว</span>}
            {isUnread && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--chart-blue)] shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--chart-blue)]" aria-hidden />
                ยังไม่อ่าน
              </span>
            )}
            {topicBadge && (
              <button
                onClick={topicBadge.onClick}
                title={`ไปที่หัวข้อ "${topicBadge.label}"`}
                className="ml-auto shrink-0 truncate max-w-[220px] rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)] hover:bg-[var(--accent)] transition-colors"
              >
                {topicBadge.label}
              </button>
            )}
          </div>
          <p className="text-[16px] font-semibold mt-1 leading-snug">{post.title}</p>
          {postTags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-1.5">
              {postTags.map((t) => (
                <ReportTagChip key={t.id} tag={t} />
              ))}
            </div>
          )}
          {lateCutoff ? (
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                <TriangleAlert className="h-2.5 w-2.5" />
                ส่งช้า (เลยรอบ {lateCutoff.label} {lateCutoff.time})
              </span>
            </div>
          ) : (
            onTimeCutoff && (
              // The positive counterpart to "ส่งช้า" (C10) — without it, a
              // room with a schedule only ever showed a warning badge, never
              // confirmation that a post actually met it.
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--accent)] text-[var(--brand-green-dark)] border border-[var(--brand-green)]/20">
                  <Check className="h-2.5 w-2.5" />
                  ตรงเวลา · รอบ{onTimeCutoff.label}
                </span>
              </div>
            )
          )}
        </div>
      </div>

      {visibleSections.length > 0 && (
        <div className="space-y-3 pl-14 mt-2.5">
          {visibleSections.map((s) => (
            <div key={s.id}>
              {s.heading && <p className="text-base font-semibold mb-1">{s.heading}</p>}
              {s.bullets.length > 0 && renderSectionBullets(s.bullets, (bulletIndex) => toggleChecklistItem(s.id, bulletIndex))}
            </div>
          ))}
        </div>
      )}

      {isLong && (
        <button
          onClick={() => setShowFull((v) => !v)}
          className="pl-14 mt-1.5 text-xs font-medium text-[var(--brand-green-dark)] hover:underline"
        >
          {showFull ? "ย่อ" : "ดูเพิ่มเติม"}
        </button>
      )}

      {post.images.length > 0 && (
        <div className="pl-14 mt-3.5">
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
        <div className="pl-14 flex items-center gap-1.5 pt-3 flex-wrap">
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

          The whole divider+link row only renders once there's something to
          show (a reply, an open composer, or the disabled-comments notice) —
          a post with zero comments already has a reply affordance in the
          hover toolbar's 💬 icon, so repeating an always-on divider+link
          under every single quiet post just piled up dead chrome on a busy
          room with lots of short posts. */}
      {(post.replies.length > 0 || threadOpen || topic.commentsDisabled) && (
      <div className="space-y-3 pt-3 mt-3 border-t border-[var(--line)]">
          {/* The comments sat at the same indent, on the same white, in the
              same text size as the post itself, separated by the same faint
              hairlines — so a post with replies read as one undifferentiated
              column of names and short lines ("ในส่วนนี้มันยังดูยากมาก...งง
              มาก"), with no way to see where the post stopped and the
              conversation about it started.

              Three things fix that here, and they only work together: the
              whole thread is indented and hangs off a vertical line (the
              universal "these belong to the thing above" cue — Teams, Slack
              and every mail client draw some version of it), it sits on a
              tinted panel so it reads as a different surface from the post,
              and it's introduced by a count so you know how much is there
              before reading a single row. Inside it, replies are separated by
              spacing rather than more hairlines — one boundary style per
              level, otherwise every line competes with every other line. */}
          {post.replies.length > 0 && (
            <div className="ml-1 border-l-2 border-[var(--line)] pl-3 sm:pl-4">
              <div className="flex items-center gap-2 pb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                  {post.replies.length} ความคิดเห็น
                </p>
                {post.replies.length > RECENT_REPLY_COUNT && (
                  <button
                    onClick={() => setRepliesExpanded((v) => !v)}
                    className="text-[11px] font-medium text-[var(--brand-green-dark)] hover:underline"
                  >
                    {repliesExpanded ? "ย่อลง" : `ดูก่อนหน้าอีก ${post.replies.length - RECENT_REPLY_COUNT}`}
                  </button>
                )}
              </div>
              <div className="space-y-1 rounded-lg bg-[var(--bg-soft)]/60 px-2.5 py-1.5">
                {(repliesExpanded ? post.replies : post.replies.slice(-RECENT_REPLY_COUNT)).map((r) => (
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
              ตอบกลับในเธรด
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
              className="flex items-center gap-1 rounded-full border bg-white pl-1 pr-1 py-1 focus-within:border-[var(--brand-green)]/50 transition-colors"
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
                data-placeholder="พิมพ์ข้อความ..."
                onInput={(e) => setReplyText(htmlEditorToBulletsText(e.currentTarget))}
                onFocus={() => setReplyFocused(true)}
                onBlur={() => setReplyFocused(false)}
                className="flex-1 min-w-0 bg-transparent text-sm outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--ink-soft)]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!replyUploading) submitReply();
                  }
                }}
              />
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
                  <PopoverContent className="w-auto p-1.5 flex items-center gap-1">
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
      )}

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
      <div className="rounded-lg border border-[var(--line)] overflow-hidden max-w-md">
        <PostImageThumb img={images[0]!} onClick={() => onOpen(0)} className="h-[230px] w-full" />
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
}: {
  img: ReportPostImage;
  onClick: () => void;
  className?: string;
}) {
  const [wide, setWide] = useState(false);
  return (
    <button onClick={onClick} className={cn("relative block hover:opacity-90 transition-opacity", wide && "bg-[var(--bg-soft)]", className)} aria-label={`ดูรูป ${img.name} เต็มจอ`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.url ?? img.dataUrl}
        alt={img.name}
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth / el.naturalHeight > 1.6) setWide(true);
        }}
        className={cn("h-full w-full", wide ? "object-contain" : "object-cover")}
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
