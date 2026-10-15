"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bookmark,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderPlus,
  Link2,
  Loader2,
  MoreHorizontal,
  Music,
  Pencil,
  Play,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { useBackToClose } from "@/lib/back-to-close";
import { useChatStore } from "../store/chat-store";
import { isKeepChannelId, type ChatKeepCollectionDTO, type ChatKeepItemDTO } from "../types";
import {
  createKeepCollection,
  deleteKeepCollection,
  deleteKeepItem,
  fetchKeep,
  renameKeepCollection,
  sendMessage,
  setKeepItemCollections,
  type KeepListResponse,
} from "../lib/api";
import { channelTitle } from "../lib/format";
import { ChannelAvatar } from "./channel-list";
import { ChatModal } from "./new-chat-dialog";
import { Lightbox, downloadUrl } from "./lightbox";

const TABS = [
  { id: "all", label: "ทั้งหมด" },
  { id: "image", label: "รูปภาพ" },
  { id: "video", label: "วิดีโอ" },
  { id: "link", label: "ลิงก์" },
  { id: "file", label: "ไฟล์" },
  { id: "text", label: "ข้อความ" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("th-TH", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "2-digit" }).format(d);
}

function firstUrl(text: string | null): string | null {
  return text?.match(/https?:\/\/\S+/i)?.[0] ?? null;
}

/**
 * คลัง Keep (แบบ LINE) — ของที่เก็บไว้ทั้งหมดของตัวเอง: แท็บตามประเภท, ค้นหา, คอลเลกชัน,
 * ส่งต่อเข้าห้องแชท, ลบ · เปิดจากปุ่ม 🔖 บนหัวรายการแชท หรือหัวห้อง Keep Memo
 */
export function KeepLibrary({ onClose, onOpenMemo }: { onClose: () => void; onOpenMemo: () => void }) {
  useBackToClose(true, onClose);
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.meId);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [collection, setCollection] = useState<string | null>(null);
  const [data, setData] = useState<KeepListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatKeepItemDTO | null>(null);
  const [forwarding, setForwarding] = useState<ChatKeepItemDTO | null>(null);
  const [collecting, setCollecting] = useState<ChatKeepItemDTO | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [newCollection, setNewCollection] = useState<string | null>(null);
  const [editCollection, setEditCollection] = useState<ChatKeepCollectionDTO | null>(null);

  // พิมพ์ค้นหาแล้วรอนิดหนึ่งก่อนยิง
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // โหลดใหม่เมื่อเปลี่ยนแท็บ/คำค้น/คอลเลกชัน หรือหลังแก้ไข (load()) — ระหว่างรอยังโชว์ชุดเดิม
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    fetchKeep({ tab, q, collection: collection ?? undefined })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "โหลด Keep ไม่สำเร็จ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, q, collection, reloadKey]);

  const loadMore = async () => {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const last = data.items[data.items.length - 1];
      const more = await fetchKeep({ tab, q, collection: collection ?? undefined, before: last?.createdAt });
      setData({ ...more, items: [...data.items, ...more.items] });
    } catch {
      toast.error("โหลดเพิ่มไม่สำเร็จ");
    } finally {
      setLoadingMore(false);
    }
  };

  const items = useMemo(() => data?.items ?? [], [data]);
  const media = useMemo(() => items.filter((i) => (i.kind === "image" || i.kind === "video") && i.attachment), [items]);
  const grid = tab === "image" || tab === "video";

  const remove = async (item: ChatKeepItemDTO) => {
    setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== item.id), usedBytes: Math.max(0, d.usedBytes - item.size) } : d));
    try {
      await deleteKeepItem(item.id);
      toast.success("ลบออกจาก Keep แล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      load();
    }
  };

  const sourceText = (item: ChatKeepItemDTO): string => {
    if (!item.source || item.source.fromKeepMemo) return "Keep Memo";
    const who = item.source.authorId ? (item.source.authorId === meId ? "คุณ" : (users[item.source.authorId]?.name ?? "")) : "";
    const room = item.source.label ?? "แชท";
    return who ? `จาก ${room} · ${who}` : `จาก ${room}`;
  };

  const used = data?.usedBytes ?? 0;
  const quota = data?.quotaBytes ?? 1;
  const collections = data?.collections ?? [];

  return createPortal(
    <div className="chat-ui fixed inset-0 z-[55] flex justify-center bg-black/30 sm:p-4" onClick={onClose}>
      <div
        className="flex h-dvh w-full flex-col overflow-hidden bg-(--bg) pt-[env(safe-area-inset-top)] shadow-2xl sm:h-full sm:max-w-2xl sm:rounded-2xl sm:pt-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keep"
      >
        <header className="flex items-center gap-2 border-b border-(--line) px-2 py-2 sm:px-3">
          <button type="button" onClick={onClose} className="rounded-full p-2 text-(--ink) hover:bg-(--bg-soft)" aria-label="ปิด Keep">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Bookmark className="h-5 w-5 text-[#1fa463]" />
          <h2 className="flex-1 text-[16px] font-bold text-(--ink)">Keep</h2>
          <button
            type="button"
            onClick={onOpenMemo}
            className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-[#1fa463] hover:bg-(--bg-soft)"
            title="เปิดห้อง Keep Memo (แชทกับตัวเอง)"
          >
            Keep Memo
          </button>
        </header>

        <div className="flex flex-col gap-1 px-4 pt-2.5 text-[11.5px] text-(--ink-soft)">
          <span>
            ใช้ไป {bytes(used)} / {bytes(quota)}
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-(--bg-soft)">
            <div className="h-full rounded-full bg-[#1fa463]" style={{ width: `${Math.min(100, (used / quota) * 100)}%` }} />
          </div>
        </div>

        <div className="px-3 pt-2.5">
          <label className="flex items-center gap-2 rounded-xl bg-(--bg-soft) px-3 py-2">
            <Search className="h-4 w-4 text-(--ink-soft)" />
            <input
              id="keep-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาใน Keep"
              className="min-w-0 flex-1 bg-transparent text-base text-(--ink) placeholder:text-(--ink-soft) focus:outline-none sm:text-sm"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา" className="text-(--ink-soft)">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        </div>

        <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-[12.5px] transition-colors",
                tab === t.id ? "bg-[#1fa463] font-semibold text-white" : "bg-(--bg-soft) text-(--ink-soft) hover:text-(--ink)"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-(--line) px-3 pb-2.5">
          <button
            type="button"
            onClick={() => setNewCollection("")}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-(--line) px-2.5 py-1.5 text-[12px] text-(--ink-soft) hover:text-(--ink)"
          >
            <FolderPlus className="h-3.5 w-3.5" /> คอลเลกชัน
          </button>
          {collections.map((c) => (
            <span key={c.id} className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => setCollection((cur) => (cur === c.id ? null : c.id))}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-[12px]",
                  collection === c.id ? "border-[#1fa463] bg-[#1fa463]/10 font-semibold text-[#1a8a54]" : "border-(--line) text-(--ink)"
                )}
              >
                {c.name} <span className="text-(--ink-soft)">{c.count}</span>
              </button>
              {collection === c.id && (
                <button type="button" onClick={() => setEditCollection(c)} className="ml-0.5 rounded p-1 text-(--ink-soft) hover:text-(--ink)" aria-label="แก้คอลเลกชัน">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !data ? (
            <div className="flex justify-center py-12 text-(--ink-soft)">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-(--ink-soft)">
              <Bookmark className="h-10 w-10 opacity-40" />
              {q || collection || tab !== "all" ? (
                <p>ไม่พบรายการ</p>
              ) : (
                <>
                  <p className="font-medium text-(--ink)">ยังไม่มีอะไรใน Keep</p>
                  <p>ส่งข้อความ รูป หรือไฟล์เข้าห้อง Keep Memo หรือกดค้างที่ข้อความในห้องไหนก็ได้แล้วเลือก &quot;Keep&quot;</p>
                </>
              )}
            </div>
          ) : grid ? (
            <div className="grid grid-cols-3 gap-0.5 p-0.5 sm:grid-cols-4">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLightbox(media.indexOf(item))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuFor(item);
                  }}
                  className="relative aspect-square overflow-hidden bg-(--bg-soft)"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {item.attachment && <img src={item.attachment.thumbUrl ?? item.attachment.url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                  {item.kind === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Play className="h-8 w-8 fill-white text-white drop-shadow" />
                    </span>
                  )}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(item);
                    }}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white"
                    aria-label="ตัวเลือก"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-(--line)">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <ItemThumb item={item} onOpen={() => setLightbox(media.indexOf(item))} />
                  <div className="min-w-0 flex-1">
                    <ItemMain item={item} />
                    <p className="mt-0.5 truncate text-[11.5px] text-(--ink-soft)">
                      {sourceText(item)} · {when(item.createdAt)}
                      {item.collectionIds.length > 0 &&
                        ` · ${item.collectionIds.map((id) => collections.find((c) => c.id === id)?.name).filter(Boolean).join(", ")}`}
                    </p>
                  </div>
                  <button type="button" onClick={() => setMenuFor(item)} className="rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label="ตัวเลือก">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data?.hasMore && (
            <div className="flex justify-center py-4">
              <button type="button" onClick={() => void loadMore()} className="rounded-full border border-(--line) px-4 py-1.5 text-sm text-(--ink)">
                {loadingMore ? "กำลังโหลด…" : "ดูเพิ่ม"}
              </button>
            </div>
          )}
        </div>
      </div>

      {menuFor && (
        <ItemMenu
          item={menuFor}
          onClose={() => setMenuFor(null)}
          onForward={() => setForwarding(menuFor)}
          onCollect={() => setCollecting(menuFor)}
          onDelete={() => void remove(menuFor)}
        />
      )}

      {forwarding && <ForwardPicker item={forwarding} meId={meId} users={users} onClose={() => setForwarding(null)} />}

      {collecting && (
        <CollectionPicker
          item={collecting}
          collections={collections}
          onClose={() => setCollecting(null)}
          onSaved={(ids) => {
            setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === collecting.id ? { ...i, collectionIds: ids } : i)) } : d));
            setCollecting(null);
            load();
          }}
        />
      )}

      {newCollection !== null && (
        <NameDialog
          title="คอลเลกชันใหม่"
          initial=""
          onClose={() => setNewCollection(null)}
          onSave={async (name) => {
            await createKeepCollection(name);
            setNewCollection(null);
            load();
          }}
        />
      )}

      {editCollection && (
        <NameDialog
          title="แก้คอลเลกชัน"
          initial={editCollection.name}
          onClose={() => setEditCollection(null)}
          onSave={async (name) => {
            await renameKeepCollection(editCollection.id, name);
            setEditCollection(null);
            load();
          }}
          onDelete={async () => {
            await deleteKeepCollection(editCollection.id);
            setEditCollection(null);
            setCollection(null);
            toast.success("ลบคอลเลกชันแล้ว (ของข้างในยังอยู่ใน Keep)");
          }}
        />
      )}

      {lightbox !== null && lightbox >= 0 && media.length > 0 && (
        <Lightbox items={media.map((m) => m.attachment!)} index={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>,
    document.body
  );
}

function ItemThumb({ item, onOpen }: { item: ChatKeepItemDTO; onOpen: () => void }) {
  const box = "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg";
  if ((item.kind === "image" || item.kind === "video") && item.attachment) {
    return (
      <button type="button" onClick={onOpen} className={cn(box, "relative bg-(--bg-soft)")} aria-label="ดูเต็มจอ">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.attachment.thumbUrl ?? item.attachment.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        {item.kind === "video" && <Play className="absolute h-5 w-5 fill-white text-white drop-shadow" />}
      </button>
    );
  }
  if (item.kind === "file") return <span className={cn(box, "bg-[#e04f3f] text-white")}><FileText className="h-5 w-5" /></span>;
  if (item.kind === "audio") return <span className={cn(box, "bg-[#8a74c9] text-white")}><Music className="h-5 w-5" /></span>;
  if (item.kind === "link") return <span className={cn(box, "bg-[#5f8fd1] text-white")}><Link2 className="h-5 w-5" /></span>;
  return <span className={cn(box, "bg-(--bg-soft) text-[15px] font-semibold text-(--ink-soft)")}>Aa</span>;
}

function ItemMain({ item }: { item: ChatKeepItemDTO }) {
  if (item.attachment && (item.kind === "file" || item.kind === "audio")) {
    return (
      <a href={downloadUrl(item.attachment)} className="block truncate text-sm font-medium text-(--ink) hover:underline">
        {item.attachment.name}
        <span className="ml-1.5 text-[11.5px] font-normal text-(--ink-soft)">{bytes(item.attachment.size)}</span>
      </a>
    );
  }
  if (item.kind === "image" || item.kind === "video") {
    return <p className="truncate text-sm font-medium text-(--ink)">{item.kind === "image" ? "รูปภาพ" : "วิดีโอ"}</p>;
  }
  const url = item.kind === "link" ? firstUrl(item.body) : null;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="line-clamp-2 break-all text-sm text-[#2563eb] hover:underline">
        {item.body}
      </a>
    );
  }
  return <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-(--ink)">{item.body}</p>;
}

function ItemMenu({
  item,
  onClose,
  onForward,
  onCollect,
  onDelete,
}: {
  item: ChatKeepItemDTO;
  onClose: () => void;
  onForward: () => void;
  onCollect: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  useBackToClose(true, onClose);
  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-(--ink) hover:bg-(--bg-soft)";
  const url = item.attachment ? null : firstUrl(item.body);
  return createPortal(
    <div className="chat-ui fixed inset-0 z-[75] flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full rounded-t-2xl bg-(--bg) p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-xs sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="menu">
        <button type="button" className={row} onClick={() => { onClose(); onForward(); }}>
          <Send className="h-4 w-4 text-(--ink-soft)" /> ส่งต่อไปที่แชท
        </button>
        <button type="button" className={row} onClick={() => { onClose(); onCollect(); }}>
          <FolderPlus className="h-4 w-4 text-(--ink-soft)" /> เพิ่มลงคอลเลกชัน
        </button>
        {item.body && (
          <button
            type="button"
            className={row}
            onClick={() => {
              navigator.clipboard?.writeText(item.body ?? "").then(
                () => toast.success("คัดลอกแล้ว"),
                () => toast.error("คัดลอกไม่สำเร็จ")
              );
              onClose();
            }}
          >
            <Copy className="h-4 w-4 text-(--ink-soft)" /> คัดลอก
          </button>
        )}
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className={row} onClick={onClose}>
            <ExternalLink className="h-4 w-4 text-(--ink-soft)" /> เปิดลิงก์
          </a>
        )}
        {item.attachment && (
          <a href={downloadUrl(item.attachment)} className={row} onClick={onClose}>
            <Download className="h-4 w-4 text-(--ink-soft)" /> บันทึกลงเครื่อง
          </a>
        )}
        {confirm ? (
          <button type="button" className={cn(row, "font-medium text-(--danger)")} onClick={() => { onClose(); onDelete(); }}>
            <Trash2 className="h-4 w-4" /> กดอีกครั้งเพื่อยืนยันลบ
          </button>
        ) : (
          <button type="button" className={cn(row, "text-(--danger)")} onClick={() => setConfirm(true)}>
            <Trash2 className="h-4 w-4" /> ลบออกจาก Keep
          </button>
        )}
        <button type="button" className={cn(row, "justify-center sm:hidden")} onClick={onClose}>
          <X className="h-4 w-4 text-(--ink-soft)" /> ปิด
        </button>
      </div>
    </div>,
    document.body
  );
}

/** ส่งของใน Keep เข้าห้องแชท — ใช้ไฟล์เดิม (ไม่อัปโหลดซ้ำ) */
function ForwardPicker({
  item,
  meId,
  users,
  onClose,
}: {
  item: ChatKeepItemDTO;
  meId: string;
  users: Record<string, import("../types").ChatUser>;
  onClose: () => void;
}) {
  const channels = useChatStore((s) => s.channels);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const list = channels.filter((c) => !isKeepChannelId(c.id) && channelTitle(c, meId, users).toLowerCase().includes(query.trim().toLowerCase()));
  const forward = async (channelId: string) => {
    setSending(channelId);
    try {
      await sendMessage(channelId, {
        body: item.attachment ? undefined : (item.body ?? undefined),
        attachments: item.attachment ? [item.attachment] : undefined,
        clientId: `keep-${crypto.randomUUID()}`,
      });
      toast.success("ส่งแล้ว");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งไม่สำเร็จ");
    } finally {
      setSending(null);
    }
  };
  return (
    <ChatModal title="ส่งต่อไปที่" onClose={onClose} layer="top">
      <div className="px-3 pt-3">
        <input
          id="keep-forward-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาห้อง"
          className="w-full rounded-xl bg-(--bg-soft) px-3 py-2 text-base text-(--ink) focus:outline-none sm:text-sm"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={sending !== null}
            onClick={() => void forward(c.id)}
            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-(--bg-soft) disabled:opacity-50"
          >
            <ChannelAvatar channel={c} meId={meId} users={users} size="h-10 w-10" />
            <span className="min-w-0 flex-1 truncate text-sm text-(--ink)">{channelTitle(c, meId, users)}</span>
            {sending === c.id && <Loader2 className="h-4 w-4 animate-spin text-(--ink-soft)" />}
          </button>
        ))}
      </div>
    </ChatModal>
  );
}

function CollectionPicker({
  item,
  collections,
  onClose,
  onSaved,
}: {
  item: ChatKeepItemDTO;
  collections: ChatKeepCollectionDTO[];
  onClose: () => void;
  onSaved: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(item.collectionIds));
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [list, setList] = useState(collections);
  const save = async () => {
    setSaving(true);
    try {
      const { collectionIds } = await setKeepItemCollections(item.id, [...picked]);
      onSaved(collectionIds);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };
  return (
    <ChatModal
      title="เพิ่มลงคอลเลกชัน"
      onClose={onClose}
      layer="top"
      footer={
        <button type="button" disabled={saving} onClick={() => void save()} className="w-full rounded-xl bg-[#1fa463] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {list.length === 0 && <p className="px-4 py-3 text-sm text-(--ink-soft)">ยังไม่มีคอลเลกชัน สร้างใหม่ด้านล่างได้เลย</p>}
        {list.map((c) => {
          const on = picked.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (on) n.delete(c.id);
                  else n.add(c.id);
                  return n;
                })
              }
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-(--bg-soft)"
            >
              <span className={cn("flex h-5 w-5 items-center justify-center rounded border", on ? "border-[#1fa463] bg-[#1fa463] text-white" : "border-(--line)")}>
                {on && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="flex-1 text-sm text-(--ink)">{c.name}</span>
              <span className="text-[12px] text-(--ink-soft)">{c.count}</span>
            </button>
          );
        })}
        <form
          className="flex gap-2 px-4 pt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            try {
              const c = await createKeepCollection(name.trim());
              setList((l) => [...l, c]);
              setPicked((s) => new Set(s).add(c.id));
              setName("");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "สร้างไม่สำเร็จ");
            }
          }}
        >
          <input
            id="keep-new-collection"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            placeholder="ชื่อคอลเลกชันใหม่"
            className="min-w-0 flex-1 rounded-lg bg-(--bg-soft) px-3 py-2 text-base text-(--ink) focus:outline-none sm:text-sm"
          />
          <button type="submit" className="rounded-lg border border-(--line) px-3 text-sm text-(--ink)">
            สร้าง
          </button>
        </form>
      </div>
    </ChatModal>
  );
}

function NameDialog({
  title,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ChatModal
      title={title}
      onClose={onClose}
      layer="top"
      footer={
        <div className="flex gap-2">
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => (confirmDelete ? void run(onDelete) : setConfirmDelete(true))}
              className="rounded-xl border border-(--line) px-3 py-2.5 text-sm text-(--danger)"
            >
              {confirmDelete ? "กดอีกครั้งเพื่อลบ" : "ลบคอลเลกชัน"}
            </button>
          )}
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void run(() => onSave(name.trim()))}
            className="flex-1 rounded-xl bg-[#1fa463] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            บันทึก
          </button>
        </div>
      }
    >
      <div className="p-4">
        <input
          id="keep-collection-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="เช่น บ้าน A1, ใบเสนอราคา"
          className="w-full rounded-xl bg-(--bg-soft) px-3 py-2.5 text-base text-(--ink) focus:outline-none sm:text-sm"
        />
      </div>
    </ChatModal>
  );
}
