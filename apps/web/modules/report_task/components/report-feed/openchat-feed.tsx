"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
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
import { ReportImageLightbox } from "@/modules/report_task/components/report-feed/report-image-lightbox";
import { NewMessagesDivider } from "@/modules/report_task/components/report-feed/report-new-divider";
import { useReportFeedStore, type ReportPost, type ReportPostImage, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser, departments, users as directoryUsers } from "@/modules/report_task/lib/directory";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { groupByDay } from "@/modules/report_task/lib/format";
import {
  htmlEditorToBulletsText,
  renderRichBulletText,
  type MentionType,
} from "@/modules/report_task/lib/report-feed-rich-text";
import { uploadReportMedia } from "@/modules/report_task/lib/image-resize";
import { ReportMediaThumb } from "@/modules/report_task/components/report-feed/report-media-thumb";
import { DRAG_MENTION_TOPIC_MIME } from "@/modules/report_task/components/report-feed/report-post-fields";
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";
import { Building2, Check, Hash, ImagePlus, MoreHorizontal, Pencil, Plus, Send, SmilePlus, Trash2, User, X } from "lucide-react";

const reactionEmojis = ["👍", "❤️", "🎉", "😂", "😮", "😢"];
// A wider set than the 6-emoji reaction bar — this one's for *writing*, not
// reacting, so it leans on the same common picks any chat app's picker opens
// with rather than trying to be a full emoji keyboard.
const composerEmojis = [
  "👍", "👎", "❤️", "🔥", "🎉", "😂", "😮", "😢", "😡", "🙏",
  "👏", "🤔", "😴", "🥳", "😅", "🚀", "✅", "❌", "⭐", "💯",
];
const NEAR_BOTTOM_PX = 120;
// Consecutive messages from the same author within this window collapse
// into one visual group (Discord's own cutoff) — avatar/name/timestamp only
// on the first line, so a burst of quick replies doesn't repeat the same
// header five times in a row.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

interface MentionItem {
  type: MentionType;
  id: string;
  label: string;
  sublabel?: string;
}

/** One flat chat line — a top-level post or one of its replies, indistinguishable
 * from each other once flattened (true Discord has no "post vs comment" split,
 * every message is a peer in the same channel timeline). */
type OpenchatMessage = {
  id: string;
  kind: "post" | "reply";
  postId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  images?: ReportPostImage[];
  reactions?: Record<string, string[]>;
};

function toMessages(posts: ReportPost[]): OpenchatMessage[] {
  const out: OpenchatMessage[] = [];
  for (const p of posts) {
    out.push({
      id: p.id,
      kind: "post",
      postId: p.id,
      authorId: p.authorId,
      // Openchat posts never went through the title/sections composer (see
      // OpenchatComposer below) — title carries the whole message text.
      body: p.title,
      createdAt: p.createdAt,
      editedAt: p.editedAt,
      images: p.images,
      reactions: p.reactions,
    });
    for (const r of p.replies) {
      out.push({
        id: r.id,
        kind: "reply",
        postId: p.id,
        authorId: r.authorId,
        body: r.body,
        createdAt: r.createdAt,
        editedAt: r.editedAt,
        images: r.images,
        reactions: r.reactions,
      });
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function OpenchatFeed({
  topic,
  topicPosts,
  onOpenTask,
}: {
  topic: ReportTopic;
  topicPosts: ReportPost[];
  onOpenTask?: (taskId: string) => void;
}) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const addPost = useReportFeedStore((s) => s.addPost);
  const removePost = useReportFeedStore((s) => s.removePost);
  const editPost = useReportFeedStore((s) => s.editPost);
  const editReplyAction = useReportFeedStore((s) => s.editReply);
  const deleteReplyAction = useReportFeedStore((s) => s.deleteReply);
  const toggleReaction = useReportFeedStore((s) => s.toggleReaction);
  const toggleReplyReaction = useReportFeedStore((s) => s.toggleReplyReaction);
  const topics = useReportFeedStore((s) => s.topics);

  const messages = toMessages(topicPosts);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [composerImages, setComposerImages] = useState<ReportPostImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: ReportPostImage[]; index: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ postId: string; replyId?: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [openReactionFor, setOpenReactionFor] = useState<string | null>(null);
  // Touch's "⋯" menu — a separate id from openReactionFor since tapping "⋯"
  // opens a small action list (react/edit/delete stacked), not the reaction
  // popover directly; picking "ทำเครื่องหมาย" from that list is what opens
  // openReactionFor afterwards.
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);

  // @mention — same marker format (`@[label](type:id)`, see
  // report-feed-rich-text.tsx) and trigger/insert mechanics as the main post
  // composer's rich-text editor (report-post-fields.tsx), just scoped down
  // to one flat composer instead of one per section.
  //
  // Users filtered to who can actually see *this* room, same rule the member
  // count/RoomMembersDialog use — otherwise this listed the whole company
  // directory regardless of room ("ต้องแสดงเฉพาะคนที่อยู่ในห้องนั้นไหม").
  const mentionCandidates = useMemo<MentionItem[]>(
    () => [
      ...directoryUsers
        .filter((u) => canSeeReportTopic(topic.visibility, u.id))
        .map((u): MentionItem => ({ type: "user", id: u.id, label: u.name, sublabel: u.role })),
      ...topics.map((t): MentionItem => ({ type: "topic", id: t.id, label: t.name, sublabel: "ห้อง Report" })),
      ...departments.map((d): MentionItem => ({ type: "dept", id: d.id, label: d.name, sublabel: "แผนก" })),
    ],
    [topics, topic.visibility]
  );
  const [mentionMenu, setMentionMenu] = useState<{ query: string; rect: DOMRect; containerTop: number; containerBottom: number; index: number } | null>(null);

  function mentionMatches(query: string): MentionItem[] {
    const q = query.trim().toLowerCase();
    // No cap — the dropdown is its own scroll area, so a room with more than
    // 8 people used to just silently lose everyone past the 8th ("แท็กคนไม่ครบ").
    return q ? mentionCandidates.filter((m) => m.label.toLowerCase().includes(q)) : mentionCandidates;
  }

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

  function syncMentionMenu(el: HTMLElement) {
    const trigger = detectMentionTrigger(el);
    setMentionMenu(trigger ? { query: trigger.query, rect: trigger.rect, containerTop: trigger.containerTop, containerBottom: trigger.containerBottom, index: 0 } : null);
  }

  function makeMentionChip(item: MentionItem): HTMLSpanElement {
    const chip = document.createElement("span");
    chip.className = "mention-chip inline-flex items-center rounded bg-[var(--accent)] text-[var(--brand-green-dark)] px-1 font-medium";
    chip.contentEditable = "false";
    chip.setAttribute("data-mention-type", item.type);
    chip.setAttribute("data-mention-id", item.id);
    chip.textContent = `@${item.label}`;
    return chip;
  }

  function insertMention(item: MentionItem) {
    const el = editorRef.current;
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

    const chip = makeMentionChip(item);
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

    setMentionMenu(null);
    setText(htmlEditorToBulletsText(el));
  }

  function handleComposerDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes(DRAG_MENTION_TOPIC_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleComposerDrop(e: DragEvent<HTMLDivElement>) {
    const raw = e.dataTransfer.getData(DRAG_MENTION_TOPIC_MIME);
    if (!raw) return;
    e.preventDefault();
    const el = editorRef.current;
    if (!el) return;
    try {
      const parsed = JSON.parse(raw) as { id: string; name: string };
      el.focus();
      insertMention({ type: "topic", id: parsed.id, label: parsed.name });
    } catch {
      // Malformed drag payload — ignore, nothing to insert.
    }
  }

  function insertEmoji(emoji: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand("insertText", false, emoji);
    setText(htmlEditorToBulletsText(el));
    setEmojiOpen(false);
  }

  async function handleComposerFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const next: ReportPostImage[] = [];
    try {
      for (const file of Array.from(files).slice(0, 6 - composerImages.length)) {
        const media = await uploadReportMedia(file);
        next.push({ id: `img-${crypto.randomUUID()}`, url: media.url, name: media.name, mime: media.mime });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "แนบไฟล์ไม่สำเร็จบางไฟล์ — ลองใหม่อีกครั้ง");
    } finally {
      if (next.length > 0) setComposerImages((prev) => [...prev, ...next]);
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [topic.id]);

  const prevCount = useRef(messages.length);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > prevCount.current;
    prevCount.current = messages.length;
    if (!grew) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function send() {
    const trimmed = text.trim();
    if ((!trimmed && composerImages.length === 0) || sending) return;
    setSending(true);
    addPost(topic.id, viewingAsUserId, {
      title: trimmed,
      sections: [],
      images: composerImages.length > 0 ? composerImages : [],
      tagIds: [],
    });
    setText("");
    setComposerImages([]);
    if (editorRef.current) editorRef.current.innerHTML = "";
    setSending(false);
  }

  function handleComposerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (mentionMenu) {
      const matches = mentionMatches(mentionMenu.query);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionMenu({ ...mentionMenu, index: matches.length === 0 ? 0 : (mentionMenu.index + 1) % matches.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionMenu({ ...mentionMenu, index: matches.length === 0 ? 0 : (mentionMenu.index - 1 + matches.length) % matches.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = matches[mentionMenu.index];
        if (picked) insertMention(picked);
        else setMentionMenu(null);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionMenu(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!uploading) send();
    }
  }

  function toggleMessageReaction(m: OpenchatMessage, emoji: string) {
    if (m.kind === "post") toggleReaction(m.postId, emoji, viewingAsUserId);
    else toggleReplyReaction(m.postId, m.id, emoji, viewingAsUserId);
  }

  function saveEdit() {
    if (!editing) return;
    const trimmed = editing.body.trim();
    if (!trimmed) return;
    const target = messages.find((m) => m.id === editing.id);
    if (!target) return;
    if (target.kind === "post") {
      const post = topicPosts.find((p) => p.id === target.postId);
      if (post) editPost(post.id, { title: trimmed, sections: [], images: post.images, tagIds: post.tagIds });
    } else {
      editReplyAction(target.postId, target.id, { body: trimmed, images: target.images });
    }
    setEditing(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.replyId) deleteReplyAction(deleteTarget.postId, deleteTarget.replyId);
    else removePost(deleteTarget.postId);
    setDeleteTarget(null);
  }

  const dayGroups = groupByDay(messages, (m) => m.createdAt);

  // "ข้อความใหม่" divider, frozen per room (same idea as the Thread feed):
  // opening a room clears its unread almost immediately, so we snapshot the
  // first still-unread message on the first render for this room and hold the
  // line there. Unread lives per-post, so a message counts as new when its
  // post is unread; the earliest such message in the stream gets the line.
  const dividerRef = useRef<{ topicId: string; beforeId: string | null }>({ topicId: "", beforeId: null });
  if (dividerRef.current.topicId !== topic.id) {
    const unreadPostIds = new Set(
      topicPosts.filter((p) => p.unreadFor.includes(viewingAsUserId) && p.authorId !== viewingAsUserId).map((p) => p.id)
    );
    const firstNew = messages.find((m) => unreadPostIds.has(m.postId));
    dividerRef.current = { topicId: topic.id, beforeId: firstNew ? firstNew.id : null };
  }
  const newDividerBeforeId = dividerRef.current.beforeId;

  return (
    <div className="relative flex-1 flex flex-col min-h-0 rounded-b-2xl overflow-hidden bg-[var(--bg)]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6 text-[var(--ink-soft)]">
            <p className="text-sm font-semibold text-[var(--ink)]">ยินดีต้อนรับสู่ #{topic.name}</p>
            <p className="text-xs">พิมพ์ข้อความแรกด้านล่างเพื่อเริ่มคุยกันได้เลย</p>
          </div>
        ) : (
          dayGroups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center gap-3 px-5 py-2 text-[11px] text-[var(--ink-soft)]">
                <span className="flex-1 h-px bg-[var(--line)]" />
                {group.label}
                <span className="flex-1 h-px bg-[var(--line)]" />
              </div>
              {group.items.map((m, i) => {
                const author = getUser(m.authorId);
                const isOwn = m.authorId === viewingAsUserId;
                const activeReactions = reactionEmojis.map((emoji) => ({ emoji, users: m.reactions?.[emoji] ?? [] })).filter((r) => r.users.length > 0);
                const isEditing = editing?.id === m.id;
                const prev = group.items[i - 1];
                const grouped =
                  !!prev &&
                  prev.authorId === m.authorId &&
                  new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
                return (
                  // py-0.5 read as "everything's one continuous block" once
                  // someone sent 3+ messages in a row — barely 4px separated
                  // two lines of their own text from each other, the same gap
                  // a two-line paragraph's own line-height already has. py-1.5
                  // (still well short of a new sender's py-1.5+avatar+name
                  // header) keeps the "same person, still talking" cue while
                  // making each message in the run its own visible line.
                  <Fragment key={m.id}>
                    {m.id === newDividerBeforeId && <NewMessagesDivider />}
                    <div className={cn("group/msg relative flex gap-3 px-5 hover:bg-[var(--bg-soft)]", grouped ? "py-1" : "py-1.5")}>
                    {grouped ? (
                      // Empty avatar-width gutter — on hover shows the message's
                      // own time, same slot Discord uses for a grouped line.
                      <div className="w-9 shrink-0 flex items-start justify-center">
                        <span className="hidden group-hover/msg:block text-[9.5px] text-[var(--ink-faint)] mt-1 tabular-nums">
                          {new Date(m.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ) : (
                      <Avatar className="h-9 w-9 shrink-0 mt-0.5">
                        <AvatarFallback className="text-[11px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{author?.avatar}</AvatarFallback>
                      </Avatar>
                    )}
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13.5px] font-semibold text-[var(--ink)]">{author?.name ?? "ไม่ทราบชื่อ"}</span>
                          <span className="text-[10.5px] text-[var(--ink-faint)]">
                            {new Date(m.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                            {m.editedAt && " · แก้ไขแล้ว"}
                          </span>
                        </div>
                      )}
                      {grouped && m.editedAt && !isEditing && (
                        <span className="text-[10px] text-[var(--ink-faint)]">แก้ไขแล้ว</span>
                      )}
                      {isEditing ? (
                        <div className="mt-1 space-y-1.5">
                          <textarea
                            autoFocus
                            value={editing.body}
                            onChange={(e) => setEditing({ id: m.id, body: e.target.value })}
                            rows={2}
                            className="w-full resize-none rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brand-green)]/50"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                saveEdit();
                              } else if (e.key === "Escape") setEditing(null);
                            }}
                          />
                          <div className="flex items-center gap-2 text-[11px] text-[var(--ink-soft)]">
                            <button onClick={saveEdit} className="flex items-center gap-1 font-semibold text-[var(--brand-green-dark)]">
                              <Check className="h-3 w-3" /> บันทึก
                            </button>
                            <button onClick={() => setEditing(null)} className="hover:underline">ยกเลิก</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* whitespace-pre-wrap — m.body has real "\n"s from
                              Shift+Enter, but renderRichBulletText only turns
                              inline markers into nodes, never splits on
                              newlines; without this the default
                              white-space:normal collapsed every line break
                              into a space. */}
                          {m.body && (
                            <p className="text-[13.5px] leading-snug mt-0.5 text-[var(--ink)] whitespace-pre-wrap">{renderRichBulletText(m.body)}</p>
                          )}
                          {!!m.images?.length && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {m.images.map((img, i) => (
                                <button
                                  key={img.id}
                                  onClick={() => setLightbox({ images: m.images!, index: i })}
                                  className="rounded-md overflow-hidden border border-[var(--line)] hover:opacity-90 transition-opacity"
                                >
                                  <ReportMediaThumb media={img} className="h-32 w-32 object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                          {activeReactions.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {activeReactions.map(({ emoji, users }) => {
                                const mine = users.includes(viewingAsUserId);
                                const names = users.map((uid) => getUser(uid)?.name ?? "ไม่ทราบชื่อ");
                                return (
                                  // group/reaction + a hidden-until-hover tooltip — Discord's own
                                  // "who reacted" popup, minus the reaction list on the left (this
                                  // chip already *is* one emoji's list, no need to pick it again).
                                  <div key={emoji} className="relative group/reaction">
                                    <button
                                      onClick={() => toggleMessageReaction(m, emoji)}
                                      className={cn(
                                        "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] border transition-colors",
                                        mine
                                          ? "bg-[var(--accent)] border-[var(--brand-green)]/40 text-[var(--brand-green-dark)]"
                                          : "bg-[var(--bg-soft)] border-[var(--line)] text-[var(--ink-soft)]"
                                      )}
                                    >
                                      <span>{emoji}</span>
                                      <span className="tabular-nums">{users.length}</span>
                                    </button>
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/reaction:block z-20 pointer-events-none">
                                      <div className="rounded-lg bg-[var(--ink)] text-white text-[11px] px-2.5 py-1.5 shadow-lg whitespace-nowrap max-w-56">
                                        <p className="font-semibold mb-0.5">{emoji} ทำเครื่องหมายโดย</p>
                                        <p className="text-white/80 truncate">{names.join(", ")}</p>
                                      </div>
                                      <div className="h-2 w-2 bg-[var(--ink)] rotate-45 mx-auto -mt-1" />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Hover action row — floats top-right of the message, Discord-style, instead of a persistent row eating space on every line.
                        Forced visible (not just on `group-hover/msg`) while its own reaction popover is open — the popup renders through a
                        portal, floating below-right of this row rather than overlapping it, so the mouse crosses dead space to reach an emoji
                        and left the hover zone along the way; `group-hover` then hid this row (and the popover's own anchor with it), which is
                        what made a click land on nothing and need repeating ("กดอีโมจิยากมาก...ต้องกดย้ำๆ").

                        Touch gets a different fix, not the same one — a device with no hover at all showing this whole 3-icon row
                        permanently on *every single message* read as a wall of icon clutter next to every short line ("ลกมาก"), especially
                        once several short posts sit close together. Touch instead gets one compact "⋯" further down, tap-to-reveal the same
                        actions in a small menu — closer to how a real chat app (Telegram, Messenger) handles this on mobile than copying the
                        hover row verbatim. */}
                    {!isEditing && (
                      <div
                        className={cn(
                          "absolute right-4 -top-2 hidden items-center gap-0.5 rounded-md p-0.5 border border-[var(--line)] bg-[var(--bg)] shadow-md [@media(hover:none)]:!hidden",
                          openReactionFor === m.id ? "flex" : "group-hover/msg:flex"
                        )}
                      >
                        <Popover open={openReactionFor === m.id} onOpenChange={(open) => setOpenReactionFor(open ? m.id : null)}>
                          <PopoverTrigger
                            render={
                              <button
                                className="h-7 w-7 flex items-center justify-center rounded text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                                aria-label="ทำเครื่องหมาย"
                              >
                                <SmilePlus className="h-3.5 w-3.5" />
                              </button>
                            }
                          />
                          {/* flex-row explicitly — PopoverContent's base classes
                              default to flex-col, and twMerge only drops a class
                              when the override names its replacement, so without
                              this the emoji row rendered as an unclickable-looking
                              vertical stack ("ไม่เห็นกดได้เลยอีโมจิ"). */}
                          <PopoverContent className="w-auto p-1 flex flex-row gap-0.5" align="end">
                            {reactionEmojis.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => {
                                  toggleMessageReaction(m, emoji);
                                  setOpenReactionFor(null);
                                }}
                                className="h-7 w-7 flex items-center justify-center rounded-md text-sm hover:bg-[var(--bg-soft)] transition-transform hover:scale-110"
                              >
                                {emoji}
                              </button>
                            ))}
                          </PopoverContent>
                        </Popover>
                        {isOwn && (
                          <>
                            <button
                              onClick={() => setEditing({ id: m.id, body: m.body })}
                              className="h-7 w-7 flex items-center justify-center rounded text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                              aria-label="แก้ไขข้อความ"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(m.kind === "post" ? { postId: m.postId } : { postId: m.postId, replyId: m.id })}
                              className="h-7 w-7 flex items-center justify-center rounded text-[var(--ink-soft)] hover:bg-red-50 hover:text-[var(--chart-red)]"
                              aria-label="ลบข้อความ"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Touch-only "⋯" — nothing shows next to a message until
                        tapped, same as tapping-and-holding would on a real chat
                        app ("ถ้าไม่เอาไปกดค้างไว้จะไม่เห็นอะไร...ง่ายกว่าไหม").
                        Only rendered at all under [@media(hover:none)], so a
                        mouse user never sees a redundant second trigger next
                        to the hover row above. */}
                    {!isEditing && (
                      <div className="absolute right-4 -top-2 hidden [@media(hover:none)]:block">
                        <Popover open={openActionsFor === m.id} onOpenChange={(open) => setOpenActionsFor(open ? m.id : null)}>
                          <PopoverTrigger
                            render={
                              // Plain and quiet, not a bordered/shadowed button —
                              // this sits next to *every* message permanently on
                              // touch, so a chip-looking control there read as too
                              // loud for what it is ("เล็กๆแบบให้รู้พอ ไม่เอาเด่น").
                              // Bigger tap target than it looks (h-7 w-7) via
                              // padding, not a visible box.
                              <button
                                className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--ink-faint)]"
                                aria-label="ตัวเลือกข้อความ"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            }
                          />
                          <PopoverContent className="w-auto p-1 flex flex-col gap-0.5" align="end">
                            <div className="flex flex-row gap-0.5 p-0.5">
                              {reactionEmojis.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => {
                                    toggleMessageReaction(m, emoji);
                                    setOpenActionsFor(null);
                                  }}
                                  className="h-8 w-8 flex items-center justify-center rounded-md text-base hover:bg-[var(--bg-soft)]"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                            {isOwn && (
                              <>
                                <div className="h-px bg-[var(--line)] mx-1" />
                                <button
                                  onClick={() => {
                                    setEditing({ id: m.id, body: m.body });
                                    setOpenActionsFor(null);
                                  }}
                                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left hover:bg-[var(--bg-soft)]"
                                >
                                  <Pencil className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
                                  แก้ไขข้อความ
                                </button>
                                <button
                                  onClick={() => {
                                    setDeleteTarget(m.kind === "post" ? { postId: m.postId } : { postId: m.postId, replyId: m.id });
                                    setOpenActionsFor(null);
                                  }}
                                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left text-[var(--chart-red)] hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  ลบข้อความ
                                </button>
                              </>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          ))
        )}
      </div>

      {lightbox && (
        <ReportImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
          onClose={() => setLightbox(null)}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบข้อความนี้?</AlertDialogTitle>
            <AlertDialogDescription>ลบแล้วย้อนกลับไม่ได้</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction className="bg-[var(--chart-red)] hover:bg-red-700 text-white" onClick={confirmDelete}>
              ลบข้อความ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Single persistent composer for the whole channel — not one per
          message like Thread's reply box, matching Discord's own bottom bar.
          Light theme now (see file-level note below), only the *layout*
          (one bar, flat stream) is what's meant to read as Discord. @mention,
          image attach, and an emoji picker round it out to match — the same
          three the reference screenshot's composer toolbar showed. */}
      <div className="px-4 pb-4 pt-1 bg-[var(--bg)]">
        {composerImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-2">
            {composerImages.map((img) => (
              <div key={img.id} className="relative h-14 w-14 rounded-md overflow-hidden border border-[var(--line)]">
                <ReportMediaThumb media={img} className="h-full w-full object-cover" />
                <button
                  onClick={() => setComposerImages((prev) => prev.filter((i) => i.id !== img.id))}
                  className="absolute top-0 right-0 h-4 w-4 flex items-center justify-center bg-black/60 text-white rounded-bl-md"
                  aria-label={`ลบรูป ${img.name}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative flex items-end gap-2 rounded-xl px-3 py-2 bg-[var(--bg-soft)] border border-[var(--line)] focus-within:border-[var(--brand-green)]/50 transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/mp4,video/webm"
            multiple
            className="hidden"
            onChange={(e) => handleComposerFiles(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || composerImages.length >= 6}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full bg-[var(--brand-green)] text-[var(--ink)] disabled:opacity-40 mb-0.5"
            aria-label="แนบรูป"
          >
            {uploading ? <ImagePlus className="h-4 w-4 animate-pulse" /> : <Plus className="h-4 w-4" />}
          </button>
          <div
            ref={(el) => {
              editorRef.current = el;
              if (el && el.innerHTML === "" && text !== "") el.innerHTML = text;
            }}
            contentEditable
            role="textbox"
            aria-label="พิมพ์ข้อความ"
            aria-multiline="true"
            suppressContentEditableWarning
            data-placeholder={`พิมพ์ข้อความไปที่ #${topic.name} — พิมพ์ @ เพื่อแท็ก`}
            onInput={(e) => {
              setText(htmlEditorToBulletsText(e.currentTarget));
              syncMentionMenu(e.currentTarget);
            }}
            onKeyUp={(e) => syncMentionMenu(e.currentTarget)}
            onKeyDown={handleComposerKeyDown}
            onDragOver={handleComposerDragOver}
            onDrop={handleComposerDrop}
            className="flex-1 min-w-0 max-h-32 overflow-y-auto bg-transparent text-sm outline-none py-1 text-[var(--ink)] empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--ink-faint)]"
          />
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger
              render={
                <button
                  className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-white mb-0.5"
                  aria-label="แทรกอีโมจิ"
                >
                  <SmilePlus className="h-4 w-4" />
                </button>
              }
            />
            <PopoverContent className="w-64 p-2 grid grid-cols-8 gap-0.5" align="end">
              {composerEmojis.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  className="h-7 w-7 flex items-center justify-center rounded-md text-base hover:bg-[var(--bg-soft)] transition-transform hover:scale-110"
                >
                  {emoji}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <button
            onClick={send}
            disabled={uploading || (!text.trim() && composerImages.length === 0)}
            aria-label="ส่งข้อความ"
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full bg-[var(--brand-green)] text-[var(--ink)] disabled:bg-white disabled:text-[var(--ink-faint)] transition-colors mb-0.5"
          >
            <Send className="h-3.5 w-3.5" />
          </button>

          {mentionMenu &&
            (() => {
              const matches = mentionMatches(mentionMenu.query);
              const spaceBelow = mentionMenu.containerBottom - mentionMenu.rect.bottom - 8;
              const spaceAbove = mentionMenu.rect.top - mentionMenu.containerTop - 8;
              const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
              const maxHeight = Math.max(120, Math.min(224, openAbove ? spaceAbove : spaceBelow));
              return (
                <div
                  style={{
                    position: "fixed",
                    left: mentionMenu.rect.left,
                    maxHeight,
                    ...(openAbove
                      ? { bottom: window.innerHeight - mentionMenu.rect.top + 4 }
                      : { top: mentionMenu.rect.bottom + 4 }),
                  }}
                  className="z-50 w-64 rounded-lg border border-[var(--line)] bg-white shadow-lg py-1 overflow-y-auto"
                >
                  {matches.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-[var(--ink-soft)]">ไม่พบที่ตรงกับ &quot;{mentionMenu.query}&quot;</p>
                  ) : (
                    matches.map((item, i) => {
                      const Icon = item.type === "user" ? User : item.type === "topic" ? Hash : Building2;
                      return (
                        <button
                          key={`${item.type}-${item.id}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertMention(item)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                            i === mentionMenu.index ? "bg-[var(--bg-soft)]" : "hover:bg-[var(--bg-soft)]"
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
        </div>
      </div>
    </div>
  );
}
