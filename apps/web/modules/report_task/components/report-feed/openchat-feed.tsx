"use client";

import { useEffect, useRef, useState } from "react";
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
import { useReportFeedStore, type ReportPost, type ReportPostImage, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser } from "@/modules/report_task/lib/directory";
import { groupByDay } from "@/modules/report_task/lib/format";
import { renderRichBulletText } from "@/modules/report_task/lib/report-feed-rich-text";
import { cn } from "@/modules/report_task/lib/utils";
import { Check, Pencil, Plus, SmilePlus, Trash2 } from "lucide-react";

const reactionEmojis = ["👍", "❤️", "🎉", "😂", "😮", "😢"];
const NEAR_BOTTOM_PX = 120;

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

  const messages = toMessages(topicPosts);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: ReportPostImage[]; index: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ postId: string; replyId?: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [openReactionFor, setOpenReactionFor] = useState<string | null>(null);

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
    if (!trimmed || sending) return;
    setSending(true);
    addPost(topic.id, viewingAsUserId, { title: trimmed, sections: [], images: [], tagIds: [] });
    setText("");
    setSending(false);
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
              {group.items.map((m) => {
                const author = getUser(m.authorId);
                const isOwn = m.authorId === viewingAsUserId;
                const activeReactions = reactionEmojis.map((emoji) => ({ emoji, users: m.reactions?.[emoji] ?? [] })).filter((r) => r.users.length > 0);
                const isEditing = editing?.id === m.id;
                return (
                  <div key={m.id} className="group/msg relative flex gap-3 px-5 py-1.5 hover:bg-[var(--bg-soft)]">
                    <Avatar className="h-9 w-9 shrink-0 mt-0.5">
                      <AvatarFallback className="text-[11px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{author?.avatar}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13.5px] font-semibold text-[var(--ink)]">{author?.name ?? "ไม่ทราบชื่อ"}</span>
                        <span className="text-[10.5px] text-[var(--ink-faint)]">
                          {new Date(m.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                          {m.editedAt && " · แก้ไขแล้ว"}
                        </span>
                      </div>
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
                          {m.body && <p className="text-[13.5px] leading-snug mt-0.5 text-[var(--ink)]">{renderRichBulletText(m.body)}</p>}
                          {!!m.images?.length && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {m.images.map((img, i) => (
                                <button
                                  key={img.id}
                                  onClick={() => setLightbox({ images: m.images!, index: i })}
                                  className="rounded-md overflow-hidden border border-[var(--line)] hover:opacity-90 transition-opacity"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={img.url ?? img.dataUrl} alt={img.name} className="h-32 w-32 object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                          {activeReactions.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {activeReactions.map(({ emoji, users }) => {
                                const mine = users.includes(viewingAsUserId);
                                return (
                                  <button
                                    key={emoji}
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
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Hover action row — floats top-right of the message, Discord-style, instead of a persistent row eating space on every line. */}
                    {!isEditing && (
                      <div className="absolute right-4 -top-2 hidden group-hover/msg:flex items-center gap-0.5 rounded-md p-0.5 border border-[var(--line)] bg-[var(--bg)] shadow-md">
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
                          <PopoverContent className="w-auto p-1 flex gap-0.5" align="end">
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
                  </div>
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
          (one bar, flat stream) is what's meant to read as Discord. */}
      <div className="px-4 pb-4 pt-1 bg-[var(--bg)]">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-[var(--bg-soft)] border border-[var(--line)]">
          <button className="h-6 w-6 flex items-center justify-center rounded-full shrink-0 bg-[var(--brand-green)] text-[var(--ink)]" aria-label="แนบไฟล์">
            <Plus className="h-4 w-4" />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`พิมพ์ข้อความไปที่ #${topic.name}`}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
          />
        </div>
      </div>
    </div>
  );
}
