"use client";

import { ChevronRight, Images, Play } from "lucide-react";
import { cn } from "@smartboss/ui/cn";

import type { ChatAlbumCard, ChatMessageDTO } from "../types";

/**
 * การ์ดอัลบั้มในห้อง (ChatMessage kind "album") แบบ LINE — รูปเรียงเป็นตาราง · ชื่ออัลบั้ม ·
 * "เนื้อหา N รายการถูกเพิ่มในอัลบั้ม" · แถบ "อัลบั้ม >" กดแล้วเปิดอัลบั้มนั้นในข้อมูลห้อง (ผู้ใช้ขอ 21/10/2569)
 */

/** ขอเปิดอัลบั้มจากการ์ด — ห้องแชท (chat-room.tsx) เปิดแผงข้อมูลห้องที่แท็บอัลบั้มให้ */
export const OPEN_ALBUM_EVENT = "chat:open-album";
export type OpenAlbumDetail = { channelId: string; albumId: string };

export function openAlbum(channelId: string, albumId: string) {
  window.dispatchEvent(new CustomEvent<OpenAlbumDetail>(OPEN_ALBUM_EVENT, { detail: { channelId, albumId } }));
}

function Tile({ item, className, more }: { item: ChatAlbumCard["items"][number]; className?: string; more?: number }) {
  return (
    <span className={cn("relative block overflow-hidden bg-(--bg-soft)", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
      {item.kind === "video" && !more && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white">
            <Play className="h-4 w-4 fill-current" />
          </span>
        </span>
      )}
      {!!more && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-2xl font-bold text-white">+{more}</span>
      )}
    </span>
  );
}

/** ตารางรูปตามจำนวน — 1 เต็ม · 2 แบ่งครึ่ง · 3 ใหญ่ซ้าย+สองขวา · 4 ตาราง 2×2 · 5+ บน 2 ล่าง 3 (ช่องสุดท้าย +N) */
function Mosaic({ album }: { album: ChatAlbumCard }) {
  const it = album.items;
  const n = it.length;
  if (n === 0) return null;
  if (n === 1) return <Tile item={it[0]!} className="h-48 border-b border-(--line)" />;
  if (n === 2)
    return (
      <div className="grid h-40 grid-cols-2 gap-0.5 bg-(--line)">
        <Tile item={it[0]!} />
        <Tile item={it[1]!} />
      </div>
    );
  if (n === 3)
    return (
      <div className="grid h-48 grid-cols-2 grid-rows-2 gap-0.5 bg-(--line)">
        <Tile item={it[0]!} className="row-span-2" />
        <Tile item={it[1]!} />
        <Tile item={it[2]!} />
      </div>
    );
  if (n === 4)
    return (
      <div className="grid h-48 grid-cols-2 grid-rows-2 gap-0.5 bg-(--line)">
        {it.map((x, i) => (
          <Tile key={i} item={x} />
        ))}
      </div>
    );
  const more = album.count - 5;
  return (
    <div className="flex flex-col gap-0.5 bg-(--line)">
      <div className="grid h-28 grid-cols-2 gap-0.5 bg-(--line)">
        <Tile item={it[0]!} />
        <Tile item={it[1]!} />
      </div>
      <div className="grid h-20 grid-cols-3 gap-0.5 bg-(--line)">
        <Tile item={it[2]!} />
        <Tile item={it[3]!} />
        <Tile item={it[4]!} more={more > 0 ? more : undefined} />
      </div>
    </div>
  );
}

export function AlbumCard({ message, mine }: { message: ChatMessageDTO; mine: boolean }) {
  const album = message.album;
  return (
    <button
      type="button"
      disabled={!album}
      onClick={() => album && openAlbum(message.channelId, album.albumId)}
      className={cn(
        "w-64 max-w-[72vw] shrink-0 overflow-hidden rounded-2xl border border-(--line) bg-(--bg) text-left shadow-[0_1px_1px_rgba(0,0,0,0.06)] transition-colors hover:bg-(--bg-soft) sm:w-72",
        mine ? "rounded-tr-md" : "rounded-tl-md"
      )}
    >
      {album ? (
        <>
          <Mosaic album={album} />
          <div className="px-3 py-2.5">
            <p className="truncate text-[15px] font-semibold text-(--ink)">{album.name}</p>
            <p className="text-[12.5px] text-(--ink-soft)">
              {album.created ? `สร้างอัลบั้ม · ${album.count} รายการ` : `เนื้อหา ${album.count} รายการถูกเพิ่มในอัลบั้ม`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 border-t border-(--line) px-3 py-2 text-[12.5px] font-medium text-(--chat-accent-strong)">
            <Images className="h-4 w-4 shrink-0" />
            <span className="flex-1">อัลบั้ม</span>
            <ChevronRight className="h-4 w-4 text-(--ink-soft)" />
          </div>
        </>
      ) : (
        <p className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] text-(--ink-soft)">
          <Images className="h-4 w-4" /> อัลบั้มนี้ถูกลบแล้ว
        </p>
      )}
    </button>
  );
}
