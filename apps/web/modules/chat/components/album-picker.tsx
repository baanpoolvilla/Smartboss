"use client";

import { useEffect, useState } from "react";
import { Images, Plus } from "lucide-react";
import { toast } from "sonner";

import * as api from "../lib/api";
import type { ChatAlbumDTO } from "../types";
import { ChatModal } from "./new-chat-dialog";

/**
 * เลือกอัลบั้มที่จะบันทึกรูปลงไป (หรือสร้างใหม่) — เปิดจากปุ่ม "บันทึกลงอัลบั้ม" ตอนดูรูปเต็มจอ
 * รูปในอัลบั้มไม่หมดอายุ (lib/retention.ts) · วาดชั้นบนสุด ทับหน้าดูรูปเต็มจอได้
 */
export function AlbumPicker({
  channelId,
  items,
  onClose,
}: {
  channelId: string;
  items: api.AlbumItemInput[];
  onClose: () => void;
}) {
  const [albums, setAlbums] = useState<ChatAlbumDTO[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function saveTo(albumId: string, albumName: string) {
    setBusy(true);
    try {
      await api.addAlbumItems(albumId, items);
      toast.success(`บันทึกลงอัลบั้ม "${albumName}" แล้ว — ไม่หมดอายุ`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }

  async function createAndSave() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const { id } = await api.createAlbum(channelId, name);
      await saveTo(id, name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างอัลบั้มไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <ChatModal title={`บันทึก ${items.length > 1 ? `${items.length} รายการ` : ""}ลงอัลบั้ม`} onClose={onClose} layer="top">
      <div className="p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createAndSave();
          }}
        >
          <input
            id="album-picker-new"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={100}
            placeholder="ชื่ออัลบั้มใหม่ เช่น หน้างาน BS-M1 ต.ค."
            className="min-w-0 flex-1 rounded-xl border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--chat-accent) focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-(--chat-accent) px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> สร้าง
          </button>
        </form>
      </div>
      <div className="border-t border-(--line) py-1">
        {!albums && <p className="py-8 text-center text-sm text-(--ink-soft)">กำลังโหลด…</p>}
        {albums?.length === 0 && <p className="py-8 text-center text-sm text-(--ink-soft)">ห้องนี้ยังไม่มีอัลบั้ม — ตั้งชื่อด้านบนเพื่อสร้าง</p>}
        {albums?.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            onClick={() => void saveTo(a.id, a.name)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-(--bg-soft) disabled:opacity-50"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-(--bg-soft) text-(--ink-soft)">
              {a.cover?.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.cover.thumbUrl ?? a.cover.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <Images className="h-5 w-5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-(--ink)">{a.name}</span>
              <span className="text-[11.5px] text-(--ink-soft)">{a.itemCount} รายการ</span>
            </span>
          </button>
        ))}
      </div>
    </ChatModal>
  );
}
