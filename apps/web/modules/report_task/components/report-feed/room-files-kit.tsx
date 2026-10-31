"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Building2,
  Camera,
  Check,
  Download,
  FolderHeart,
  FolderPlus,
  ImagePlus,
  Images,
  MessageSquareText,
  MoreHorizontal,
  Upload,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/modules/report_task/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { ReportMediaThumb } from "@/modules/report_task/components/report-feed/report-media-thumb";
import { listRoomLibrary, type RoomLibraryFile } from "@/modules/company-files/data/files";
import { cn } from "@/modules/report_task/lib/utils";
import type { ReportAlbum, ReportPostImage } from "@/modules/report_task/store/report-feed-store";

/**
 * ชิ้นส่วนของแท็บ "ไฟล์"/"อัลบั้ม" ในห้องรายงาน (ผู้ใช้ 31/10/2569 "งง กดแล้วเด้งไปไฟล์บริษัท · จะเพิ่มรูปในอัลบั้มไม่ได้")
 * ทุกรูปบอกที่เก็บเป็นป้าย (7 วัน / 📂 อัลบั้ม / 🏢 ไฟล์บริษัท) · ปุ่ม ⋯ ที่มีชื่อเมนูแทนไอคอน 2 อันที่ดูไม่ออก
 * · อัปโหลดเลือกปลายทางได้ · อัลบั้มเพิ่มรูปเองได้ — mockup: claude.ai/artifact/Rk7FCAThCpzkRFy6rdF3D3
 */

/** ไฟล์ทุกไฟล์ของห้องในไฟล์บริษัท (รวมโฟลเดอร์ย่อย) — ใช้ขึ้นป้าย 🏢 และโชว์ไฟล์ที่อัปโหลดเอง */
export function useRoomLibrary(topicId: string) {
  // ผูกผลกับห้องที่ขอ แทนการยกเลิกใน cleanup — ตอน dev ที่ effect รันสองรอบ ผลชุดแรกถูกทิ้ง ชุดที่สองไม่กลับมา ปุ่มไฟล์บริษัทเลยไม่ขึ้น
  const [state, setState] = useState<{ topicId: string; canAccess: boolean; canUpload: boolean; files: RoomLibraryFile[] } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await listRoomLibrary(topicId);
      setState({ topicId, ...r });
    } catch {
      // อ่านไม่ได้ = ไม่มีส่วนไฟล์บริษัท แท็บไฟล์ยังใช้ได้ตามปกติ
    }
  }, [topicId]);
  useEffect(() => {
    listRoomLibrary(topicId)
      .then((r) => setState({ topicId, ...r }))
      .catch(() => {});
  }, [topicId]);
  const mine = state?.topicId === topicId ? state : null;
  return { loaded: !!mine, canAccess: mine?.canAccess ?? false, canUpload: mine?.canUpload ?? false, files: mine?.files ?? EMPTY_LIBRARY, refresh };
}

const EMPTY_LIBRARY: RoomLibraryFile[] = [];

export const urlOf = (m: { url?: string; dataUrl?: string }) => m.url ?? m.dataUrl ?? "";

/** ป้ายใต้รูป — บอกว่าเก็บอยู่ที่ไหน ไม่ต้องเดาจากไอคอน */
export function StorageBadges({
  albums,
  inLibrary,
  temporaryDays,
}: {
  albums: ReportAlbum[];
  inLibrary: boolean;
  /** รูปจากโพสต์ที่ยังไม่ได้เก็บที่ไหน — แท็บไฟล์โชว์แค่ช่วงนี้ · undefined = ไม่ใช่รูปจากโพสต์ */
  temporaryDays?: number;
}) {
  const none = albums.length === 0 && !inLibrary;
  if (none && temporaryDays === undefined) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {albums.map((a) => (
        <span key={a.id} className="inline-flex max-w-full items-center gap-0.5 truncate rounded bg-violet-100 px-1.5 text-[10.5px] font-semibold leading-[18px] text-violet-700">
          <FolderHeart className="h-3 w-3 shrink-0" />
          <span className="truncate">{a.name}</span>
        </span>
      ))}
      {inLibrary && (
        <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 text-[10.5px] font-semibold leading-[18px] text-sky-700">
          <Building2 className="h-3 w-3" />
          ไฟล์บริษัท
        </span>
      )}
      {none && temporaryDays !== undefined && (
        <span
          className="rounded bg-amber-100 px-1.5 text-[10.5px] font-semibold leading-[18px] text-amber-800"
          title={`ยังไม่ได้เก็บ — แท็บไฟล์โชว์รูปจากโพสต์แค่ ${temporaryDays} วัน (รูปยังอยู่ในโพสต์)`}
        >
          {temporaryDays >= 3650 ? "ยังไม่เก็บ" : `${temporaryDays} วัน`}
        </span>
      )}
    </div>
  );
}

/** ปุ่ม ⋯ ของรูป/ไฟล์ — ทุกเมนูบอกปลายทางชัด */
export function RoomFileMenu({
  name,
  url,
  roomName,
  roomAlbums,
  inAlbumIds,
  libraryFile,
  canSaveToLibrary,
  onToggleAlbum,
  onNewAlbum,
  onSaveToLibrary,
  onOpenPost,
  onRemoveFromThisAlbum,
  variant = "overlay",
}: {
  name: string;
  url: string;
  roomName: string;
  roomAlbums: ReportAlbum[];
  inAlbumIds: string[];
  libraryFile?: RoomLibraryFile;
  canSaveToLibrary: boolean;
  onToggleAlbum: (albumId: string) => void;
  onNewAlbum: () => void;
  onSaveToLibrary: () => void;
  onOpenPost?: () => void;
  /** อยู่ในหน้าอัลบั้ม — ให้มีเมนูเอาออกจากอัลบั้มนี้ */
  onRemoveFromThisAlbum?: () => void;
  variant?: "overlay" | "row";
}) {
  const inAlbums = roomAlbums.filter((a) => inAlbumIds.includes(a.id));
  const status = [inAlbums.length ? `อัลบั้ม ${inAlbums.map((a) => a.name).join(", ")}` : null, libraryFile ? "ไฟล์บริษัท" : null].filter(Boolean).join(" · ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            aria-label={`ตัวเลือกของ ${name}`}
            title="เก็บลงอัลบั้ม / เก็บเข้าไฟล์บริษัท / ดาวน์โหลด"
            className={cn(
              "flex items-center justify-center rounded-full transition-colors",
              variant === "overlay" ? "h-6 w-7 bg-black/55 text-white hover:bg-black/75" : "h-8 w-8 text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-72" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-[var(--ink-soft)]">
            <span className="block font-semibold text-[var(--ink)] truncate">{name}</span>
            เก็บอยู่ที่: {status || "ยังไม่ได้เก็บ"}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderHeart className="h-3.5 w-3.5" />
            เก็บลงอัลบั้ม…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            {roomAlbums.map((a) => (
              <DropdownMenuItem key={a.id} onClick={() => onToggleAlbum(a.id)}>
                {inAlbumIds.includes(a.id) ? <Check className="h-3.5 w-3.5 text-[var(--brand-green-dark)]" /> : <span className="w-3.5" />}
                <span className="truncate">{a.name}</span>
              </DropdownMenuItem>
            ))}
            {roomAlbums.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={onNewAlbum}>
              <FolderPlus className="h-3.5 w-3.5" />
              สร้างอัลบั้มใหม่…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {onRemoveFromThisAlbum && (
          <DropdownMenuItem onClick={onRemoveFromThisAlbum}>
            <X className="h-3.5 w-3.5" />
            เอาออกจากอัลบั้มนี้
          </DropdownMenuItem>
        )}
        {libraryFile ? (
          <DropdownMenuItem render={<Link href={`/company-files/file/${libraryFile.id}`} />}>
            <Building2 className="h-3.5 w-3.5" />
            <span className="flex flex-col">
              เปิดในไฟล์บริษัท
              <span className="text-[11px] text-[var(--ink-soft)]">เวอร์ชัน · ลิงก์แชร์ · ย้าย</span>
            </span>
          </DropdownMenuItem>
        ) : (
          canSaveToLibrary && (
            <DropdownMenuItem onClick={onSaveToLibrary}>
              <Building2 className="h-3.5 w-3.5" />
              <span className="flex min-w-0 flex-col">
                เก็บเข้าไฟล์บริษัท
                <span className="truncate text-[11px] text-[var(--ink-soft)]">ไฟล์บริษัท › ห้องรายงาน › {roomName}</span>
              </span>
            </DropdownMenuItem>
          )
        )}
        <DropdownMenuSeparator />
        {url && (
          <DropdownMenuItem render={<a href={url} download={name} />}>
            <Download className="h-3.5 w-3.5" />
            ดาวน์โหลด
          </DropdownMenuItem>
        )}
        {onOpenPost && (
          <DropdownMenuItem onClick={onOpenPost}>
            <MessageSquareText className="h-3.5 w-3.5" />
            ไปที่โพสต์ต้นทาง
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** กล่อง "เก็บอยู่ที่" ในตัวดูรูป */
export function WhereStoredPanel({
  name,
  albums,
  libraryFile,
  postTitle,
  onOpenPost,
  canSaveToLibrary,
  onSaveToLibrary,
}: {
  name: string;
  albums: ReportAlbum[];
  libraryFile?: RoomLibraryFile;
  postTitle?: string;
  onOpenPost?: () => void;
  canSaveToLibrary: boolean;
  onSaveToLibrary: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <p className="truncate text-sm font-semibold">{name}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">เก็บอยู่ที่</p>
      <p className="flex items-center gap-1.5">
        <Building2 className="h-3.5 w-3.5 shrink-0 text-sky-300" />
        {libraryFile ? (
          <>
            ไฟล์บริษัท{libraryFile.folderName ? ` › ${libraryFile.folderName}` : ""} ·
            <Link href={`/company-files/file/${libraryFile.id}`} className="underline">เปิดในไฟล์บริษัท</Link>
          </>
        ) : canSaveToLibrary ? (
          <>
            ยังไม่อยู่ในไฟล์บริษัท ·
            <button type="button" onClick={onSaveToLibrary} className="underline">เก็บเข้าไฟล์บริษัท</button>
          </>
        ) : (
          "ยังไม่อยู่ในไฟล์บริษัท"
        )}
      </p>
      <p className="flex items-center gap-1.5">
        <FolderHeart className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        {albums.length ? `อัลบั้ม ${albums.map((a) => a.name).join(", ")}` : "ยังไม่อยู่ในอัลบั้ม — กด ⋯ ที่รูปในแท็บไฟล์เพื่อเก็บ"}
      </p>
      {postTitle !== undefined && (
        <p className="flex items-center gap-1.5">
          <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-white/70" />
          <span className="truncate">โพสต์ “{postTitle}”</span>
          {onOpenPost && (
            <button type="button" onClick={onOpenPost} className="shrink-0 underline">ไปที่โพสต์</button>
          )}
        </p>
      )}
    </div>
  );
}

/** ช่องเลือกไฟล์ซ่อน — ปุ่มไหนก็เรียกเปิดได้ และ PasteDropFiles ข้างนอกส่งไฟล์ที่ลาก/วางเข้ามาทางนี้ */
function HiddenPicker({
  inputRef,
  accept,
  capture,
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept?: string;
  capture?: boolean;
  onFiles: (files: File[]) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      multiple={!capture}
      accept={accept}
      {...(capture ? { capture: "environment" as const } : {})}
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length) onFiles(files);
      }}
    />
  );
}

/** ปุ่ม "อัปโหลดไฟล์" บนแถวค้นหา — เลือกปลายทาง: ไฟล์บริษัทของห้อง หรืออัลบั้ม */
export function RoomUploadButton({
  roomName,
  canUploadToLibrary,
  albums,
  busy,
  onUploadToLibrary,
  onUploadToAlbum,
  onNewAlbum,
}: {
  roomName: string;
  canUploadToLibrary: boolean;
  albums: ReportAlbum[];
  busy: boolean;
  onUploadToLibrary: (files: File[]) => void;
  onUploadToAlbum: (albumId: string, files: File[]) => void;
  onNewAlbum: () => void;
}) {
  const libRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const targetAlbum = useRef<string | null>(null);
  return (
    <>
      {/* ช่องไฟล์บริษัทมาก่อน — ลากไฟล์มาวางในแท็บไฟล์ = เข้าไฟล์บริษัทของห้อง (เหมือนกล่องเดิม) */}
      {canUploadToLibrary && <HiddenPicker inputRef={libRef} onFiles={onUploadToLibrary} />}
      <input
        ref={albumRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length && targetAlbum.current) onUploadToAlbum(targetAlbum.current, files);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={busy}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--brand-green-dark)] hover:text-white disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {busy ? "กำลังอัปโหลด..." : "อัปโหลดไฟล์"}
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-[var(--ink-soft)]">อัปโหลดไปที่ไหน</DropdownMenuLabel>
          </DropdownMenuGroup>
          {canUploadToLibrary && (
            <DropdownMenuItem onClick={() => libRef.current?.click()}>
              <Building2 className="h-3.5 w-3.5" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">ไฟล์บริษัท › {roomName}</span>
                <span className="text-[11px] text-[var(--ink-soft)]">ไฟล์ทุกชนิด เก็บถาวร มีเวอร์ชันและลิงก์แชร์</span>
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderHeart className="h-3.5 w-3.5" />
              <span className="flex flex-col">
                อัลบั้มในห้องนี้…
                <span className="text-[11px] text-[var(--ink-soft)]">รูปและวิดีโอ</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              {albums.map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  onClick={() => {
                    targetAlbum.current = a.id;
                    albumRef.current?.click();
                  }}
                >
                  <FolderHeart className="h-3.5 w-3.5" />
                  <span className="truncate">{a.name}</span>
                </DropdownMenuItem>
              ))}
              {albums.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={onNewAlbum}>
                <FolderPlus className="h-3.5 w-3.5" />
                สร้างอัลบั้มใหม่…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export interface PickableMedia {
  key: string;
  media: ReportPostImage;
  /** ชื่ออัลบั้มที่อยู่ตอนนี้ (ถ้ามี) */
  albumName?: string;
}

/** ปุ่ม "เพิ่มรูป" ในหน้าอัลบั้ม — อัปโหลดจากเครื่อง / ถ่ายรูป / เลือกจากรูปในห้อง */
export function AlbumAddPhotos({
  busy,
  onUpload,
  candidates,
  onPick,
}: {
  busy: boolean;
  onUpload: (files: File[]) => void;
  candidates: PickableMedia[];
  onPick: (keys: string[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <>
      <HiddenPicker inputRef={fileRef} accept="image/*,video/*" onFiles={onUpload} />
      <HiddenPicker inputRef={camRef} accept="image/*" capture onFiles={onUpload} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--brand-green-dark)] hover:text-white disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {busy ? "กำลังอัปโหลด..." : "เพิ่มรูป"}
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            <span className="flex flex-col">
              อัปโหลดจากเครื่อง
              <span className="text-[11px] text-[var(--ink-soft)]">เลือกได้หลายรูป รูปหรือวิดีโอ</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => camRef.current?.click()} className="sm:hidden">
            <Camera className="h-3.5 w-3.5" />
            ถ่ายรูป
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setSelected(new Set());
              setPickOpen(true);
            }}
          >
            <Images className="h-3.5 w-3.5" />
            <span className="flex flex-col">
              เลือกจากรูปในห้องนี้
              <span className="text-[11px] text-[var(--ink-soft)]">รูปจากโพสต์ และไฟล์บริษัทของห้อง</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>เลือกรูปในห้องนี้</DialogTitle>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--ink-soft)]">ยังไม่มีรูปในห้องนี้ที่ยังไม่อยู่ในอัลบั้มนี้</p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
              {candidates.map((c) => {
                const on = selected.has(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (on) n.delete(c.key);
                        else n.add(c.key);
                        return n;
                      })
                    }
                    className={cn("relative overflow-hidden rounded-lg text-left", on && "ring-3 ring-[var(--brand-green)]")}
                  >
                    <ReportMediaThumb media={c.media} className="h-24 w-full object-cover" />
                    {on && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-green)] text-white">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {c.albumName && (
                      <span className="absolute bottom-1 left-1 max-w-[90%] truncate rounded bg-black/60 px-1 text-[10px] text-white">ตอนนี้อยู่ใน {c.albumName}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-[var(--ink-soft)]">เลือกแล้ว {selected.size} รูป</span>
            <button type="button" onClick={() => setPickOpen(false)} className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs">
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => {
                onPick([...selected]);
                setPickOpen(false);
              }}
              className="rounded-full bg-[var(--brand-green)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] disabled:opacity-50"
            >
              เพิ่ม {selected.size || ""} รูปเข้าอัลบั้ม
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
