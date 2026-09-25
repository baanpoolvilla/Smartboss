"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, BellOff, Crown, ExternalLink, Link2, LogOut, Pencil, Pin, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { useChatStore } from "../store/chat-store";
import type { ChatAttachment, ChatChannelSummary, ChatMessageDTO } from "../types";
import * as api from "../lib/api";
import { channelTitle, formatDayLabel, formatFileSize } from "../lib/format";
import { loadChannels, loadDetail } from "../lib/chat-actions";
import { ChatAvatar } from "./chat-avatar";
import { ChannelAvatar } from "./channel-list";
import { downloadUrl } from "./lightbox";
import { ChatModal, MemberPicker } from "./new-chat-dialog";

type Tab = "members" | "media" | "file" | "link";

const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

function MediaTab({ channelId, kind, onOpenMedia }: { channelId: string; kind: "media" | "file" | "link"; onOpenMedia: (items: ChatAttachment[], i: number) => void }) {
  const [messages, setMessages] = useState<ChatMessageDTO[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async (before?: string) => {
    setLoading(true);
    try {
      const page = await api.fetchChannelMedia(channelId, kind, before);
      setMessages((prev) => (before ? [...(prev ?? []), ...page.messages] : page.messages));
      setHasMore(page.hasMore);
    } catch {
      toast.error("โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  // สลับแท็บ/ห้อง = คอมโพเนนต์ใหม่ (key ที่ตัวเรียก) จึงเริ่มจาก null เสมอ
  useEffect(() => {
    let cancelled = false;
    api
      .fetchChannelMedia(channelId, kind)
      .then((page) => {
        if (cancelled) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
      })
      .catch(() => !cancelled && setMessages([]));
    return () => {
      cancelled = true;
    };
  }, [channelId, kind]);

  if (!messages) return <p className="py-10 text-center text-sm text-(--ink-soft)">กำลังโหลด…</p>;

  const more = hasMore && (
    <div className="flex justify-center py-3">
      <button type="button" disabled={loading} onClick={() => void load(messages[messages.length - 1]?.seq)} className="text-sm font-medium text-(--chat-accent-strong)">
        {loading ? "กำลังโหลด…" : "โหลดเพิ่ม"}
      </button>
    </div>
  );

  if (kind === "media") {
    const items = messages.flatMap((m) => m.attachments.filter((a) => a.kind === "image" || a.kind === "video"));
    if (items.length === 0) return <p className="py-10 text-center text-sm text-(--ink-soft)">ยังไม่มีรูปหรือวิดีโอ</p>;
    return (
      <>
        <div className="grid grid-cols-3 gap-0.5 p-0.5">
          {items.map((a, i) => (
            <button key={a.url} type="button" onClick={() => onOpenMedia(items, i)} className="relative aspect-square bg-(--bg-soft)">
              {a.kind === "video" ? (
                <video src={`${a.url}#t=0.1`} preload="metadata" muted className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumbUrl ?? a.url} alt={a.name} loading="lazy" className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
        {more}
      </>
    );
  }

  if (kind === "file") {
    const items = messages.flatMap((m) => m.attachments.filter((a) => a.kind === "file" || a.kind === "audio").map((a) => ({ a, m })));
    if (items.length === 0) return <p className="py-10 text-center text-sm text-(--ink-soft)">ยังไม่มีไฟล์</p>;
    return (
      <div className="py-1">
        {items.map(({ a, m }) => (
          <a key={a.url} href={downloadUrl(a)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-(--bg-soft)">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-(--bg-soft) text-[10px] font-bold uppercase text-(--ink-soft)">
              {a.kind === "audio" ? "🎤" : (a.name.split(".").pop() ?? "").slice(0, 4)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-(--ink)">{a.name}</span>
              <span className="text-[11.5px] text-(--ink-soft)">
                {formatFileSize(a.size)} · {formatDayLabel(m.createdAt)}
              </span>
            </span>
          </a>
        ))}
        {more}
      </div>
    );
  }

  const links = messages.flatMap((m) => Array.from(new Set(m.body?.match(URL_RE) ?? [])).map((url) => ({ url, m })));
  if (links.length === 0) return <p className="py-10 text-center text-sm text-(--ink-soft)">ยังไม่มีลิงก์</p>;
  return (
    <div className="py-1">
      {links.map(({ url, m }, i) => (
        <a key={`${m.id}-${i}`} href={url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 px-4 py-2.5 hover:bg-(--bg-soft)">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-(--bg-soft) text-(--ink-soft)">
            <Link2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-(--chat-mention)">{url.replace(/^https?:\/\//, "")}</span>
            <span className="text-[11.5px] text-(--ink-soft)">{formatDayLabel(m.createdAt)}</span>
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-(--ink-soft)" />
        </a>
      ))}
      {more}
    </div>
  );
}

export function RoomInfo({
  channel,
  onClose,
  onOpenMedia,
  onLeft,
}: {
  channel: ChatChannelSummary;
  onClose: () => void;
  onOpenMedia: (items: ChatAttachment[], i: number) => void;
  onLeft: () => void;
}) {
  const detail = useChatStore((s) => s.details[channel.id]);
  const users = useChatStore((s) => s.users);
  const onlineIds = useChatStore((s) => s.onlineIds);
  const meId = useChatStore((s) => s.meId);
  const setPrefsLocal = useChatStore((s) => s.setPrefsLocal);
  const [tab, setTab] = useState<Tab>(channel.type === "dm" ? "media" : "members");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(channel.name ?? "");
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [memberMenu, setMemberMenu] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const title = channelTitle(channel, meId, users);
  const canManage = detail?.canManage ?? false;
  const editableMembers = channel.type === "group" && !channel.departmentId;
  const allUsers = useMemo(() => Object.values(users).sort((a, b) => a.name.localeCompare(b.name, "th")), [users]);

  const members = useMemo(() => {
    if (channel.type === "org") return allUsers.map((u) => ({ userId: u.id, role: "member" as const }));
    return (detail?.members ?? channel.memberIds.map((userId) => ({ userId, role: "member" as const }))).slice().sort((a, b) => {
      if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
      return (users[a.userId]?.name ?? "").localeCompare(users[b.userId]?.name ?? "", "th");
    });
  }, [channel.type, channel.memberIds, detail?.members, allUsers, users]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      void loadDetail(channel.id);
      void loadChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    }
  };

  const togglePref = (key: "pinned" | "muted") => {
    const value = !channel[key];
    setPrefsLocal(channel.id, { [key]: value });
    api.updateChannel(channel.id, { [key]: value }).catch(() => {
      setPrefsLocal(channel.id, { [key]: !value });
      toast.error("บันทึกไม่สำเร็จ");
    });
  };

  const otherId = channel.type === "dm" ? channel.memberIds.find((id) => id !== meId) : undefined;
  const other = otherId ? users[otherId] : undefined;

  const tabs: { id: Tab; label: string }[] = [
    ...(channel.type === "dm" ? [] : [{ id: "members" as const, label: `สมาชิก ${members.length}` }]),
    { id: "media", label: "รูป/วิดีโอ" },
    { id: "file", label: "ไฟล์" },
    { id: "link", label: "ลิงก์" },
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-(--bg)">
      <div className="flex items-center gap-2 border-b border-(--line) px-2 py-2">
        <button type="button" onClick={onClose} className="rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft) lg:hidden" aria-label="กลับ">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="flex-1 px-1 text-[15px] font-semibold text-(--ink)">ข้อมูลห้อง</h3>
        <button type="button" onClick={onClose} className="hidden rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft) lg:block" aria-label="ปิด">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-2 px-4 pb-3 pt-5 text-center">
          <ChannelAvatar channel={channel} meId={meId} users={users} online={Boolean(otherId && onlineIds[otherId])} size="h-20 w-20" />
          {renaming ? (
            <form
              className="flex w-full max-w-xs gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setRenaming(false);
                if (name.trim() && name.trim() !== channel.name) void run(() => api.updateChannel(channel.id, { name: name.trim() }), "เปลี่ยนชื่อแล้ว");
              }}
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="min-w-0 flex-1 rounded-lg border border-(--line) px-2 py-1 text-base sm:text-sm" />
              <button type="submit" className="rounded-lg bg-(--chat-accent) px-3 text-sm text-white">
                บันทึก
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="text-lg font-semibold text-(--ink)">{title}</p>
              {canManage && editableMembers && (
                <button type="button" onClick={() => setRenaming(true)} className="rounded-full p-1 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label="เปลี่ยนชื่อกลุ่ม">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <p className="text-[12.5px] text-(--ink-soft)">
            {channel.type === "dm"
              ? [other?.departmentName, otherId && onlineIds[otherId] ? "ออนไลน์" : null].filter(Boolean).join(" · ") || "แชทส่วนตัว"
              : channel.type === "org"
                ? `ทุกคนในบริษัท · ${members.length} คน`
                : channel.departmentId
                  ? `กลุ่มประจำแผนก · ${members.length} คน (ซิงก์ตามแผนกอัตโนมัติ)`
                  : `กลุ่ม · ${members.length} คน`}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => togglePref("muted")} className="flex w-20 flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] text-(--ink-soft) hover:bg-(--bg-soft)">
              {channel.muted ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              {channel.muted ? "เปิดเสียง" : "ปิดเสียง"}
            </button>
            <button type="button" onClick={() => togglePref("pinned")} className="flex w-20 flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] text-(--ink-soft) hover:bg-(--bg-soft)">
              <Pin className={cn("h-5 w-5", channel.pinned && "fill-current")} />
              {channel.pinned ? "เลิกปักหมุด" : "ปักหมุด"}
            </button>
            {editableMembers && canManage && (
              <button type="button" onClick={() => setAdding(true)} className="flex w-20 flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] text-(--ink-soft) hover:bg-(--bg-soft)">
                <UserPlus className="h-5 w-5" /> เพิ่มสมาชิก
              </button>
            )}
          </div>
        </div>

        <div className="sticky top-0 z-10 flex border-b border-(--line) bg-(--bg)">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 border-b-2 py-2.5 text-[12.5px]",
                tab === t.id ? "border-(--chat-accent) font-semibold text-(--chat-accent-strong)" : "border-transparent text-(--ink-soft)"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "members" && (
          <div className="py-1">
            {members.map((m) => {
              const u = users[m.userId];
              if (!u) return null;
              const canEdit = canManage && editableMembers && m.userId !== meId;
              return (
                <div key={m.userId} className="relative flex items-center gap-3 px-4 py-2">
                  <div className="relative">
                    <ChatAvatar name={u.name} src={u.avatarUrl} colorKey={u.id} className="h-10 w-10" />
                    {onlineIds[u.id] && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-(--bg) bg-[#22c55e]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-(--ink)">
                      {u.name}
                      {m.userId === meId && <span className="text-(--ink-soft)"> (คุณ)</span>}
                    </p>
                    {u.departmentName && <p className="truncate text-[12px] text-(--ink-soft)">{u.departmentName}</p>}
                  </div>
                  {m.role === "admin" && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      <Crown className="h-3 w-3" /> แอดมิน
                    </span>
                  )}
                  {canEdit && (
                    <button type="button" onClick={() => setMemberMenu(memberMenu === m.userId ? null : m.userId)} className="rounded-full px-2 py-1 text-[12px] text-(--ink-soft) hover:bg-(--bg-soft)">
                      จัดการ
                    </button>
                  )}
                  {memberMenu === m.userId && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setMemberMenu(null)} />
                      <div className="absolute right-4 top-11 z-30 w-48 rounded-xl border border-(--line) bg-(--bg) p-1 shadow-xl">
                        <button
                          type="button"
                          onClick={() => {
                            setMemberMenu(null);
                            void run(() => api.setChannelMemberRole(channel.id, m.userId, m.role === "admin" ? "member" : "admin"));
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-(--bg-soft)"
                        >
                          <Crown className="h-4 w-4 text-(--ink-soft)" /> {m.role === "admin" ? "ถอนแอดมิน" : "ตั้งเป็นแอดมิน"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMemberMenu(null);
                            void run(() => api.removeChannelMember(channel.id, m.userId), "นำออกจากกลุ่มแล้ว");
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-(--danger) hover:bg-(--bg-soft)"
                        >
                          <UserMinus className="h-4 w-4" /> นำออกจากกลุ่ม
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tab !== "members" && <MediaTab key={`${channel.id}-${tab}`} channelId={channel.id} kind={tab} onOpenMedia={onOpenMedia} />}

        {editableMembers && (
          <div className="border-t border-(--line) p-4">
            <button
              type="button"
              onClick={() => {
                if (!confirmLeave) {
                  setConfirmLeave(true);
                  return;
                }
                void run(() => api.removeChannelMember(channel.id), "ออกจากกลุ่มแล้ว").then(onLeft);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-(--danger)/30 py-2.5 text-sm font-medium text-(--danger) hover:bg-(--danger)/5"
            >
              <LogOut className="h-4 w-4" /> {confirmLeave ? "กดอีกครั้งเพื่อยืนยันออกจากกลุ่ม" : "ออกจากกลุ่ม"}
            </button>
          </div>
        )}
      </div>

      {adding && (
        <ChatModal
          title="เพิ่มสมาชิก"
          onClose={() => {
            setAdding(false);
            setToAdd(new Set());
          }}
          footer={
            <button
              type="button"
              disabled={toAdd.size === 0}
              onClick={() => {
                const ids = [...toAdd];
                setAdding(false);
                setToAdd(new Set());
                void run(() => api.addChannelMembers(channel.id, ids), "เพิ่มสมาชิกแล้ว");
              }}
              className="w-full rounded-xl bg-(--chat-accent) py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              เพิ่ม {toAdd.size > 0 ? `${toAdd.size} คน` : ""}
            </button>
          }
        >
          <MemberPicker
            users={allUsers}
            exclude={new Set(members.map((m) => m.userId))}
            selected={toAdd}
            onlineIds={onlineIds}
            onToggle={(id) =>
              setToAdd((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onToggleMany={(ids, on) =>
              setToAdd((prev) => {
                const next = new Set(prev);
                for (const id of ids) {
                  if (on) next.add(id);
                  else next.delete(id);
                }
                return next;
              })
            }
          />
        </ChatModal>
      )}
    </div>
  );
}
