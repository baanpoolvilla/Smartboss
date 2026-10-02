"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, Images, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import * as api from "../lib/api";
import type { ChatAlbumDTO, ChatAlbumItemDTO, ChatAttachment } from "../types";
import { uploadChatMedia } from "./composer";
import { PasteDropFiles } from "@/components/annotate/paste-drop-files";

/**
 * แท็บ "อัลบั้ม" ในข้อมูลห้อง — ที่เก็บรูป/วิดีโอถาวรของห้อง (ในแชทหมดอายุ ดู lib/retention.ts)
 * รายการอัลบั้ม → กดเข้าไปดูรูป, เพิ่มรูปจากเครื่อง, เอารูปออก (คนเพิ่ม/แอดมินห้อง)
 */
export function AlbumsTab({
  channelId,
  onOpenMedia,
}: {
  channelId: string;
  onOpenMedia: (items: ChatAttachment[], i: number) => void;
}) {
  const [albums, setAlbums] = useState<ChatAlbumDTO[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const reload = useCallback(() => {
    api
      .fetchAlbums(channelId)
      .then((r) => setAlbums(r.albums))
      .catch(() => setAlbums([]));
  }, [channelId]);

  useEffect(() => {
    let cancelled = false;
    api
      .fetchAlbums(channelId)
      .then((r) => !cancelled && setAlbums(r.albums))
      .catch(() => !cancelled && setAlbums([]));
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  if (openId) {
    return (
      <AlbumView
        albumId={openId}
        onBack={() => {
          setOpenId(null);
          reload();
        }}
        onOpenMedia={onOpenMedia}
      />
    );
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      const { id } = await api.createAlbum(channelId, name);
      setNewName("");
      setCreating(false);
      setOpenId(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างอัลบั้มไม่สำเร็จ");
    }
  }

  return (
    <div className="p-3">
      <p className="mb-3 rounded-lg bg-(--bg-soft) px-3 py-2 text-[12px] text-(--ink-soft)">
        รูป/วิดีโอในแชทเปิดดูได้ 30 วัน — อยากเก็บไว้ถาวร บันทึกลงอัลบั้ม (กดดูรูป แล้วกด &ldquo;บันทึกลงอัลบั้ม&rdquo;)
      </p>
      {creating ? (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            id="albums-tab-new"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={100}
            placeholder="ชื่ออัลบั้ม"
            className="min-w-0 flex-1 rounded-xl border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--chat-accent) focus-visible:outline-none"
          />
          <button type="submit" disabled={!newName.trim()} className="rounded-xl bg-(--chat-accent) px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            สร้าง
          </button>
          <button type="button" onClick={() => setCreating(false)} className="rounded-xl px-2 text-(--ink-soft)" aria-label="ยกเลิก">
            <X className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-(--line) py-2.5 text-sm font-medium text-(--chat-accent-strong) hover:bg-(--bg-soft)"
        >
          <Plus className="h-4 w-4" /> สร้างอัลบั้ม
        </button>
      )}

      {!albums && <p className="py-8 text-center text-sm text-(--ink-soft)">กำลังโหลด…</p>}
      {albums?.length === 0 && <p className="py-8 text-center text-sm text-(--ink-soft)">ยังไม่มีอัลบั้ม</p>}
      <div className="grid grid-cols-2 gap-3">
        {albums?.map((a) => (
          <button key={a.id} type="button" onClick={() => setOpenId(a.id)} className="text-left">
            <span className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-(--bg-soft) text-(--ink-soft)">
              {a.cover?.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.cover.thumbUrl ?? a.cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : a.cover?.kind === "video" ? (
                <video src={`${a.cover.url}#t=0.1`} preload="metadata" muted className="h-full w-full object-cover" />
              ) : (
                <Images className="h-8 w-8" />
              )}
            </span>
            <span className="mt-1.5 block truncate text-sm font-medium text-(--ink)">{a.name}</span>
            <span className="text-[11.5px] text-(--ink-soft)">{a.itemCount} รายการ</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function toAttachment(i: ChatAlbumItemDTO): ChatAttachment {
  return {
    url: i.url,
    name: i.name,
    mime: i.mime,
    size: 0,
    kind: i.kind,
    ...(i.thumbUrl ? { thumbUrl: i.thumbUrl } : {}),
    ...(i.width && i.height ? { width: i.width, height: i.height } : {}),
  };
}

function AlbumView({
  albumId,
  onBack,
  onOpenMedia,
}: {
  albumId: string;
  onBack: () => void;
  onOpenMedia: (items: ChatAttachment[], i: number) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.fetchAlbum>> | null>(null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .fetchAlbum(albumId)
      .then(setData)
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "โหลดอัลบั้มไม่สำเร็จ");
        onBack();
      });
  }, [albumId, onBack]);

  useEffect(() => {
    let cancelled = false;
    api
      .fetchAlbum(albumId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && onBack());
    return () => {
      cancelled = true;
    };
  }, [albumId, onBack]);

  async function addFiles(files: File[]) {
    const media = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (media.length === 0) return toast.error("เลือกรูปหรือวิดีโอ");
    setUploading({ done: 0, total: media.length });
    const uploaded: api.AlbumItemInput[] = [];
    for (const f of media) {
      try {
        const a = await uploadChatMedia(f, f.type.startsWith("video/") ? "video" : "image", () => {});
        uploaded.push({ url: a.url, thumbUrl: a.thumbUrl, name: a.name, width: a.width, height: a.height });
      } catch (err) {
        toast.error(`${f.name}: ${err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ"}`);
      }
      setUploading((u) => (u ? { ...u, done: u.done + 1 } : u));
    }
    try {
      if (uploaded.length > 0) await api.addAlbumItems(albumId, uploaded);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เพิ่มรูปไม่สำเร็จ");
    }
    setUploading(null);
    load();
  }

  async function remove(item: ChatAlbumItemDTO) {
    try {
      await api.removeAlbumItem(albumId, item.id);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== item.id) } : d));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เอาออกไม่สำเร็จ");
    }
  }

  if (!data) return <p className="py-10 text-center text-sm text-(--ink-soft)">กำลังโหลด…</p>;
  const items = data.items;
  const attachments = items.map(toAttachment);
  const anyRemovable = items.some((i) => i.canRemove);

  return (
    <PasteDropFiles label="ปล่อยเพื่อเพิ่มรูป/วิดีโอลงอัลบั้ม">
    <div>
      <div className="flex items-center gap-1 border-b border-(--line) px-2 py-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label="กลับ">
          <ArrowLeft className="h-5 w-5" />
        </button>
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void api
                .renameAlbum(albumId, name.trim())
                .then(() => {
                  setRenaming(false);
                  load();
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "เปลี่ยนชื่อไม่สำเร็จ"));
            }}
          >
            <input
              id="album-rename"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="min-w-0 flex-1 rounded-lg border border-(--line) px-2 py-1 text-sm text-(--ink) focus-visible:border-(--chat-accent) focus-visible:outline-none"
            />
            <button type="submit" className="rounded-lg bg-(--chat-accent) px-2 text-xs font-semibold text-white">
              บันทึก
            </button>
          </form>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-(--ink)">
            {data.album.name} <span className="font-normal text-(--ink-soft)">· {items.length}</span>
          </span>
        )}
        {data.canManage && !renaming && (
          <>
            <button
              type="button"
              onClick={() => {
                setName(data.album.name);
                setRenaming(true);
              }}
              className="rounded-full p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)"
              aria-label="เปลี่ยนชื่ออัลบั้ม"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-full p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label="ลบอัลบั้ม">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {confirmDelete && (
        <div className="m-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
          <p className="text-(--ink)">ลบอัลบั้ม &ldquo;{data.album.name}&rdquo;?</p>
          <p className="mt-1 text-[12px] text-(--ink-soft)">รูปที่มาจากแชทจะกลับไปหมดอายุตามปกติ รูปที่อัปโหลดเข้าอัลบั้มโดยตรงจะถูกลบ</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-1.5 text-(--ink-soft)">
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() =>
                void api
                  .deleteAlbum(albumId)
                  .then(onBack)
                  .catch((err) => toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ"))
              }
              className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white"
            >
              ลบอัลบั้ม
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 p-3">
        <button
          type="button"
          disabled={!!uploading}
          onClick={() => fileRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-(--chat-accent) py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          <ImagePlus className="h-4 w-4" />
          {uploading ? `กำลังอัปโหลด ${uploading.done}/${uploading.total}` : "เพิ่มรูป/วิดีโอ"}
        </button>
        {anyRemovable && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={cn("rounded-xl border px-3 text-sm", editing ? "border-(--chat-accent) text-(--chat-accent-strong)" : "border-(--line) text-(--ink-soft)")}
          >
            {editing ? "เสร็จ" : "เลือกลบ"}
          </button>
        )}
        <input
          ref={fileRef}
          id="album-add-files"
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 0) void addFiles(files);
          }}
        />
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-(--ink-soft)">ยังไม่มีรูปในอัลบั้มนี้</p>
      ) : (
        <div className="grid grid-cols-3 gap-0.5 p-0.5">
          {items.map((it, i) => (
            <div key={it.id} className="relative aspect-square bg-(--bg-soft)">
              <button type="button" onClick={() => !editing && onOpenMedia(attachments, i)} className="h-full w-full" aria-label="ดูรูปเต็ม">
                {it.kind === "video" ? (
                  <>
                    <video src={`${it.url}#t=0.1`} preload="metadata" muted className="h-full w-full object-cover" />
                    <Play className="absolute inset-0 m-auto h-6 w-6 text-white drop-shadow" fill="currentColor" />
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumbUrl ?? it.url} alt={it.name} loading="lazy" className="h-full w-full object-cover" />
                )}
              </button>
              {editing && it.canRemove && (
                <button
                  type="button"
                  onClick={() => void remove(it)}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
                  aria-label="เอาออกจากอัลบั้ม"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </PasteDropFiles>
  );
}
