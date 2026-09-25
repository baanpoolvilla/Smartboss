"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Camera, ChevronRight, FileText, Image as ImageIcon, Loader2, Mic, Paperclip, Plus, RotateCw, SendHorizontal, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import type { RoomMessage } from "../store/chat-store";
import type { ChatAttachment, ChatUser } from "../types";
import { uploadAttachment } from "../lib/api";
import { compressImage } from "../lib/image-compress";
import { attachmentLabel, formatDuration, formatFileSize } from "../lib/format";
import { notifyTyping, sendChatMessage } from "../lib/chat-actions";
import { getChatPrefs } from "../lib/prefs";
import { ChatAvatar } from "./chat-avatar";

const MAX_FILES = 20;
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT_FILES =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";

interface PendingFile {
  id: string;
  file: File;
  kind: ChatAttachment["kind"];
  previewUrl: string | null;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  result?: ChatAttachment;
}

/** ร่างข้อความต่อห้อง — สลับห้องไปมาแล้วข้อความที่พิมพ์ค้างไว้ไม่หาย */
const drafts = new Map<string, string>();

function kindOf(file: File): ChatAttachment["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function isTouchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

async function uploadOne(file: File, kind: ChatAttachment["kind"], onProgress: (f: number) => void): Promise<ChatAttachment> {
  if (kind === "image") {
    const c = await compressImage(file);
    const [full, thumb] = await Promise.all([
      uploadAttachment(c.full, onProgress),
      c.thumb ? uploadAttachment(c.thumb).catch(() => null) : Promise.resolve(null),
    ]);
    return {
      ...full,
      name: file.name || full.name,
      ...(thumb ? { thumbUrl: thumb.url } : {}),
      ...(c.width ? { width: c.width, height: c.height } : {}),
    };
  }
  return uploadAttachment(file, onProgress);
}

export interface ComposerHandle {
  addFiles: (files: File[]) => void;
  focus: () => void;
}

export const Composer = forwardRef<
  ComposerHandle,
  {
    channelId: string;
    channelType: string;
    /** คนที่ @แท็กได้ (ห้อง org = ทุกคนในบริษัท) */
    mentionable: ChatUser[];
    meId: string;
    users: Record<string, ChatUser>;
    replyTo: RoomMessage | null;
    onCancelReply: () => void;
  }
>(function Composer({ channelId, channelType, mentionable, meId, users, replyTo, onCancelReply }, ref) {
  const [text, setText] = useState(() => drafts.get(channelId) ?? "");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [plusOpen, setPlusOpen] = useState(false);
  /** มือถือ: กด ">" ตอนกำลังพิมพ์ เพื่อกางปุ่มกล้อง/รูปกลับมา (แบบ LINE) */
  const [toolsOpen, setToolsOpen] = useState(false);
  const [recording, setRecording] = useState<{ startedAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; cancel: boolean; stream: MediaStream } | null>(null);
  /** ชื่อที่เลือกจากรายชื่อ @ → userId (ตอนส่งเก็บเฉพาะชื่อที่ยังอยู่ในข้อความ) */
  const mentionMap = useRef(new Map<string, string>());

  // สลับห้อง → เก็บร่างห้องเดิม โหลดร่างห้องใหม่
  useEffect(() => {
    setText(drafts.get(channelId) ?? "");
    setPending((list) => {
      releasePreviews(list);
      return [];
    });
    mentionMap.current.clear();
    setMentionQuery(null);
  }, [channelId]);

  useEffect(() => {
    drafts.set(channelId, text);
  }, [channelId, text]);

  // ความสูงช่องพิมพ์ยืดตามข้อความ (สูงสุด ~6 บรรทัด)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [recording]);

  // ล้าง object URL ของรูปตัวอย่าง — ตอนเอาออกทีละอัน/ส่งแล้ว และตอนปิดหน้า
  const previewsRef = useRef(new Set<string>());
  useEffect(() => {
    const previews = previewsRef.current;
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  const releasePreviews = (items: PendingFile[]) => {
    for (const p of items) {
      if (p.previewUrl) {
        URL.revokeObjectURL(p.previewUrl);
        previewsRef.current.delete(p.previewUrl);
      }
    }
  };

  const startUpload = useCallback((item: PendingFile) => {
    const update = (patch: Partial<PendingFile>) => setPending((list) => list.map((p) => (p.id === item.id ? { ...p, ...patch } : p)));
    update({ status: "uploading", progress: 0, error: undefined });
    uploadOne(item.file, item.kind, (f) => update({ progress: f }))
      .then((result) => update({ status: "done", progress: 1, result }))
      .catch((err) => update({ status: "error", error: err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ" }));
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const room = MAX_FILES - pending.length;
      if (room <= 0) {
        toast.error(`แนบได้ครั้งละไม่เกิน ${MAX_FILES} ไฟล์`);
        return;
      }
      const accepted: PendingFile[] = [];
      for (const file of files.slice(0, room)) {
        if (file.size > MAX_BYTES) {
          toast.error(`"${file.name}" ใหญ่เกิน 25MB`);
          continue;
        }
        const kind = kindOf(file);
        const previewUrl = kind === "image" || kind === "video" ? URL.createObjectURL(file) : null;
        if (previewUrl) previewsRef.current.add(previewUrl);
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          kind,
          previewUrl,
          progress: 0,
          status: "uploading",
        });
      }
      if (files.length > room) toast.error(`แนบได้ครั้งละไม่เกิน ${MAX_FILES} ไฟล์`);
      setPending((list) => [...list, ...accepted]);
      accepted.forEach(startUpload);
    },
    [pending.length, startUpload]
  );

  useImperativeHandle(ref, () => ({ addFiles, focus: () => textareaRef.current?.focus() }), [addFiles]);

  // ─── @แท็ก ───
  const candidates = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    const list: { id: string; name: string; user?: ChatUser }[] = [];
    if (channelType !== "dm" && "ทุกคน".includes(q)) list.push({ id: "all", name: "ทุกคน" });
    for (const u of mentionable) {
      if (u.id === meId) continue;
      if (!q || u.name.toLowerCase().includes(q)) list.push({ id: u.id, name: u.name, user: u });
      if (list.length >= 8) break;
    }
    return list;
  }, [mentionQuery, mentionable, meId, channelType]);

  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    if (m) {
      setMentionQuery({ start: caret - m[2]!.length - 1, query: m[2]! });
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const pickMention = (c: { id: string; name: string }) => {
    const el = textareaRef.current;
    if (!el || !mentionQuery) return;
    const caret = el.selectionStart ?? text.length;
    const insert = `@${c.name} `;
    const next = text.slice(0, mentionQuery.start) + insert + text.slice(caret);
    mentionMap.current.set(c.name, c.id);
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = mentionQuery.start + insert.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  // ─── ส่ง ───
  const uploading = pending.some((p) => p.status === "uploading");
  const failed = pending.some((p) => p.status === "error");
  const canSend = (text.trim().length > 0 || pending.some((p) => p.status === "done")) && !uploading && !recording;

  const submit = () => {
    if (uploading) {
      toast.message("รอไฟล์อัปโหลดให้เสร็จก่อน");
      return;
    }
    const body = text.trim();
    const attachments = pending.filter((p) => p.status === "done" && p.result).map((p) => p.result!);
    if (!body && attachments.length === 0) return;
    if (failed) toast.message("ไฟล์ที่อัปโหลดไม่สำเร็จจะไม่ถูกส่ง");
    const mentions = [...mentionMap.current.entries()].filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id);

    sendChatMessage(channelId, { body: body || undefined, attachments, replyTo, mentions });
    setText("");
    releasePreviews(pending);
    setPending([]);
    mentionMap.current.clear();
    drafts.delete(channelId);
    onCancelReply();
    textareaRef.current?.focus();
  };

  // ─── ข้อความเสียง ───
  const startRecording = async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("เบราว์เซอร์นี้อัดเสียงไม่ได้");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      const state = { rec, chunks: [] as Blob[], cancel: false, stream };
      recorderRef.current = state;
      const startedAt = Date.now();
      rec.ondataavailable = (e) => e.data.size > 0 && state.chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        recorderRef.current = null;
        const durationMs = Date.now() - startedAt;
        if (state.cancel || durationMs < 800) return;
        const type = (rec.mimeType || "audio/webm").split(";")[0]!;
        const file = new File(state.chunks, `voice-${Date.now()}.${type.includes("mp4") ? "m4a" : "webm"}`, { type });
        const toastId = toast.loading("กำลังส่งข้อความเสียง…");
        try {
          const a = await uploadAttachment(file);
          sendChatMessage(channelId, { attachments: [{ ...a, name: "ข้อความเสียง", durationMs }], replyTo });
          onCancelReply();
          toast.dismiss(toastId);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "ส่งข้อความเสียงไม่สำเร็จ", { id: toastId });
        }
      };
      rec.start(1000);
      setRecording({ startedAt });
      setNow(Date.now());
    } catch {
      toast.error("ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน");
    }
  };

  const stopRecording = (cancel: boolean) => {
    const r = recorderRef.current;
    if (!r) return;
    r.cancel = cancel;
    if (r.rec.state !== "inactive") r.rec.stop();
  };

  // จำกัดความยาวข้อความเสียง 5 นาที
  useEffect(() => {
    if (recording && now - recording.startedAt > 5 * 60 * 1000) stopRecording(false);
  }, [now, recording]);

  return (
    <div
      className="relative border-t border-(--line) bg-(--bg) px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-3"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length > 0) {
          e.preventDefault();
          addFiles(files);
        }
      }}
    >
      {/* รายชื่อ @แท็ก */}
      {mentionQuery && candidates.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 z-20 mb-1 max-h-64 overflow-y-auto rounded-xl border border-(--line) bg-(--bg) p-1 shadow-xl sm:left-3 sm:right-auto sm:w-72">
          {candidates.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(c);
              }}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm", i === mentionIndex ? "bg-(--chat-accent-soft)" : "hover:bg-(--bg-soft)")}
            >
              {c.user ? (
                <ChatAvatar name={c.name} src={c.user.avatarUrl} colorKey={c.id} className="h-7 w-7" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-(--chat-accent) text-xs font-bold text-white">@</span>
              )}
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.user?.departmentName && <span className="shrink-0 truncate text-[11px] text-(--ink-soft)">{c.user.departmentName}</span>}
            </button>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border-l-[3px] border-(--chat-accent) bg-(--bg-soft) px-3 py-1.5">
          <div className="min-w-0 flex-1 text-[12.5px]">
            <span className="font-semibold text-(--chat-accent-strong)">
              ตอบกลับ {replyTo.authorId === meId ? "ตัวเอง" : (users[replyTo.authorId]?.name ?? "สมาชิก")}
            </span>
            <p className="truncate text-(--ink-soft)">{replyTo.body || attachmentLabel(replyTo.attachments[0]?.kind ?? null)}</p>
          </div>
          <button type="button" onClick={onCancelReply} className="rounded-full p-1 text-(--ink-soft) hover:bg-(--line)" aria-label="ยกเลิกการตอบกลับ">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {pending.map((p) => (
            <div key={p.id} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-(--line) bg-(--bg-soft)">
              {p.previewUrl && p.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.previewUrl} alt={p.file.name} className="h-full w-full object-cover" />
              ) : p.previewUrl && p.kind === "video" ? (
                <video src={p.previewUrl} muted className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center">
                  <FileText className="h-5 w-5 text-(--ink-soft)" />
                  <span className="line-clamp-2 break-all text-[9.5px] leading-tight text-(--ink-soft)">{p.file.name}</span>
                  <span className="text-[9px] text-(--ink-soft)">{formatFileSize(p.file.size)}</span>
                </div>
              )}
              {p.status === "uploading" && (
                <div className="absolute inset-x-1.5 bottom-1.5 h-1.5 overflow-hidden rounded-full bg-black/25">
                  <div className="h-full rounded-full bg-(--chat-accent) transition-[width]" style={{ width: `${Math.max(8, p.progress * 100)}%` }} />
                </div>
              )}
              {p.status === "error" && (
                <button
                  type="button"
                  onClick={() => startUpload(p)}
                  title={p.error}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/55 text-[10px] font-medium text-white"
                >
                  <RotateCw className="h-4 w-4" /> ลองใหม่
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  releasePreviews([p]);
                  setPending((list) => list.filter((x) => x.id !== p.id));
                }}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label="เอาไฟล์นี้ออก"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,video/mp4,video/webm"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_FILES}
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {recording ? (
        <div className="flex h-11 items-center gap-3 rounded-full bg-(--danger)/8 px-2">
          <button type="button" onClick={() => stopRecording(true)} className="flex h-9 w-9 items-center justify-center rounded-full text-(--danger) hover:bg-(--danger)/10" aria-label="ยกเลิกการอัดเสียง">
            <Trash2 className="h-5 w-5" />
          </button>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-(--danger)" />
          <span className="flex-1 text-sm tabular-nums text-(--ink)">กำลังอัดเสียง {formatDuration(now - recording.startedAt)}</span>
          <button type="button" onClick={() => stopRecording(false)} className="flex h-9 items-center gap-1.5 rounded-full bg-(--chat-accent) px-4 text-sm font-medium text-white" aria-label="หยุดและส่ง">
            <Square className="h-3.5 w-3.5" fill="currentColor" /> ส่ง
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setPlusOpen((v) => !v)}
              className={cn("flex h-10 w-10 items-center justify-center rounded-full text-(--ink-soft) transition-transform hover:bg-(--bg-soft)", plusOpen && "rotate-45")}
              aria-label="แนบไฟล์"
              aria-expanded={plusOpen}
            >
              <Plus className="h-6 w-6" />
            </button>
            {plusOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setPlusOpen(false)} />
                <div className="absolute bottom-full left-0 z-30 mb-2 w-48 rounded-xl border border-(--line) bg-(--bg) p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      imageInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-(--bg-soft)"
                  >
                    <ImageIcon className="h-4 w-4 text-(--chat-accent)" /> รูปภาพ / วิดีโอ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-(--bg-soft)"
                  >
                    <Paperclip className="h-4 w-4 text-(--chat-accent)" /> ไฟล์เอกสาร
                  </button>
                </div>
              </>
            )}
          </div>
          {/* ปุ่มกล้อง + รูป แบบ LINE — มือถือพับเก็บตอนกำลังพิมพ์ (กด ">" เพื่อกางกลับ) คอมแสดงตลอด */}
          {text.trim() && !toolsOpen ? (
            <button
              type="button"
              onClick={() => setToolsOpen(true)}
              className="flex h-10 w-8 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--bg-soft) sm:hidden"
              aria-label="แสดงปุ่มกล้องและรูป"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex h-10 w-10 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--bg-soft) sm:hidden"
              aria-label="ถ่ายรูป"
            >
              <Camera className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className={cn(
              "h-10 w-10 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--bg-soft) sm:flex",
              text.trim() && !toolsOpen ? "hidden" : "flex"
            )}
            aria-label="ส่งรูป"
            title="ส่งรูป"
          >
            <ImageIcon className="h-5 w-5" />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            rows={1}
            placeholder="พิมพ์ข้อความ"
            enterKeyHint={isTouchDevice() ? "enter" : "send"}
            onChange={(e) => {
              if (toolsOpen && e.target.value.length > text.length) setToolsOpen(false);
              setText(e.target.value);
              detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
              if (e.target.value.trim()) notifyTyping(channelId);
            }}
            onClick={(e) => detectMention(text, e.currentTarget.selectionStart ?? text.length)}
            onKeyDown={(e) => {
              if (mentionQuery && candidates.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % candidates.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(candidates[mentionIndex]!);
                  return;
                }
                if (e.key === "Escape") {
                  setMentionQuery(null);
                  return;
                }
              }
              // คอม: Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่ · มือถือ: Enter ขึ้นบรรทัด กดปุ่มส่งเอง
              if (e.key !== "Enter" || e.nativeEvent.isComposing || isTouchDevice()) return;
              // ตั้งค่า "กด Enter เพื่อส่ง": เปิด = Enter ส่ง (Shift+Enter ขึ้นบรรทัด), ปิด = Ctrl/⌘+Enter ส่ง
              const send = getChatPrefs().enterToSend ? !e.shiftKey : e.ctrlKey || e.metaKey;
              if (send) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-[20px] border border-(--line) bg-(--bg-soft) px-4 py-2 text-base leading-6 sm:text-[15px] text-(--ink) placeholder:text-(--ink-soft) focus-visible:border-(--chat-accent) focus-visible:outline-none"
          />

          {canSend || text.trim() || uploading ? (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--chat-accent) text-white transition-opacity disabled:opacity-40"
              aria-label="ส่ง"
            >
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--bg-soft)"
              aria-label="อัดข้อความเสียง"
              title="อัดข้อความเสียง"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});
