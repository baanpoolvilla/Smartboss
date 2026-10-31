"use client";

import { useMemo, useState } from "react";
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
import { AlbumFormDialog } from "@/modules/report_task/components/report-feed/album-form-dialog";
import { ReportMediaThumb } from "@/modules/report_task/components/report-feed/report-media-thumb";
import { users, getUser, getDepartment, isOwner } from "@/modules/report_task/lib/directory";
import { useReportFeedStore, type ReportPost, type ReportPostImage, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { groupByDay } from "@/modules/report_task/lib/format";
import { ReportImageLightbox } from "@/modules/report_task/components/report-feed/report-image-lightbox";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { buildUserComplianceReports, pendingToday } from "@/modules/report_task/lib/report-feed-compliance";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { DatePresetPicker } from "@/modules/report_task/components/report-analytics/date-preset-picker";
import { presetRange, type DatePreset } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Input } from "@/modules/report_task/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import {
  AlbumAddPhotos,
  RoomFileMenu,
  RoomUploadButton,
  StorageBadges,
  WhereStoredPanel,
  urlOf,
  useRoomLibrary,
  type PickableMedia,
} from "@/modules/report_task/components/report-feed/room-files-kit";
import { addFileToRoomFolder, saveItemsToRoomSubfolder } from "@/modules/company-files/data/files";
import { uploadCompanyFile } from "@/modules/company-files/lib/upload";
import { uploadReportMedia } from "@/modules/report_task/lib/image-resize";
import { PasteDropFiles } from "@/components/annotate/paste-drop-files";
import { toast } from "sonner";
import type { ReportAlbum } from "@/modules/report_task/store/report-feed-store";
import { ReportFileChip } from "@/modules/report_task/components/report-feed/report-file-chip";
import { PinLinkDialog } from "@/modules/report_task/components/report-feed/pin-link-dialog";
import { isDocAttachment } from "@/modules/report_task/lib/report-attachment-kind";
import { TopicEmptyState } from "@/modules/report_task/components/report-feed/topic-empty-state";
import { TimeAgo } from "@/modules/report_task/components/shared/time-ago";
import Link from "next/link";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import {
  ArrowLeft,
  Building2,
  FileImage,
  FileText,
  FolderHeart,
  FolderPlus,
  LayoutGrid,
  Link2,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  Search,
  Sticker as StickerIcon,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Trophy,
  X,
} from "lucide-react";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
// "ไฟล์" is a rolling recent-photos view, not a permanent archive — anything
// worth keeping longer belongs in an album (the "อัลบั้ม" tab) instead, which
// has no such cutoff. Matches how the user described wanting this to work:
// short-lived by default, long-lived once explicitly saved.
export const FILES_TAB_WINDOW_DAYS = 7;
// A room can opt out of the rolling window entirely (room-settings-sheet.tsx's
// "ไม่จำกัด" option) for a SharePoint-style "nothing ever disappears" library
// instead — a plain number rather than Infinity so it still round-trips
// through JSON in the server-synced store.
export const UNLIMITED_FILES_RETENTION_DAYS = 36500;

interface FileEntry {
  image: ReportPostImage;
  /** "" = ไม่ได้มาจากโพสต์ (ไฟล์บริษัทของห้อง / อัปโหลดเข้าอัลบั้มตรง) */
  postId: string;
  postTitle: string;
  createdAt: string;
  authorId: string;
  /** ไม่ใส่ = มาจากโพสต์ (ของเดิมทั้งหมด) · library = ไฟล์บริษัทของห้อง · album = อัปโหลด/เลือกเข้าอัลบั้มตรง */
  source?: "library" | "album";
  /** source "album": อยู่ในอัลบั้มไหน (ใช้เอาออก) */
  albumItemOf?: string;
}

/** ตัวกรอง "ที่เก็บ" ของแท็บไฟล์ */
type StoreFilter = "all" | "none" | "album" | "library";

interface LinkEntry {
  url: string;
  postId: string;
  postTitle: string;
  createdAt: string;
}

/** The five views behind the single "ไฟล์" tab. Everything a room accumulates
 * used to be spread across three sibling tabs whose names didn't match what
 * they held ("ไฟล์" was recent photos, "รูปภาพ" was albums) — one tab with an
 * explicit filter row says what each pile actually is. */
export type FileFilter = "all" | "images" | "docs" | "links" | "albums";

const fileFilterOptions: { id: FileFilter; label: string; icon: typeof FileImage }[] = [
  { id: "all", label: "ทั้งหมด", icon: LayoutGrid },
  { id: "images", label: "รูปภาพ", icon: FileImage },
  { id: "docs", label: "เอกสาร", icon: FileText },
  { id: "links", label: "ลิงก์", icon: Link2 },
  { id: "albums", label: "อัลบั้ม", icon: FolderHeart },
];

/** The old `?tab=album` / `?tab=links` deep links (dashboard charts, copied
 * URLs, anyone's bookmarks) still name views that exist — they're just filters
 * inside "ไฟล์" now, not tabs of their own. */
export function fileFilterForLegacyTab(tab: string | null): FileFilter | null {
  if (tab === "album") return "albums";
  if (tab === "links") return "links";
  return null;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Every image attached anywhere in the room — including ones not curated
// into any album (image.albumId undefined). The "ไฟล์" tab below only ever
// shows the subset that IS in an album (LINE-style: an un-Kept chat photo
// never shows up in Keep) — this stays unfiltered so album folder counts can
// be computed from the same one pass.
export function collectFiles(posts: ReportPost[]): FileEntry[] {
  const files: FileEntry[] = [];
  for (const p of posts) {
    for (const img of p.images) {
      files.push({ image: img, postId: p.id, postTitle: p.title, createdAt: p.createdAt, authorId: p.authorId });
    }
    for (const r of p.replies) {
      for (const img of r.images ?? []) {
        files.push({ image: img, postId: p.id, postTitle: p.title, createdAt: r.createdAt, authorId: r.authorId });
      }
    }
  }
  return files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function collectLinks(posts: ReportPost[]): LinkEntry[] {
  const links: LinkEntry[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    const texts = [...p.sections.flatMap((s) => s.bullets), ...p.replies.map((r) => r.body)];
    for (const text of texts) {
      for (const url of text.match(URL_PATTERN) ?? []) {
        const key = `${p.id}:${url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ url, postId: p.id, postTitle: p.title, createdAt: p.createdAt });
      }
    }
  }
  return links.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function scrollToPost(postId: string) {
  document.getElementById(`report-post-${postId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Wrapping Date.now() in its own module-level function (rather than calling
// it directly in the component) keeps the React Compiler's purity check
// happy — it flags impure calls it can see written directly in component/hook
// bodies, not ones tucked behind an ordinary imported/local function call.
export function filesCutoffMs(windowDays: number = FILES_TAB_WINDOW_DAYS): number {
  return Date.now() - windowDays * 24 * 60 * 60 * 1000;
}

export function ReportTopicPanels({
  tab,
  topic,
  topicPosts,
  initialFileFilter,
  onOpenPost,
}: {
  tab: "files" | "stats" | "albums";
  topic: ReportTopic;
  topicPosts: ReportPost[];
  /** Which filter the "ไฟล์" tab opens on — set by a legacy `?tab=album` /
   * `?tab=links` deep link (see fileFilterForLegacyTab), "all" otherwise. */
  initialFileFilter?: FileFilter;
  /** กดชื่อโพสต์ในประวัติสติกเกอร์ — สลับไปแท็บโพสต์แล้วเลื่อนไปหาโพสต์นั้น (ลิงก์ ?post= ห้องเดิมอย่างเดียว
   * ไม่เปลี่ยนแท็บ หน้าเลยค้างอยู่ที่สรุป "กดตรงเขียวๆไม่เห็นลิ้งไป" 19/10/2569) */
  onOpenPost?: (postId: string) => void;
}) {
  // เก็บเป็น FileEntry[] ไม่ใช่ ReportPostImage[] เฉยๆ — อัลบั้ม/แท็บไฟล์รวม
  // รูปจากคนละโพสต์คนละคนไว้ในลิสต์เดียวกัน imageMeta ของ lightbox ด้านล่าง
  // เลยต้องมี authorId/createdAt ผูกกับแต่ละรูปแยกกัน ไม่ใช่ค่าเดียวทั้งชุด
  const [lightbox, setLightbox] = useState<{ items: FileEntry[]; index: number } | null>(null);
  const exemptions = useReportComplianceExemptions();
  // Own local filter, not the global report-feed one (useReportFeedFilterStore)
  // — this panel is scoped to one room's stats tab, so its date window
  // shouldn't jump around whenever some other page's filter changes.
  const [preset, setPreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = presetRange(preset, customFrom, customTo);

  const allAlbums = useReportFeedStore((s) => s.albums);
  const addAlbum = useReportFeedStore((s) => s.addAlbum);
  const renameAlbum = useReportFeedStore((s) => s.renameAlbum);
  const removeAlbum = useReportFeedStore((s) => s.removeAlbum);
  const setImageAlbum = useReportFeedStore((s) => s.setImageAlbum);
  const addAlbumItems = useReportFeedStore((s) => s.addAlbumItems);
  const removeAlbumItem = useReportFeedStore((s) => s.removeAlbumItem);
  // ไฟล์บริษัทของห้อง (รวมโฟลเดอร์ย่อย) — ป้าย 🏢 + ไฟล์ที่อัปโหลดเองขึ้นรวมในตารางเดียว (ไม่มีกล่องแยกที่กดแล้วเด้งออกแล้ว)
  const library = useRoomLibrary(topic.id);
  const [uploading, setUploading] = useState(0);
  const [fileStore, setFileStore] = useState<StoreFilter>("all");
  /** สร้างอัลบั้มจากเมนู ⋯ — สร้างเสร็จแล้วเก็บรูปนี้ลงไปเลย */
  const [newAlbumFor, setNewAlbumFor] = useState<FileEntry | null>(null);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const stickers = useStickerStore((s) => s.stickers);
  const removeStickerReaction = useReportFeedStore((s) => s.removeStickerReaction);
  // กดชื่อคนในตาราง "สถิติการโพสต์ของสมาชิก" แล้วกรองประวัติสติกเกอร์ด้านล่าง
  // ให้เหลือแค่ของคนนั้น ("กดไปของคนนั้นๆ จะแสดงมาว่าโดนหักที่ไหน") — กดซ้ำ
  // คนเดิมเพื่อยกเลิกตัวกรอง กลับไปเห็นทุกคนเหมือนเดิม
  const [stickerFilterUserId, setStickerFilterUserId] = useState<string | null>(null);
  const albums = useMemo(() => allAlbums.filter((a) => a.topicId === topic.id), [allAlbums, topic.id]);
  // null = browsing the folder list; a string = inside that one album's grid.
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false);
  const [renameAlbumOpen, setRenameAlbumOpen] = useState(false);
  const [deleteAlbumTarget, setDeleteAlbumTarget] = useState<{ id: string; name: string } | null>(null);
  // Files tab toolbar (3.5.2) — search by filename/post title + filter by
  // uploader, on top of the tab's own rolling FILES_TAB_WINDOW_DAYS window.
  // The search box sits above the filter row and applies to whichever filter
  // is showing, so there's one place to type no matter what you're looking
  // for (a filename, a link's name, an album).
  const [fileSearch, setFileSearch] = useState("");
  const [fileAuthorId, setFileAuthorId] = useState<string>("all");
  // แท็บ "อัลบั้ม" ใช้หน้าเดียวกับไฟล์ ล็อกไว้ที่อัลบั้ม · แท็บ "ไฟล์" ไม่มีตัวกรองอัลบั้มแล้ว (ย้ายไปเป็นแท็บ)
  const [fileFilter, setFileFilter] = useState<FileFilter>(tab === "albums" ? "albums" : initialFileFilter === "albums" ? "all" : (initialFileFilter ?? "all"));

  const pinnedLinksAll = useReportFeedStore((s) => s.pinnedLinks);
  const pinLink = useReportFeedStore((s) => s.pinLink);
  const renamePinnedLink = useReportFeedStore((s) => s.renamePinnedLink);
  const unpinLink = useReportFeedStore((s) => s.unpinLink);
  const [pinTarget, setPinTarget] = useState<{ url: string; title: string; id?: string } | null>(null);

  const files = useMemo(() => collectFiles(topicPosts), [topicPosts]);
  const links = useMemo(() => collectLinks(topicPosts), [topicPosts]);
  const pinnedLinks = useMemo(
    () => pinnedLinksAll.filter((l) => l.topicId === topic.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [pinnedLinksAll, topic.id]
  );
  const pinnedUrls = useMemo(() => new Set(pinnedLinks.map((l) => l.url)), [pinnedLinks]);
  // The "ไฟล์" tab's own rolling window — unrelated to album membership, so
  // an old photo already saved to an album still shows up fine in "อัลบั้ม"
  // even after it's aged out of this list.
  const filesWindowDays = topic.filesRetentionDays ?? FILES_TAB_WINDOW_DAYS;
  const postRecentFiles = useMemo(() => {
    const cutoff = filesCutoffMs(filesWindowDays);
    return files.filter((f) => new Date(f.createdAt).getTime() >= cutoff);
  }, [files, filesWindowDays]);
  const libByUrl = useMemo(() => new Map(library.files.map((f) => [f.storageKey, f])), [library.files]);
  // ไฟล์บริษัทของห้องที่ไม่ใช่รูปจากโพสต์ (อัปโหลดเอง) — ถาวร ไม่ตัดตามช่วงวันของแท็บ · ที่ก๊อปมาจากโพสต์โชว์เป็นรูปโพสต์เดิมพร้อมป้าย 🏢 แทน
  const libraryOnly = useMemo(() => {
    // ไฟล์เดียวกันอยู่ได้หลายโฟลเดอร์ (โฟลเดอร์ห้อง + โฟลเดอร์อัลบั้มที่กดเก็บทั้งชุด) — โชว์ใบเดียว
    const seen = new Set(files.map((f) => urlOf(f.image)));
    return library.files
      .filter((f) => !seen.has(f.storageKey) && !!seen.add(f.storageKey))
      .map<FileEntry>((f) => ({
        image: { id: `lib-${f.id}`, url: f.storageKey, name: f.name, mime: f.mimeType, size: f.size },
        postId: "",
        postTitle: "",
        createdAt: f.createdAt,
        authorId: f.createdBy,
        source: "library",
      }));
  }, [files, library.files]);
  const recentFiles = useMemo(
    () => [...postRecentFiles, ...libraryOnly].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [postRecentFiles, libraryOnly]
  );
  // รูปเดียวอยู่ได้หลายที่ — อัลบั้มที่มี url นี้ (รูปโพสต์ผูกด้วย albumId · รูปที่เพิ่มเข้าอัลบั้มตรงอยู่ใน album.items)
  const albumsByUrl = useMemo(() => {
    const m = new Map<string, ReportAlbum[]>();
    const add = (url: string, a: ReportAlbum) => {
      const list = m.get(url) ?? [];
      if (!list.some((x) => x.id === a.id)) m.set(url, [...list, a]);
    };
    for (const f of files) {
      const a = f.image.albumId ? albums.find((x) => x.id === f.image.albumId) : undefined;
      if (a) add(urlOf(f.image), a);
    }
    for (const a of albums) for (const it of a.items ?? []) add(urlOf(it), a);
    return m;
  }, [files, albums]);
  const fileAuthorOptions = useMemo(
    () => [...new Set(recentFiles.map((f) => f.authorId))].map((id) => getUser(id)).filter((u): u is NonNullable<typeof u> => !!u),
    [recentFiles]
  );
  const visibleFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    return recentFiles.filter((f) => {
      if (fileAuthorId !== "all" && f.authorId !== fileAuthorId) return false;
      if (fileStore !== "all") {
        const inAlbum = (albumsByUrl.get(urlOf(f.image))?.length ?? 0) > 0;
        const inLib = libByUrl.has(urlOf(f.image));
        if (fileStore === "album" && !inAlbum) return false;
        if (fileStore === "library" && !inLib) return false;
        if (fileStore === "none" && (inAlbum || inLib)) return false;
      }
      if (q && !f.image.name.toLowerCase().includes(q) && !f.postTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [recentFiles, fileSearch, fileAuthorId, fileStore, albumsByUrl, libByUrl]);
  // The two halves of what a post can carry: pictures/clips (a grid worth
  // looking at) and documents (a list worth reading names off). Same source,
  // same window, same search — split only at the point of display.
  const visibleImages = useMemo(() => visibleFiles.filter((f) => !isDocAttachment(f.image.mime)), [visibleFiles]);
  const visibleDocs = useMemo(() => visibleFiles.filter((f) => isDocAttachment(f.image.mime)), [visibleFiles]);
  const visibleLinks = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => l.url.toLowerCase().includes(q) || l.postTitle.toLowerCase().includes(q));
  }, [links, fileSearch]);
  const visiblePinnedLinks = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return pinnedLinks;
    return pinnedLinks.filter((l) => l.title.toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
  }, [pinnedLinks, fileSearch]);
  // LINE-style: only images explicitly curated into an album ever show up
  // here — an attachment nobody picked an album for stays view-it-in-the-post
  // only, same as an un-Kept chat photo never appearing in LINE's Keep.
  const albumFolders = useMemo(
    () =>
      albums.map((a) => {
        const inAlbum = files.filter((f) => f.image.albumId === a.id);
        const cover = inAlbum[0]?.image ?? a.items?.[a.items.length - 1];
        return { album: a, count: inAlbum.length + (a.items?.length ?? 0), cover };
      }),
    [albums, files]
  );
  const visibleAlbumFolders = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return albumFolders;
    return albumFolders.filter((f) => f.album.name.toLowerCase().includes(q));
  }, [albumFolders, fileSearch]);
  const openAlbum = openAlbumId ? albumFolders.find((f) => f.album.id === openAlbumId) : undefined;
  const openAlbumFiles = useMemo<FileEntry[]>(() => {
    if (!openAlbumId) return [];
    const a = albums.find((x) => x.id === openAlbumId);
    const direct = (a?.items ?? []).map<FileEntry>((it) => ({
      image: it,
      postId: "",
      postTitle: "",
      createdAt: it.addedAt,
      authorId: it.addedBy,
      source: "album",
      albumItemOf: a!.id,
    }));
    return [...files.filter((f) => f.image.albumId === openAlbumId), ...direct].sort(
      (x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime()
    );
  }, [openAlbumId, albums, files]);
  // "เลือกจากรูปในห้องนี้" ในหน้าอัลบั้ม — รูป/คลิปทั้งหมดของห้อง (ไม่ตัดช่วงวัน) ที่ยังไม่อยู่ในอัลบั้มนี้
  const albumCandidates = useMemo<PickableMedia[]>(() => {
    if (!openAlbumId) return [];
    const inThis = new Set(openAlbumFiles.map((f) => urlOf(f.image)));
    const all = [...files, ...libraryOnly].filter((f) => !isDocAttachment(f.image.mime) && !inThis.has(urlOf(f.image)));
    return all.map((f) => ({
      key: f.source === "library" ? f.image.id : `${f.postId}:${f.image.id}`,
      media: f.image,
      albumName: albumsByUrl.get(urlOf(f.image))?.[0]?.name,
    }));
  }, [openAlbumId, openAlbumFiles, files, libraryOnly, albumsByUrl]);

  const filterCounts: Record<FileFilter, number> = {
    all: visibleImages.length + visibleDocs.length + visibleLinks.length + visiblePinnedLinks.length,
    images: visibleImages.length,
    docs: visibleDocs.length,
    links: visibleLinks.length + visiblePinnedLinks.length,
    albums: visibleAlbumFolders.length,
  };

  // A room with a posting schedule (cutoffs) gets judged the same way the
  // Dashboard's compliance widgets judge it — ตรงเวลา/สาย/ไม่ส่ง per
  // member against that schedule, not just a raw post count. Only meaningful
  // once a schedule exists; an open check-in room has no "on time" to
  // measure against, so it falls back to a plain post count instead.
  const hasSchedule = effectiveRoundsOf(topic).length > 0;

  const stats = useMemo(() => {
    const totalReplies = topicPosts.reduce((n, p) => n + p.replies.length, 0);
    const totalReactions = topicPosts.reduce((n, p) => n + Object.values(p.reactions).reduce((m, ids) => m + ids.length, 0), 0);

    if (hasSchedule) {
      const complianceRows = buildUserComplianceReports([topic], topicPosts, range, exemptions, { countPending: true })
        .filter((r) => r.roomsCount > 0)
        // % = ส่งตรงเวลาจริง (onTimeRate) — เดิมนับ "สาย" เป็นส่งแล้ว สาย 1 ครั้งยังขึ้น 100% (ผู้ใช้ขอ 29/10/2569 "แก้ให้ตรงและจริง")
        .sort((a, b) => b.onTimeRate - a.onTimeRate || a.name.localeCompare(b.name));
      return { totalPosts: topicPosts.length, totalReplies, totalReactions, complianceRows, contributors: [] as { user: (typeof users)[number]; count: number }[] };
    }

    // Every member of the room, not just whoever happened to post — a room
    // with two posters out of eight members should read as "6 people haven't
    // posted at all", not just show a leaderboard of the two who did.
    const byAuthor = new Map<string, number>();
    for (const p of topicPosts) byAuthor.set(p.authorId, (byAuthor.get(p.authorId) ?? 0) + 1);
    const members = users.filter((u) => canSeeReportTopic(topic.visibility, u.id));
    const contributors = members
      .map((user) => ({ user, count: byAuthor.get(user.id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.user.name.localeCompare(b.user.name));
    return { totalPosts: topicPosts.length, totalReplies, totalReactions, complianceRows: [] as ReturnType<typeof buildUserComplianceReports>, contributors };
  }, [topicPosts, topic, exemptions, hasSchedule, range]);

  // ประวัติสติกเกอร์มีคะแนนที่ติดในห้องนี้ — คำขอเดิมคือ "เวลามีอ้างอิงต้องมี
  // ให้ดูว่าหักจากอันนี้นะ": หน้าคะแนนรวมของ HR (/hr/employees?tab=score) สรุปแค่ยอด
  // รวม ไม่บอกว่าแต้มไหนมาจากโพสต์ไหน — วางไว้ที่นี่แทน (ในห้องรายงานที่
  // สติกเกอร์ถูกติดจริง "เก็บไว้ในห้องรายงานสรุปอะไรแบบนี้ได้ไหม") ซึ่งมี
  // ทั้งบริบทของห้องและลิงก์กลับไปโพสต์ต้นตอให้อยู่แล้ว ต่างจากหน้า HR ที่
  // ไม่รู้จักแนวคิด "โพสต์"/"ห้อง" เลย
  const stickerEvents = useMemo(() => {
    return topicPosts
      .flatMap((p) =>
        (p.stickerReactions ?? []).map((r) => ({
          ...r,
          post: p,
          // คนที่ได้/โดนคะแนนจริง — หัวหน้าเลือกได้ตอนส่ง (ของเก่า = เจ้าของโพสต์)
          recipientId: r.targetUserId ?? p.authorId,
        }))
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [topicPosts]);

  // The single most useful number on this tab — who still owes a report
  // *today*, not just a historical count (3.5.4). Always "today", regardless
  // of whatever date range the compliance list below is filtered to.
  const pendingTodayList = useMemo(() => (hasSchedule ? pendingToday([topic], topicPosts, exemptions) : []), [hasSchedule, topic, topicPosts, exemptions]);

  // Plain rolling gallery — every photo from the last 7 days, no albums
  // involved. One-tap AlbumPickerButton per thumbnail is how something
  // graduates into a real (non-expiring) album; nothing here requires a
  // decision up front, unlike composing a post.
  // One image thumbnail with its two overlay actions (เก็บลงอัลบั้ม /
  // เพิ่มเข้าเอกสาร) — identical in the "รูปภาพ" grid and the mixed
  // "ทั้งหมด" one, so it's written once here rather than twice below.
  function openPostOf(f: FileEntry) {
    if (!f.postId) return;
    if (onOpenPost) onOpenPost(f.postId);
    else scrollToPost(f.postId);
  }

  /** เก็บลง/เอาออกจากอัลบั้ม — รูปโพสต์ใช้ albumId เดิม (อยู่ได้อัลบั้มเดียว) · ที่เหลือเป็นรายการในอัลบั้มตรง */
  function toggleAlbum(f: FileEntry, albumId: string) {
    if (!f.source && f.postId) {
      setImageAlbum(f.postId, f.image.id, f.image.albumId === albumId ? undefined : albumId);
      return;
    }
    const url = urlOf(f.image);
    const existing = useReportFeedStore.getState().albums.find((a) => a.id === albumId)?.items?.find((i) => urlOf(i) === url);
    if (existing) removeAlbumItem(albumId, existing.id);
    else addAlbumItems(albumId, [{ ...f.image, id: crypto.randomUUID(), albumId: undefined, addedBy: viewingAsUserId, addedAt: new Date().toISOString() }]);
  }

  async function saveToLibrary(f: FileEntry) {
    const url = urlOf(f.image);
    if (!url || url.startsWith("data:")) return;
    try {
      await addFileToRoomFolder(topic.id, topic.name, { url, name: f.image.name, mimeType: f.image.mime ?? "image/jpeg", size: f.image.size ?? 0 });
      toast.success(`เก็บ "${f.image.name}" เข้าไฟล์บริษัท › ห้องรายงาน › ${topic.name} แล้ว`);
      void library.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เก็บเข้าไฟล์บริษัทไม่สำเร็จ");
    }
  }

  async function uploadToLibrary(picked: File[]) {
    setUploading((n) => n + picked.length);
    let ok = 0;
    for (const file of picked) {
      try {
        const uploaded = await uploadCompanyFile(file);
        await addFileToRoomFolder(topic.id, topic.name, uploaded);
        ok += 1;
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ"}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (ok) toast.success(`อัปโหลด ${ok} ไฟล์เข้าไฟล์บริษัท › ห้องรายงาน › ${topic.name} แล้ว`);
    void library.refresh();
  }

  async function uploadToAlbum(albumId: string, picked: File[]) {
    setUploading((n) => n + picked.length);
    let ok = 0;
    for (const file of picked) {
      try {
        const m = await uploadReportMedia(file);
        addAlbumItems(albumId, [
          { id: crypto.randomUUID(), url: m.url, name: m.name, mime: m.mime, size: m.size, ...(m.thumbUrl ? { thumbUrl: m.thumbUrl } : {}), addedBy: viewingAsUserId, addedAt: new Date().toISOString() },
        ]);
        ok += 1;
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ"}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    const name = useReportFeedStore.getState().albums.find((a) => a.id === albumId)?.name ?? "";
    if (ok) toast.success(`เพิ่ม ${ok} รูปเข้าอัลบั้ม ${name} แล้ว`);
  }

  async function saveAlbumToLibrary(album: ReportAlbum, entries: FileEntry[]) {
    const items = entries
      .map((f) => ({ url: urlOf(f.image), name: f.image.name, mimeType: f.image.mime ?? "image/jpeg", size: f.image.size ?? 0 }))
      .filter((i) => i.url && !i.url.startsWith("data:"));
    if (items.length === 0) {
      toast.error("อัลบั้มนี้ยังไม่มีรูปให้เก็บ");
      return;
    }
    try {
      const r = await saveItemsToRoomSubfolder(topic.id, topic.name, album.name, items);
      toast.success(
        r.added
          ? `เก็บ ${r.added} รูปเข้าไฟล์บริษัท › ห้องรายงาน › ${topic.name} › ${album.name} แล้ว${r.skipped ? ` (มีอยู่แล้ว ${r.skipped} รูป)` : ""}`
          : `ทุกรูปอยู่ในไฟล์บริษัท › ${topic.name} › ${album.name} แล้ว`
      );
      void library.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เก็บเข้าไฟล์บริษัทไม่สำเร็จ");
    }
  }

  function menuFor(f: FileEntry, variant: "overlay" | "row", inAlbumId?: string) {
    const url = urlOf(f.image);
    const inAlbums = albumsByUrl.get(url) ?? [];
    return (
      <RoomFileMenu
        name={f.image.name}
        url={url.startsWith("data:") ? "" : url}
        roomName={topic.name}
        roomAlbums={albums}
        inAlbumIds={inAlbums.map((a) => a.id)}
        libraryFile={libByUrl.get(url)}
        canSaveToLibrary={library.canUpload && !!url && !url.startsWith("data:")}
        onToggleAlbum={(albumId) => toggleAlbum(f, albumId)}
        onNewAlbum={() => setNewAlbumFor(f)}
        onSaveToLibrary={() => void saveToLibrary(f)}
        onOpenPost={f.postId ? () => openPostOf(f) : undefined}
        onRemoveFromThisAlbum={inAlbumId ? () => toggleAlbum(f, inAlbumId) : undefined}
        variant={variant}
      />
    );
  }

  /** กล่อง "เก็บอยู่ที่" ในตัวดูรูป — รายการเดียวกับที่เปิดอยู่ */
  function whereStored(items: FileEntry[]) {
    return function renderWhereStored(_img: ReportPostImage, i: number) {
      const f = items[i];
      if (!f) return null;
      const url = urlOf(f.image);
      return (
        <WhereStoredPanel
          name={f.image.name}
          albums={albumsByUrl.get(url) ?? []}
          libraryFile={libByUrl.get(url)}
          postTitle={f.postId ? f.postTitle : undefined}
          onOpenPost={f.postId ? () => {
            setLightbox(null);
            openPostOf(f);
          } : undefined}
          canSaveToLibrary={library.canUpload && !!url && !url.startsWith("data:")}
          onSaveToLibrary={() => void saveToLibrary(f)}
        />
      );
    };
  }

  function sourceLine(f: FileEntry) {
    const who = getUser(f.authorId)?.name ?? library.files.find((l) => l.createdBy === f.authorId)?.createdByName ?? "";
    const from = f.source === "library" ? "อัปโหลด" : f.source === "album" ? "เพิ่มเข้าอัลบั้ม" : "จากโพสต์";
    return (
      <>
        {who ? `${who} · ` : ""}
        {from} · <TimeAgo date={f.createdAt} />
      </>
    );
  }

  function imageCell(f: FileEntry, index: number, list: FileEntry[] = visibleImages, inAlbumId?: string) {
    const url = urlOf(f.image);
    return (
      <div key={`${f.image.id}-${index}`} className="relative group">
        <button onClick={() => setLightbox({ items: list, index })} className="block text-left w-full">
          <ReportMediaThumb media={f.image} className="w-full h-24 object-cover rounded-lg border border-[var(--line)] group-hover:opacity-90" />
          <p className="text-xs mt-1 truncate">{f.image.name}</p>
          <p className="text-[11px] text-[var(--ink-soft)] truncate">{sourceLine(f)}</p>
        </button>
        <StorageBadges
          albums={inAlbumId ? [] : (albumsByUrl.get(url) ?? [])}
          inLibrary={libByUrl.has(url)}
          temporaryDays={!f.source && !inAlbumId ? filesWindowDays : undefined}
        />
        <div className="absolute top-1 right-1">{menuFor(f, "overlay", inAlbumId)}</div>
      </div>
    );
  }

  /** A pdf/xlsx attached to a post — a row, not a tile: the filename is the
   * only thing that identifies it, so it gets the width. Opens the real file
   * in a new tab; the same "เพิ่มเข้าไฟล์ทั้งหมดของห้องนี้" button the photos
   * have sits at the end. */
  function docRow(f: FileEntry, key: string) {
    const url = urlOf(f.image);
    return (
      <div key={key} className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] px-2.5 py-2">
        <ReportFileChip media={f.image} variant="icon" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium hover:text-[var(--brand-green-dark)] hover:underline"
          >
            {f.image.name}
          </a>
          {f.postId ? (
            <button onClick={() => openPostOf(f)} className="block max-w-full truncate text-[11px] text-[var(--ink-soft)] hover:underline">
              จาก &quot;{f.postTitle}&quot; · {getUser(f.authorId)?.name} · <TimeAgo date={f.createdAt} />
            </button>
          ) : (
            <p className="truncate text-[11px] text-[var(--ink-soft)]">{sourceLine(f)}</p>
          )}
          <StorageBadges albums={albumsByUrl.get(url) ?? []} inLibrary={libByUrl.has(url)} temporaryDays={!f.source ? filesWindowDays : undefined} />
        </div>
        <div className="shrink-0">{menuFor(f, "row")}</div>
      </div>
    );
  }

  /** One link row, used for both the pinned group and the automatic
   * from-posts group — `pinned` decides whether the trailing button pins it
   * or unpins it. */
  function linkRow(l: { url: string; title?: string; postId?: string; postTitle?: string; createdAt: string; id?: string }, key: string, pinned: boolean) {
    const domain = hostnameOf(l.url);
    return (
      <div key={key} className="flex items-start gap-2.5 rounded-lg border border-[var(--line)] px-3 py-2.5">
        {domain ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`} alt="" className="h-4 w-4 mt-0.5 shrink-0 rounded" />
        ) : (
          <Link2 className="h-4 w-4 mt-0.5 shrink-0 text-[var(--brand-green-dark)]" />
        )}
        <div className="min-w-0 flex-1">
          {l.title ? (
            <>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium hover:text-[var(--brand-green-dark)] hover:underline">
                {l.title}
              </a>
              <p className="truncate text-[11px] text-[var(--ink-soft)]">{l.url}</p>
            </>
          ) : (
            <>
              {domain && <p className="text-[11px] font-medium text-[var(--ink-soft)] truncate">{domain}</p>}
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--brand-green-dark)] hover:underline break-all">
                {l.url}
              </a>
            </>
          )}
          {l.postId && l.postTitle && (
            <button onClick={() => scrollToPost(l.postId!)} className="block max-w-full truncate text-[11px] text-[var(--ink-soft)] hover:underline mt-0.5">
              จาก &quot;{l.postTitle}&quot; · <TimeAgo date={l.createdAt} />
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {pinned ? (
            <>
              <button
                onClick={() => setPinTarget({ url: l.url, title: l.title ?? "", id: l.id })}
                className="h-8 w-8 flex items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                aria-label={`เปลี่ยนชื่อลิงก์ ${l.title ?? l.url}`}
                title="เปลี่ยนชื่อ"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => l.id && unpinLink(l.id)}
                className="h-8 w-8 flex items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                aria-label={`เลิกปักหมุด ${l.title ?? l.url}`}
                title="เลิกปักหมุด"
              >
                <PinOff className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setPinTarget({ url: l.url, title: "" })}
              className={cn(
                "h-8 w-8 flex items-center justify-center rounded-md hover:bg-[var(--bg-soft)]",
                pinnedUrls.has(l.url) ? "text-[var(--brand-green-dark)]" : "text-[var(--ink-soft)]"
              )}
              aria-label={`ปักหมุด ${l.url}`}
              title={pinnedUrls.has(l.url) ? "ปักหมุดไว้แล้ว — กดเพื่อเปลี่ยนชื่อ" : "ปักหมุดลิงก์นี้ไว้"}
            >
              <Pin className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  function imagesGrid(entries: FileEntry[]) {
    return (
      <div className="space-y-4">
        {groupByDay(entries, (f) => f.createdAt).map((group) => (
          <div key={group.key}>
            <p className="text-[11px] font-bold text-[var(--ink-soft)] mb-2">{group.label}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {group.items.map((f) => imageCell(f, visibleImages.indexOf(f)))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function albumFolderGrid() {
    return (
      <>
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-xs text-[var(--ink-soft)]">อัลบั้มเก็บรูปแบบถาวรของหัวข้อนี้</p>
          <button
            onClick={() => setCreateAlbumOpen(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white text-xs font-medium px-3 py-1.5 transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            สร้างอัลบั้ม
          </button>
        </div>
        {visibleAlbumFolders.length === 0 ? (
          <TopicEmptyState
            icon={FolderHeart}
            title={fileSearch.trim() ? "ไม่มีอัลบั้มตรงกับคำค้น" : "ยังไม่มีอัลบั้มในหัวข้อนี้"}
            description={fileSearch.trim() ? "ลองค้นด้วยคำอื่น" : "สร้างอัลบั้มแล้วกด “เพิ่มรูป” ในอัลบั้มได้เลย หรือกด ⋯ ที่รูปในแท็บไฟล์แล้วเลือก “เก็บลงอัลบั้ม”"}
            action={
              fileSearch.trim() ? undefined : (
                <button
                  onClick={() => setCreateAlbumOpen(true)}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white text-xs font-medium px-3.5 py-1.5 transition-colors"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  สร้างอัลบั้มแรก
                </button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleAlbumFolders.map(({ album, count, cover }) => (
              <button
                key={album.id}
                onClick={() => setOpenAlbumId(album.id)}
                className="group text-left rounded-lg border border-[var(--line)] overflow-hidden hover:border-[var(--brand-green)]/40 transition-colors"
              >
                <div className="h-24 bg-[var(--bg-soft)] flex items-center justify-center overflow-hidden">
                  {cover ? (
                    <ReportMediaThumb media={cover} className="w-full h-full object-cover group-hover:opacity-90" />
                  ) : (
                    <FolderHeart className="h-6 w-6 text-[var(--ink-soft)]" />
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium truncate">{album.name}</p>
                  <p className="text-[11px] text-[var(--ink-soft)]">{count} รูป</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  function sectionHeading(text: string, count: number) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">
        {text}
        <span className="rounded-full bg-[var(--bg-soft)] px-1.5 py-0.5 font-medium tabular-nums">{count}</span>
      </p>
    );
  }

  if (tab === "files" || tab === "albums") {
    // Inside one album the filter row steps aside entirely — you're in a
    // folder now, and the way out is its own back button, same as before
    // this was a filter rather than a tab of its own.
    if (fileFilter === "albums" && openAlbum) {
      const thisAlbum = openAlbum.album;
      return (
        <PasteDropFiles label="ปล่อยเพื่อเพิ่มรูปเข้าอัลบั้มนี้" className="flex flex-1 min-h-0 flex-col">
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setOpenAlbumId(null)}
              className="flex items-center gap-1.5 text-sm font-semibold hover:text-[var(--brand-green-dark)]"
            >
              <ArrowLeft className="h-4 w-4" />
              {openAlbum.album.name}
              <span className="text-xs font-normal text-[var(--ink-soft)]">({openAlbum.count})</span>
            </button>
            <div className="flex items-center gap-1">
              <AlbumAddPhotos
                busy={uploading > 0}
                onUpload={(picked) => void uploadToAlbum(thisAlbum.id, picked)}
                candidates={albumCandidates}
                onPick={(keys) => {
                  const pool = [...files, ...libraryOnly];
                  let n = 0;
                  for (const key of keys) {
                    const f = pool.find((x) => (x.source === "library" ? x.image.id : `${x.postId}:${x.image.id}`) === key);
                    if (!f) continue;
                    if (!f.source && f.postId) setImageAlbum(f.postId, f.image.id, thisAlbum.id);
                    else addAlbumItems(thisAlbum.id, [{ ...f.image, id: crypto.randomUUID(), albumId: undefined, addedBy: viewingAsUserId, addedAt: new Date().toISOString() }]);
                    n += 1;
                  }
                  if (n) toast.success(`เพิ่ม ${n} รูปเข้าอัลบั้ม ${thisAlbum.name} แล้ว`);
                }}
              />
              {library.canUpload && openAlbumFiles.length > 0 && (
                <button
                  onClick={() => void saveAlbumToLibrary(thisAlbum, openAlbumFiles)}
                  className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-soft)]"
                  title={`ก๊อปทุกรูปไปที่ ไฟล์บริษัท › ห้องรายงาน › ${topic.name} › ${thisAlbum.name} (กดซ้ำได้ เพิ่มเฉพาะรูปใหม่)`}
                >
                  <Building2 className="h-3.5 w-3.5" />
                  เก็บทั้งอัลบั้มเข้าไฟล์บริษัท
                </button>
              )}
              <button
                onClick={() => setRenameAlbumOpen(true)}
                className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                aria-label={`เปลี่ยนชื่ออัลบั้ม ${openAlbum.album.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDeleteAlbumTarget({ id: openAlbum.album.id, name: openAlbum.album.name })}
                className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--chart-red)] hover:bg-[var(--chart-red)]/10"
                aria-label={`ลบอัลบั้ม ${openAlbum.album.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {uploading > 0 && <p className="mb-2 text-xs text-[var(--ink-soft)]">กำลังอัปโหลด {uploading} ไฟล์…</p>}
          {openAlbumFiles.length === 0 ? (
            <TopicEmptyState
              icon={FolderHeart}
              title="อัลบั้มนี้ยังไม่มีรูป"
              description="กด “เพิ่มรูป” ลากรูปมาวางที่นี่ หรือกด Ctrl+V วางรูป — เลือกจากรูปที่มีในห้องก็ได้"
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {openAlbumFiles.map((f, i) => imageCell(f, i, openAlbumFiles, thisAlbum.id))}
            </div>
          )}
          {lightbox && (
            <ReportImageLightbox
              images={lightbox.items.map((f) => f.image)}
              index={lightbox.index}
              onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
              onClose={() => setLightbox(null)}
              imageMeta={(_img, i) => {
                const f = lightbox.items[i];
                return f ? { authorId: f.authorId, at: f.createdAt } : null;
              }}
              infoPanel={whereStored(lightbox.items)}
            />
          )}
          <AlbumFormDialog
            open={!!newAlbumFor}
            onOpenChange={(v) => !v && setNewAlbumFor(null)}
            title="สร้างอัลบั้มใหม่"
            onSubmit={(name) => {
              const id = addAlbum(topic.id, name, viewingAsUserId);
              if (newAlbumFor) toggleAlbum(newAlbumFor, id);
              setNewAlbumFor(null);
            }}
          />
          <AlbumFormDialog
            open={renameAlbumOpen}
            onOpenChange={setRenameAlbumOpen}
            title="เปลี่ยนชื่ออัลบั้ม"
            initialName={openAlbum.album.name}
            onSubmit={(name) => renameAlbum(openAlbum.album.id, name)}
          />
          <AlertDialog open={!!deleteAlbumTarget} onOpenChange={(v) => !v && setDeleteAlbumTarget(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>ลบอัลบั้ม &quot;{deleteAlbumTarget?.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  รูปจากโพสต์ไม่ถูกลบ ยังดูได้ในโพสต์เดิม · รูปที่อัปโหลดเข้าอัลบั้มนี้โดยตรงจะหายไปด้วย · ที่เคยเก็บเข้าไฟล์บริษัทแล้วยังอยู่ที่ไฟล์บริษัท
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
                  onClick={() => {
                    if (!deleteAlbumTarget) return;
                    removeAlbum(deleteAlbumTarget.id);
                    setDeleteAlbumTarget(null);
                    setOpenAlbumId(null);
                  }}
                >
                  ลบอัลบั้ม
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        </PasteDropFiles>
      );
    }

    const hasAnything = recentFiles.length + links.length + pinnedLinks.length + albumFolders.length > 0;

    return (
      <PasteDropFiles label={`ปล่อยเพื่ออัปโหลดเข้าไฟล์บริษัท › ${topic.name}`} disabled={!library.canUpload} className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {/* One search box for the whole tab, above the filter row rather than
            inside any one filter — a filename, a link's name and an album
            name are all "something I put in this room", so there's no reason
            to make people find a different box for each. The uploader
            dropdown only narrows things that have an uploader (photos and
            documents), so it hides on the link/album filters. */}
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          {hasAnything && (
          <>
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
              <Input
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="ค้นชื่อไฟล์ / ลิงก์ / อัลบั้ม..."
                className="pl-8 h-8 text-xs"
              />
            </div>
            {(fileFilter === "all" || fileFilter === "images" || fileFilter === "docs") && fileAuthorOptions.length > 0 && (
              <Select value={fileAuthorId} onValueChange={(v) => v && setFileAuthorId(v)}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue>{fileAuthorId === "all" ? "ทุกคน" : getUser(fileAuthorId)?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกคน</SelectItem>
                  {fileAuthorOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(fileFilter === "all" || fileFilter === "images" || fileFilter === "docs") && (
              <Select value={fileStore} onValueChange={(v) => v && setFileStore(v as StoreFilter)}>
                <SelectTrigger className="h-8 w-[170px] text-xs">
                  <SelectValue>
                    {{ all: "ที่เก็บ: ทั้งหมด", none: "ยังไม่ได้เก็บ", album: "อยู่ในอัลบั้ม", library: "อยู่ในไฟล์บริษัท" }[fileStore]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ที่เก็บ: ทั้งหมด</SelectItem>
                  <SelectItem value="none">ยังไม่ได้เก็บ</SelectItem>
                  <SelectItem value="album">อยู่ในอัลบั้ม</SelectItem>
                  {library.canAccess && <SelectItem value="library">อยู่ในไฟล์บริษัท</SelectItem>}
                </SelectContent>
              </Select>
            )}
          </>
          )}
          {tab === "files" && (
            <RoomUploadButton
              roomName={topic.name}
              canUploadToLibrary={library.canUpload}
              albums={albums}
              busy={uploading > 0}
              onUploadToLibrary={(picked) => void uploadToLibrary(picked)}
              onUploadToAlbum={(albumId, picked) => void uploadToAlbum(albumId, picked)}
              onNewAlbum={() => setCreateAlbumOpen(true)}
            />
          )}
        </div>

        {/* Segmented control, scroll-x on a phone rather than wrapping into a
            second row that shifts everything below it. */}
        {tab === "files" && (
        <div role="tablist" aria-label="ชนิดของไฟล์" className="no-scrollbar -mx-1 mb-3 flex items-center gap-1 overflow-x-auto px-1">
          {fileFilterOptions.filter((opt) => opt.id !== "albums").map((opt) => {
            const Icon = opt.icon;
            const active = fileFilter === opt.id;
            const count = filterCounts[opt.id];
            return (
              <button
                key={opt.id}
                role="tab"
                aria-selected={active}
                onClick={() => setFileFilter(opt.id)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
                    : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {opt.label}
                {count > 0 && <span className="tabular-nums text-[10px] opacity-70">{count > 99 ? "99+" : count}</span>}
              </button>
            );
          })}
        </div>
        )}

        {fileFilter === "images" && (
          <>
            <p className="text-xs text-[var(--ink-soft)] mb-3">
              รูป/คลิปจากโพสต์ช่วง {filesWindowDays} วันล่าสุด + ไฟล์บริษัทของห้อง — กด ⋯ ที่รูปเพื่อเก็บลงอัลบั้มหรือไฟล์บริษัท
            </p>
            {visibleImages.length === 0 ? (
              <TopicEmptyState
                icon={FileImage}
                title={recentFiles.length === 0 ? `ยังไม่มีรูปในช่วง ${filesWindowDays} วันล่าสุด` : "ไม่มีรูปตรงกับตัวกรอง"}
                description={recentFiles.length === 0 ? "รูปที่แนบมากับโพสต์หรือความคิดเห็นในหัวข้อนี้จะขึ้นที่นี่" : "ลองค้นด้วยคำอื่น หรือเลือก “ทุกคน”"}
              />
            ) : (
              imagesGrid(visibleImages)
            )}
          </>
        )}

        {fileFilter === "docs" && (
          <div className="space-y-4">
            {/* ไฟล์บริษัทของห้องรวมอยู่ในรายการนี้แล้ว (ป้าย 🏢) — เดิมเป็นกล่องแยกด้านบน กดแล้วเด้งไปหน้าไฟล์บริษัท ("งง" 31/10/2569) */}
            <div className="space-y-1.5">
              {sectionHeading("เอกสาร", visibleDocs.length)}
              {visibleDocs.length === 0 ? (
                <p className="text-xs text-[var(--ink-soft)]">
                  {recentFiles.length === 0
                    ? `ยังไม่มีเอกสารที่แนบในโพสต์ช่วง ${filesWindowDays} วันล่าสุด — แนบ PDF/Word/Excel ในโพสต์ได้เลย`
                    : "ไม่มีเอกสารตรงกับตัวกรอง"}
                </p>
              ) : (
                visibleDocs.map((f, i) => docRow(f, `${f.image.id}-${i}`))
              )}
            </div>
          </div>
        )}

        {fileFilter === "links" && (
          <div className="space-y-4">
            {visiblePinnedLinks.length > 0 && (
              <div className="space-y-1.5">
                {sectionHeading("ปักหมุดไว้", visiblePinnedLinks.length)}
                {visiblePinnedLinks.map((l) => linkRow(l, l.id, true))}
              </div>
            )}
            <div className="space-y-1.5">
              {sectionHeading("ลิงก์จากโพสต์", visibleLinks.length)}
              {visibleLinks.length === 0 ? (
                <p className="text-xs text-[var(--ink-soft)]">
                  {links.length === 0 ? "ลิงก์ที่แปะไว้ในโพสต์หรือความคิดเห็นจะรวบรวมมาไว้ที่นี่" : "ไม่มีลิงก์ตรงกับคำค้น"}
                </p>
              ) : (
                visibleLinks.map((l, i) => linkRow(l, `${l.url}-${i}`, false))
              )}
            </div>
            {visiblePinnedLinks.length === 0 && visibleLinks.length === 0 && links.length === 0 && (
              <TopicEmptyState icon={Link2} title="ยังไม่มีลิงก์ในหัวข้อนี้" description="ลิงก์ในโพสต์จะขึ้นที่นี่เอง กดหมุดไว้เพื่อตั้งชื่อและเก็บถาวร" />
            )}
          </div>
        )}

        {fileFilter === "albums" && albumFolderGrid()}

        {fileFilter === "all" && (
          <div className="space-y-4">
            {/* ไฟล์บริษัทของห้องรวมอยู่ในรูปภาพ/เอกสารด้านล่างแล้ว พร้อมป้ายบอกที่เก็บ */}
            {filterCounts.all === 0 ? (
              <TopicEmptyState
                icon={LayoutGrid}
                title={hasAnything ? "ไม่มีอะไรตรงกับคำค้น" : "ยังไม่มีไฟล์ในหัวข้อนี้"}
                description={hasAnything ? "ลองค้นด้วยคำอื่น" : "รูป เอกสาร และลิงก์ที่แนบมากับโพสต์ในหัวข้อนี้จะมารวมกันที่นี่"}
              />
            ) : (
              <>
                {visibleImages.length > 0 && (
                  <div className="space-y-2">
                    {sectionHeading("รูปภาพ", visibleImages.length)}
                    {imagesGrid(visibleImages)}
                  </div>
                )}
                {visibleDocs.length > 0 && (
                  <div className="space-y-1.5">
                    {sectionHeading("เอกสาร", visibleDocs.length)}
                    {visibleDocs.map((f, i) => docRow(f, `all-${f.image.id}-${i}`))}
                  </div>
                )}
                {visiblePinnedLinks.length > 0 && (
                  <div className="space-y-1.5">
                    {sectionHeading("ลิงก์ปักหมุด", visiblePinnedLinks.length)}
                    {visiblePinnedLinks.map((l) => linkRow(l, `all-${l.id}`, true))}
                  </div>
                )}
                {visibleLinks.length > 0 && (
                  <div className="space-y-1.5">
                    {sectionHeading("ลิงก์จากโพสต์", visibleLinks.length)}
                    {visibleLinks.map((l, i) => linkRow(l, `all-${l.url}-${i}`, false))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {lightbox && (
          <ReportImageLightbox
            images={lightbox.items.map((f) => f.image)}
            index={lightbox.index}
            onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
            onClose={() => setLightbox(null)}
            imageMeta={(_img, i) => {
              const f = lightbox.items[i];
              return f ? { authorId: f.authorId, at: f.createdAt } : null;
            }}
            infoPanel={whereStored(lightbox.items)}
          />
        )}
        <AlbumFormDialog
          open={createAlbumOpen}
          onOpenChange={setCreateAlbumOpen}
          title="สร้างอัลบั้มใหม่"
          onSubmit={(name) => {
            // สร้างจากปุ่มอัปโหลดในแท็บไฟล์ก็เปิดอัลบั้มใหม่ให้เลย เพิ่มรูปต่อได้ทันที
            setFileFilter("albums");
            setOpenAlbumId(addAlbum(topic.id, name, viewingAsUserId));
          }}
        />
        <AlbumFormDialog
          open={!!newAlbumFor}
          onOpenChange={(v) => !v && setNewAlbumFor(null)}
          title="สร้างอัลบั้มใหม่"
          onSubmit={(name) => {
            const id = addAlbum(topic.id, name, viewingAsUserId);
            if (newAlbumFor) toggleAlbum(newAlbumFor, id);
            setNewAlbumFor(null);
          }}
        />
        <PinLinkDialog
          open={!!pinTarget}
          onOpenChange={(v) => !v && setPinTarget(null)}
          url={pinTarget?.url ?? ""}
          initialTitle={pinTarget?.title ?? ""}
          onSubmit={(title) => {
            if (!pinTarget) return;
            if (pinTarget.id) renamePinnedLink(pinTarget.id, title);
            else pinLink(topic.id, pinTarget.url, title, viewingAsUserId);
            setPinTarget(null);
          }}
        />
      </div>
      </PasteDropFiles>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className={cn("grid gap-3", hasSchedule ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        {hasSchedule && (
          <StatCard
            icon={TriangleAlert}
            label="ยังไม่ส่งวันนี้"
            value={pendingTodayList.length}
            color={pendingTodayList.length > 0 ? "var(--chart-red)" : topic.color}
            title={
              // Phase 1.1: pendingTodayList is one entry per still-pending
              // round, so the same person can appear twice — the count above
              // stays per-round (consistent with the rest of the app), but
              // the tooltip lists each name once, not twice.
              pendingTodayList.length > 0 ? [...new Set(pendingTodayList.map((p) => p.userName))].join(", ") : undefined
            }
          />
        )}
        <StatCard icon={MessageSquareText} label="โพสต์ทั้งหมด" value={stats.totalPosts} color={topic.color} />
        <StatCard icon={MessageCircle} label="ความคิดเห็น" value={stats.totalReplies} color={topic.color} />
        <StatCard icon={ThumbsUp} label="ปฏิกิริยา" value={stats.totalReactions} color={topic.color} />
      </div>

      <div className="rounded-xl border border-[var(--line)] p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <span className="flex items-center gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
              <Trophy className="h-3.5 w-3.5" />
              {hasSchedule ? "วินัยการส่งของสมาชิก" : "สถิติการโพสต์ของสมาชิก"}
            </p>
            {(hasSchedule ? stats.complianceRows.length : stats.contributors.length) > 0 && (
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {hasSchedule ? stats.complianceRows.length : stats.contributors.length}
              </span>
            )}
          </span>
          {/* บอกไว้ตรงๆ ว่ากดชื่อคนแล้วทำอะไรได้ ("มีบอกด้วยนะว่ากดชื่อคน
              แล้วจะฟิลเตอร์เลือกโพสต์ที่ถูกหักคะแนน") — ไม่งั้นเป็นแค่แถวเฉยๆ
              ที่ดูไม่ออกว่ากดได้ จนกว่าจะมีคนบังเอิญลองกด */}
          {stickerEvents.length > 0 && (
            <span className="text-[11px] text-[var(--ink-soft)] basis-full">
              💡 กดชื่อคนเพื่อกรองดูว่าโพสต์ไหนของเขาถูกให้คะแนนบ้าง
            </span>
          )}
          {/* Only meaningful once there's a schedule to be "on time" against
              — the plain-post-count fallback for open rooms has no date
              window to narrow, so it stays hidden there.
              w-full + min-w-0 forces its own row on a narrow screen instead
              of overflowing/getting clipped past the card's right edge
              ("คำนึงถึง responsive mobile ด้วยนะ") — DatePresetPicker's own
              overflow-x-auto can't kick in without min-w-0 here, since a
              flex item won't shrink below its content width by default and
              just spills past the card instead of scrolling internally. */}
          {hasSchedule && (
            <DatePresetPicker
              preset={preset}
              customFrom={customFrom}
              customTo={customTo}
              onPresetChange={setPreset}
              className="w-full min-w-0 sm:w-auto"
              onCustomRangeChange={(from, to) => {
                setCustomFrom(from);
                setCustomTo(to);
              }}
            />
          )}
        </div>

        {hasSchedule ? (
          stats.complianceRows.length === 0 ? (
            <p className="text-sm text-[var(--ink-soft)]">ห้องนี้ยังไม่มีสมาชิก</p>
          ) : (
            // ห้องที่คนเยอะไม่ดันความสูงของทั้งหน้าให้ยาวไม่จบไม่สิ้น ("ถ้ามี
            // คนเยอะมันจะล้นลงไปเรื่อยๆ") — ตรึงความสูงแล้วให้เลื่อนในกรอบ
            // ตัวเองแทน (~6 แถวครึ่งก่อนเริ่มเลื่อน)
            <div className="max-h-[19rem] overflow-y-auto pr-1">
              {stats.complianceRows.map((r) => {
                const user = getUser(r.id);
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0 border-[var(--line)]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.name} />
                        <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                          {user?.avatar}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium truncate">{r.name}</span>
                      <Badge variant="secondary" className="text-[10px] font-normal shrink-0 hidden sm:inline-flex">
                        {r.subtitle}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span
                        title={`ส่งตรงเวลา ${r.onTime} จาก ${r.trackedDays} รอบ (สาย/ไม่ส่งไม่นับ)`}
                        className={cn(
                          "text-xs font-semibold tabular-nums whitespace-nowrap",
                          r.onTimeRate >= 80 ? "text-[var(--brand-green-dark)]" : r.onTimeRate >= 50 ? "text-[var(--chart-amber)]" : "text-[var(--chart-red)]"
                        )}
                      >
                        {r.onTimeRate}%
                      </span>
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        <StatChip label="ตรงเวลา" value={r.onTime} tone="green" />
                        {r.late > 0 && <StatChip label="สาย" value={r.late} tone="amber" />}
                        {r.missed > 0 && <StatChip label="ไม่ส่ง" value={r.missed} tone="red" />}
                        {/* รอบที่ยังไม่ถึงเวลาส่ง (นับในตัวหาร % ด้วย — ส่งเช้าแล้วรอเย็น = 50%) */}
                        {r.pending > 0 && <StatChip label="รอส่ง" value={r.pending} tone="gray" />}
                        {/* Days they did post but didn't attach enough photos for that
                            round — a subset flag on top of onTime/late, not a fourth
                            bucket (see ComplianceRow.attachmentIssues). */}
                        {r.attachmentIssues > 0 && <StatChip label="แนบรูปไม่ครบ" value={r.attachmentIssues} tone="amber" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : stats.contributors.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">ห้องนี้ยังไม่มีสมาชิก</p>
        ) : (
          <div className="max-h-[19rem] overflow-y-auto pr-1">
            {stats.contributors.map(({ user, count }) => {
              const userStickerCount = stickerEvents.filter((e) => e.recipientId === user.id).length;
              const selected = stickerFilterUserId === user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setStickerFilterUserId((cur) => (cur === user.id ? null : user.id))}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 py-1.5 border-b last:border-0 border-[var(--line)] text-left rounded-md px-1.5 -mx-1.5 transition-colors",
                    selected ? "bg-[var(--accent)]" : "hover:bg-[var(--bg-soft)]"
                  )}
                  title={userStickerCount > 0 ? `กดดูประวัติสติกเกอร์ของ ${user.name} (${userStickerCount} รายการ)` : undefined}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarImage src={user.avatarUrl ?? undefined} alt={user.name} />
                      <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                        {user.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium truncate">{user.name}</span>
                    <Badge variant="secondary" className="text-[10px] font-normal shrink-0 hidden sm:inline-flex">
                      {getDepartment(user.departmentId)?.name ?? user.role}
                    </Badge>
                    {userStickerCount > 0 && (
                      <span className="text-[10px] font-semibold shrink-0 rounded-full bg-[var(--bg-soft)] px-1.5 py-0.5 text-[var(--ink-soft)]">
                        🏷️ {userStickerCount}
                      </span>
                    )}
                  </div>
                  <span className={cn("text-xs tabular-nums shrink-0 whitespace-nowrap", count === 0 ? "text-[var(--chart-red)] font-medium" : "text-[var(--ink-soft)]")}>
                    {count} โพสต์
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ประวัติสติกเกอร์มีคะแนนของห้องนี้ — ให้อ้างอิงย้อนกลับได้ว่าแต้มที่
          หน้าคะแนนรวมของ HR (/hr/employees?tab=score) โดนหัก/ได้จากโพสต์ไหนบ้าง
          (หน้านั้นสรุปแค่ยอดรวม ไม่รู้จักโพสต์เลย) */}
      {stickerEvents.length > 0 && (
        <div className="rounded-xl border border-[var(--line)] p-4">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
              <StickerIcon className="h-3.5 w-3.5" />
              ประวัติสติกเกอร์ให้คะแนน
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {stickerFilterUserId
                  ? stickerEvents.filter((e) => e.recipientId === stickerFilterUserId).length
                  : stickerEvents.length}
              </span>
            </p>
            {stickerFilterUserId && (
              <button
                type="button"
                onClick={() => setStickerFilterUserId(null)}
                className="flex items-center gap-1 text-xs font-medium text-[var(--brand-green-dark)] bg-[var(--accent)] rounded-full px-2 py-0.5 hover:opacity-80"
              >
                กรอง: {getUser(stickerFilterUserId)?.name ?? "-"} ✕
              </button>
            )}
          </div>
          {/* เรียงใหม่สุดขึ้นก่อนอยู่แล้ว (ดู stickerEvents useMemo ด้านบน —
              "คะแนนที่ถูกลบไล่จากวันล่าสุดมาแสดงก่อน") ตรึงความสูงไม่ให้ยาว
              ไม่จบ ("เปลืองพื้นที่ยาวไม่หยุดเลย") เหมือนตารางสมาชิกด้านบน */}
          <div className="max-h-[22rem] overflow-y-auto pr-1">
            {stickerEvents
              .filter((e) => !stickerFilterUserId || e.recipientId === stickerFilterUserId)
              .map((e) => {
              const sticker = stickers.find((s) => s.id === e.stickerId);
              const author = getUser(e.recipientId);
              const actor = getUser(e.byUserId);
              return (
                <div key={e.id} className="flex items-start justify-between gap-2 py-2 border-b last:border-0 border-[var(--line)]">
                  <div className="min-w-0 flex items-start gap-2">
                    <span className="text-base leading-none shrink-0 mt-0.5">{sticker?.emoji ?? "🏷️"}</span>
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{sticker?.label ?? e.stickerId}</span>
                        {" ให้ "}
                        <span className="font-medium">{author?.name ?? "ไม่ทราบชื่อ"}</span>
                        {" · บนโพสต์ "}
                        <Link
                          href={`/chat-report/report-feed?topic=${topic.id}&post=${e.post.id}`}
                          onClick={(ev) => {
                            if (!onOpenPost) return;
                            ev.preventDefault();
                            onOpenPost(e.post.id);
                          }}
                          className="text-[var(--brand-green-dark)] hover:underline"
                        >
                          &ldquo;{e.post.title || "(ไม่มีหัวข้อ)"}&rdquo;
                        </Link>
                      </p>
                      <p className="text-xs text-[var(--ink-soft)] mt-0.5">
                        โดย {actor?.name ?? "ไม่ทราบชื่อ"} · <TimeAgo date={e.createdAt} />
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!!sticker && sticker.points !== 0 && (
                      <span
                        className={cn(
                          "text-xs font-bold tabular-nums",
                          sticker.points < 0 ? "text-[var(--chart-red)]" : "text-[var(--brand-green-dark)]"
                        )}
                      >
                        {sticker.points > 0 ? `+${sticker.points}` : sticker.points}
                      </span>
                    )}
                    {/* ยกเลิกได้ถ้ากดผิด/ไม่ได้ตั้งใจ ("ให้กดยกเลิกได้ด้วยสิ
                        ถ้าแบบกดผิด") — คืนคะแนนที่หักไปด้วย (ดู
                        report-feed-performance.ts ฝั่งเซิร์ฟ สร้าง event
                        หักล้างของเดิม ไม่ใช่แค่ลบแถวออกจากหน้าจอเฉยๆ)
                        เฉพาะ CEO เหมือนกับคนที่ให้สิทธิ์ติดได้ตั้งแต่แรก */}
                    {isOwner(viewingAsUserId) && (
                      <button
                        type="button"
                        onClick={() => removeStickerReaction(e.post.id, e.id, viewingAsUserId)}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--bg-soft)] hover:text-[var(--chart-red)]"
                        aria-label="ยกเลิกสติกเกอร์นี้"
                        title="ยกเลิก (คืนคะแนน)"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  title,
}: {
  icon: typeof FileImage;
  label: string;
  value: number;
  color: string;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] p-3.5 flex items-center gap-3" title={title}>
      <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, white)` }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div>
        <p className="text-[11px] text-[var(--ink-soft)]">{label}</p>
        <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      </div>
    </div>
  );
}

const statChipTones = {
  green: "bg-[var(--accent)] text-[var(--brand-green-dark)]",
  amber: "bg-amber-50 text-[var(--chart-amber)]",
  red: "bg-red-50 text-[var(--chart-red)]",
  gray: "bg-[var(--bg-soft)] text-[var(--ink-soft)]",
} as const;

/** One ตรงเวลา/สาย/ไม่ส่ง/แนบรูปไม่ครบ figure as its own small pill instead of a run-on "X · Y · Z" sentence — each number gets its own visual weight and color, easier to scan at a glance than a dense inline string. */
function StatChip({ label, value, tone }: { label: string; value: number; tone: keyof typeof statChipTones }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums", statChipTones[tone])}>
      {label} {value}
    </span>
  );
}
