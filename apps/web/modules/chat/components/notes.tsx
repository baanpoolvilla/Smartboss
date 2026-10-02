"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Heart, ImagePlus, Loader2, MessageCircle, MoreHorizontal, NotebookPen, Pencil, SendHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { subscribeRealtime, type RealtimeEventMessage } from "@/lib/realtime-client";
import { useChatStore } from "../store/chat-store";
import type { ChatAttachment, ChatMessageDTO, ChatNoteCommentDTO, ChatNoteDTO } from "../types";
import * as api from "../lib/api";
import { formatClock, formatDayLabel } from "../lib/format";
import { ChatAvatar } from "./chat-avatar";
import { uploadChatMedia } from "./composer";
import { MessageText } from "./message-text";
import { ChatModal } from "./new-chat-dialog";
import { PasteDropFiles } from "@/components/annotate/paste-drop-files";

/**
 * โน้ตของห้องแชท (แบบ LINE) — การ์ดในห้อง, หน้าดูโน้ต (คอมเมนต์/ถูกใจ), หน้าเขียน/แก้, แท็บ "โน้ต"
 * โน้ตที่เปิดอยู่เก็บใน URL (?c=<ห้อง>&note=<id>) ⇒ ลิงก์จากแจ้งเตือนคอมเมนต์เปิดโน้ตตรง ๆ ได้
 * และกระดิ่งนับว่าอ่านแล้วเมื่อเปิดโน้ตนั้น (modules/notifications/mark-read-on-route.tsx)
 */

const MAX_IMAGES = 20;

/** เปิด/ปิดโน้ตผ่าน URL */
export function useNoteParam(channelId: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const noteId = searchParams.get("note");
  // เปิดโน้ตเป็นอีกหน้า (push) — ปุ่มย้อนกลับของมือถือพากลับห้องแชท ไม่ใช่หลุดออกจากแชท
  const pushedRef = useRef(false);
  useEffect(() => {
    if (!noteId) pushedRef.current = false;
  }, [noteId]);
  const open = useCallback(
    (id: string) => {
      const url = `${pathname}?c=${encodeURIComponent(channelId)}&note=${encodeURIComponent(id)}`;
      if (noteId) return router.replace(url, { scroll: false });
      pushedRef.current = true;
      router.push(url, { scroll: false });
    },
    [router, pathname, channelId, noteId]
  );
  const close = useCallback(() => {
    if (pushedRef.current) return router.back();
    router.replace(`${pathname}?c=${encodeURIComponent(channelId)}`, { scroll: false });
  }, [router, pathname, channelId]);
  return { noteId, open, close };
}

function authorName(users: Record<string, { name: string }>, id: string, meId: string): string {
  return id === meId ? "คุณ" : (users[id]?.name ?? "สมาชิก");
}

// ─── การ์ดในห้อง ─────────────────────────────────────────────────────────

export function NoteCard({ message, mine }: { message: ChatMessageDTO; mine: boolean }) {
  const { open } = useNoteParam(message.channelId);
  const users = useChatStore((s) => s.users);
  const note = message.note;
  const who = mine ? "คุณ" : (users[message.authorId]?.name ?? "สมาชิก");
  return (
    <button
      type="button"
      disabled={!note}
      onClick={() => note && open(note.id)}
      className={cn(
        "w-64 max-w-full overflow-hidden rounded-2xl border border-(--line) bg-(--bg) text-left shadow-[0_1px_1px_rgba(0,0,0,0.06)] transition-colors hover:bg-(--bg-soft) sm:w-72",
        mine ? "rounded-tr-md" : "rounded-tl-md"
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-(--line) px-3 py-2 text-[12px] font-semibold text-(--chat-accent-strong)">
        <NotebookPen className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{who} เพิ่มโน้ต</span>
      </div>
      {note ? (
        <div className="flex gap-2.5 px-3 py-2.5">
          <p className="line-clamp-4 min-w-0 flex-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-(--ink)">{note.excerpt}</p>
          {note.thumbUrl && (
            <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-(--bg-soft)">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={note.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              {note.imageCount > 1 && (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">+{note.imageCount - 1}</span>
              )}
            </span>
          )}
        </div>
      ) : (
        <p className="px-3 py-2.5 text-[13px] text-(--ink-soft)">โน้ตนี้ถูกลบแล้ว</p>
      )}
      {note && <div className="border-t border-(--line) px-3 py-1.5 text-center text-[12px] font-medium text-(--chat-accent-strong)">ดูโน้ต</div>}
    </button>
  );
}

// ─── หน้าเขียน / แก้ ────────────────────────────────────────────────────

export function NoteEditor({
  channelId,
  note,
  onClose,
  onSaved,
}: {
  channelId: string;
  /** มี = แก้โน้ตเดิม */
  note?: ChatNoteDTO;
  onClose: () => void;
  /** message = การ์ดโน้ตที่เพิ่งโพสต์ (สร้างใหม่เท่านั้น) */
  onSaved?: (noteId: string, message?: ChatMessageDTO) => void;
}) {
  const [body, setBody] = useState(note?.body ?? "");
  const [images, setImages] = useState<ChatAttachment[]>(note?.attachments ?? []);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addImages(files: File[]) {
    const room = MAX_IMAGES - images.length;
    const picked = files.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (picked.length < files.length) toast.message(`แนบรูปได้ไม่เกิน ${MAX_IMAGES} รูป (เฉพาะรูปภาพ)`);
    setUploading((n) => n + picked.length);
    for (const f of picked) {
      try {
        const a = await uploadChatMedia(f, "image", () => {});
        setImages((prev) => [...prev, a]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "อัปโหลดรูปไม่สำเร็จ");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function save() {
    if (!body.trim()) return toast.error("เขียนเนื้อหาโน้ตก่อน");
    setSaving(true);
    try {
      if (note) {
        await api.updateNote(note.id, body, images);
        toast.success("แก้ไขโน้ตแล้ว");
        onSaved?.(note.id);
      } else {
        const { id, message } = await api.createNote(channelId, body, images);
        toast.success("โพสต์โน้ตแล้ว");
        onSaved?.(id, message);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกโน้ตไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ChatModal
      title={note ? "แก้ไขโน้ต" : "สร้างโน้ต"}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={images.length >= MAX_IMAGES}
            className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm text-(--ink-soft) hover:bg-(--bg-soft) disabled:opacity-40"
          >
            <ImagePlus className="h-5 w-5 text-(--chat-accent)" /> รูปภาพ
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || uploading > 0 || !body.trim()}
            className="ml-auto h-10 rounded-xl bg-(--chat-accent) px-5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? "กำลังบันทึก…" : uploading > 0 ? "กำลังอัปโหลดรูป…" : note ? "บันทึก" : "โพสต์"}
          </button>
        </div>
      }
    >
      <PasteDropFiles label="ปล่อยเพื่อแนบรูปในโน้ต">
      <div className="flex flex-col gap-3 p-4">
        <textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10_000}
          placeholder="เขียนโน้ต เช่น สรุปประชุม ขั้นตอนงาน ข้อมูลที่ทุกคนในห้องต้องรู้"
          className="min-h-48 w-full resize-y rounded-xl border border-(--line) bg-(--bg) p-3 text-base leading-relaxed focus:border-(--chat-accent) focus:outline-none sm:text-sm"
        />
        {(images.length > 0 || uploading > 0) && (
          <div className="grid grid-cols-4 gap-1.5">
            {images.map((a) => (
              <span key={a.url} className="relative aspect-square overflow-hidden rounded-lg bg-(--bg-soft)">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.thumbUrl ?? a.url} alt={a.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((x) => x.url !== a.url))}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                  aria-label="เอารูปออก"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <span key={`up-${i}`} className="flex aspect-square items-center justify-center rounded-lg bg-(--bg-soft)">
                <Loader2 className="h-5 w-5 animate-spin text-(--ink-soft)" />
              </span>
            ))}
          </div>
        )}
        <p className="text-[11.5px] text-(--ink-soft)">โน้ตเก็บถาวร ไม่หมดอายุเหมือนรูปในแชท · ทุกคนในห้องเห็น คอมเมนต์ และกดถูกใจได้</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 0) void addImages(files);
          }}
        />
      </div>
      </PasteDropFiles>
    </ChatModal>
  );
}

// ─── หน้าดูโน้ต ──────────────────────────────────────────────────────────

export function NoteViewer({
  noteId,
  onClose,
  onOpenMedia,
}: {
  noteId: string;
  onClose: () => void;
  onOpenMedia: (items: ChatAttachment[], i: number) => void;
}) {
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.meId);
  const [data, setData] = useState<{ note: ChatNoteDTO; comments: ChatNoteCommentDTO[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.fetchNote(noteId));
    } catch {
      setMissing(true);
    }
  }, [noteId]);

  useEffect(() => {
    // โหลดจากเซิร์ฟเวอร์ (setState หลัง await ไม่ใช่ในจังหวะ effect)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // คนอื่นคอมเมนต์/ถูกใจ/แก้ ระหว่างเปิดอยู่ → โหลดใหม่
    return subscribeRealtime((e: RealtimeEventMessage) => {
      if (e.type === "chat.note" && e.noteId === noteId) void load();
    });
  }, [noteId, load]);

  async function sendComment() {
    const text = comment.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { comment: c } = await api.addNoteComment(noteId, text);
      setComment("");
      setData((d) => (d ? { note: { ...d.note, commentCount: d.note.commentCount + 1 }, comments: [...d.comments.filter((x) => x.id !== c.id), c] } : d));
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งคอมเมนต์ไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  }

  async function like() {
    if (!data) return;
    const liked = data.note.likeUserIds.includes(meId);
    const optimistic = liked ? data.note.likeUserIds.filter((id) => id !== meId) : [...data.note.likeUserIds, meId];
    setData({ ...data, note: { ...data.note, likeUserIds: optimistic } });
    try {
      const { likeUserIds } = await api.toggleNoteLike(noteId);
      setData((d) => (d ? { ...d, note: { ...d.note, likeUserIds } } : d));
    } catch {
      setData((d) => (d ? { ...d, note: { ...d.note, likeUserIds: data.note.likeUserIds } } : d));
      toast.error("กดถูกใจไม่สำเร็จ");
    }
  }

  async function removeNote() {
    try {
      await api.deleteNote(noteId);
      toast.success("ลบโน้ตแล้ว");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบโน้ตไม่สำเร็จ");
    }
  }

  async function removeComment(c: ChatNoteCommentDTO) {
    try {
      await api.deleteNoteComment(noteId, c.id);
      setData((d) => (d ? { note: { ...d.note, commentCount: d.note.commentCount - 1 }, comments: d.comments.filter((x) => x.id !== c.id) } : d));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบคอมเมนต์ไม่สำเร็จ");
    }
  }

  if (editing && data) {
    return <NoteEditor channelId={data.note.channelId} note={data.note} onClose={() => setEditing(false)} onSaved={() => void load()} />;
  }

  const note = data?.note;
  const liked = note?.likeUserIds.includes(meId) ?? false;

  return (
    <ChatModal
      title="โน้ต"
      onClose={onClose}
      footer={
        note && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendComment();
            }}
          >
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  void sendComment();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="เขียนคอมเมนต์…"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl bg-(--bg-soft) px-3.5 py-2.5 text-base focus:outline-none sm:text-sm"
            />
            <button
              type="submit"
              disabled={!comment.trim() || sending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--chat-accent) text-white disabled:opacity-40"
              aria-label="ส่งคอมเมนต์"
            >
              <SendHorizontal className="h-5 w-5" />
            </button>
          </form>
        )
      }
    >
      {missing ? (
        <p className="py-16 text-center text-sm text-(--ink-soft)">ไม่พบโน้ตนี้ อาจถูกลบไปแล้ว</p>
      ) : !note ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-(--ink-soft)">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด…
        </p>
      ) : (
        <div className="pb-2">
          <div className="relative flex items-center gap-3 px-4 pt-4">
            <ChatAvatar name={users[note.authorId]?.name ?? "?"} src={users[note.authorId]?.avatarUrl} colorKey={note.authorId} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-(--ink)">{authorName(users, note.authorId, meId)}</p>
              <p className="text-[12px] text-(--ink-soft)">
                {formatDayLabel(note.createdAt)} {formatClock(note.createdAt)}
                {note.edited && " · แก้ไขแล้ว"}
              </p>
            </div>
            {note.canEdit && (
              <button type="button" onClick={() => setMenu((v) => !v)} className="rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label="จัดการโน้ต">
                <MoreHorizontal className="h-5 w-5" />
              </button>
            )}
            {menu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
                <div className="absolute right-4 top-14 z-30 w-44 rounded-xl border border-(--line) bg-(--bg) p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setEditing(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-(--bg-soft)"
                  >
                    <Pencil className="h-4 w-4 text-(--ink-soft)" /> แก้ไขโน้ต
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirmDelete) return setConfirmDelete(true);
                      setMenu(false);
                      void removeNote();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-(--danger) hover:bg-(--bg-soft)"
                  >
                    <Trash2 className="h-4 w-4" /> {confirmDelete ? "กดอีกครั้งเพื่อลบ" : "ลบโน้ต"}
                  </button>
                </div>
              </>
            )}
          </div>

          <p className="whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-relaxed text-(--ink) [overflow-wrap:anywhere]">
            <MessageText body={note.body} mentions={[]} users={users} meId={meId} />
          </p>

          {note.attachments.length > 0 && (
            <div className={cn("grid gap-1 px-4", note.attachments.length === 1 ? "grid-cols-1" : "grid-cols-3")}>
              {note.attachments.map((a, i) => (
                <button
                  key={a.url}
                  type="button"
                  onClick={() => onOpenMedia(note.attachments, i)}
                  className={cn("overflow-hidden rounded-lg bg-(--bg-soft)", note.attachments.length === 1 ? "max-h-96" : "aspect-square")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={note.attachments.length === 1 ? a.url : (a.thumbUrl ?? a.url)} alt={a.name} loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-4 border-y border-(--line) px-4 py-2">
            <button
              type="button"
              onClick={() => void like()}
              className={cn("flex items-center gap-1.5 text-sm", liked ? "font-semibold text-rose-500" : "text-(--ink-soft)")}
            >
              <Heart className={cn("h-5 w-5", liked && "fill-current")} /> ถูกใจ {note.likeUserIds.length > 0 && note.likeUserIds.length}
            </button>
            <span className="flex items-center gap-1.5 text-sm text-(--ink-soft)">
              <MessageCircle className="h-5 w-5" /> คอมเมนต์ {data.comments.length > 0 && data.comments.length}
            </span>
          </div>
          {note.likeUserIds.length > 0 && (
            <p className="px-4 pt-2 text-[12px] text-(--ink-soft)">
              <Heart className="mr-1 inline h-3 w-3 fill-rose-500 text-rose-500" />
              {note.likeUserIds.map((id) => authorName(users, id, meId)).join(", ")}
            </p>
          )}

          <div className="px-4 pt-2">
            {data.comments.length === 0 && <p className="py-4 text-center text-[13px] text-(--ink-soft)">ยังไม่มีคอมเมนต์</p>}
            {data.comments.map((c) => (
              <div key={c.id} className="group flex gap-2.5 py-2">
                <ChatAvatar name={users[c.authorId]?.name ?? "?"} src={users[c.authorId]?.avatarUrl} colorKey={c.authorId} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="rounded-2xl rounded-tl-md bg-(--bg-soft) px-3 py-2">
                    <p className="text-[12px] font-semibold text-(--ink)">{authorName(users, c.authorId, meId)}</p>
                    <p className="whitespace-pre-wrap break-words text-[13.5px] text-(--ink) [overflow-wrap:anywhere]">
                      <MessageText body={c.body} mentions={[]} users={users} meId={meId} />
                    </p>
                  </div>
                  <p className="mt-0.5 flex gap-3 px-2 text-[11px] text-(--ink-soft)">
                    {formatDayLabel(c.createdAt)} {formatClock(c.createdAt)}
                    {c.canDelete && (
                      <button type="button" onClick={() => void removeComment(c)} className="hover:text-(--danger) hover:underline">
                        ลบ
                      </button>
                    )}
                  </p>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>
      )}
    </ChatModal>
  );
}

// ─── แท็บ "โน้ต" ในข้อมูลห้อง ─────────────────────────────────────────────

export function NotesTab({ channelId, onCreate }: { channelId: string; onCreate: () => void }) {
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.meId);
  const { open } = useNoteParam(channelId);
  const [notes, setNotes] = useState<ChatNoteDTO[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .fetchNotes(channelId)
        .then((r) => !cancelled && setNotes(r.notes))
        .catch(() => !cancelled && setNotes([]));
    void load();
    const off = subscribeRealtime((e: RealtimeEventMessage) => {
      if ((e.type === "chat.note" || (e.type === "chat.message" && (e.message as ChatMessageDTO | undefined)?.kind === "note")) && e.channelId === channelId) void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [channelId]);

  return (
    <div className="py-2">
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-(--chat-accent) py-2.5 text-sm font-medium text-(--chat-accent-strong) hover:bg-(--chat-accent-soft)"
        >
          <NotebookPen className="h-4 w-4" /> สร้างโน้ต
        </button>
      </div>
      {!notes ? (
        <p className="py-10 text-center text-sm text-(--ink-soft)">กำลังโหลด…</p>
      ) : notes.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-(--ink-soft)">ยังไม่มีโน้ต — ใช้เก็บเรื่องที่ทุกคนในห้องต้องรู้ เช่น สรุปประชุม ขั้นตอนงาน</p>
      ) : (
        notes.map((n) => {
          const thumb = n.attachments[0];
          return (
            <button key={n.id} type="button" onClick={() => open(n.id)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-(--bg-soft)">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-(--ink)">{n.body}</p>
                <p className="mt-1 flex items-center gap-2 text-[11.5px] text-(--ink-soft)">
                  <span className="truncate">
                    {authorName(users, n.authorId, meId)} · {formatDayLabel(n.createdAt)}
                  </span>
                  {n.likeUserIds.length > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Heart className="h-3 w-3" /> {n.likeUserIds.length}
                    </span>
                  )}
                  {n.commentCount > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <MessageCircle className="h-3 w-3" /> {n.commentCount}
                    </span>
                  )}
                </p>
              </div>
              {thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb.thumbUrl ?? thumb.url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
