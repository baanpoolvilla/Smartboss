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
import { ReportTopicDocuments } from "@/modules/report_task/components/report-feed/report-topic-documents";
import { ReportMediaThumb } from "@/modules/report_task/components/report-feed/report-media-thumb";
import { users, getUser, getDepartment } from "@/modules/report_task/lib/directory";
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
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Input } from "@/modules/report_task/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { AlbumPickerButton } from "@/modules/report_task/components/report-feed/album-picker-button";
import { SaveToDocumentsButton } from "@/modules/report_task/components/report-feed/save-to-documents-button";
import { ReportFileChip } from "@/modules/report_task/components/report-feed/report-file-chip";
import { PinLinkDialog } from "@/modules/report_task/components/report-feed/pin-link-dialog";
import { isDocAttachment } from "@/modules/report_task/lib/report-attachment-kind";
import { TopicEmptyState } from "@/modules/report_task/components/report-feed/topic-empty-state";
import { TimeAgo } from "@/modules/report_task/components/shared/time-ago";
import {
  ArrowLeft,
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
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Trophy,
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
  postId: string;
  postTitle: string;
  createdAt: string;
  authorId: string;
}

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
}: {
  tab: "files" | "stats";
  topic: ReportTopic;
  topicPosts: ReportPost[];
  /** Which filter the "ไฟล์" tab opens on — set by a legacy `?tab=album` /
   * `?tab=links` deep link (see fileFilterForLegacyTab), "all" otherwise. */
  initialFileFilter?: FileFilter;
}) {
  const [lightbox, setLightbox] = useState<{ images: ReportPostImage[]; index: number } | null>(null);
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
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
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
  const [fileFilter, setFileFilter] = useState<FileFilter>(initialFileFilter ?? "all");

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
  const recentFiles = useMemo(() => {
    const cutoff = filesCutoffMs(filesWindowDays);
    return files.filter((f) => new Date(f.createdAt).getTime() >= cutoff);
  }, [files, filesWindowDays]);
  const fileAuthorOptions = useMemo(
    () => [...new Set(recentFiles.map((f) => f.authorId))].map((id) => getUser(id)).filter((u): u is NonNullable<typeof u> => !!u),
    [recentFiles]
  );
  const visibleFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    return recentFiles.filter((f) => {
      if (fileAuthorId !== "all" && f.authorId !== fileAuthorId) return false;
      if (q && !f.image.name.toLowerCase().includes(q) && !f.postTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [recentFiles, fileSearch, fileAuthorId]);
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
        return { album: a, count: inAlbum.length, cover: inAlbum[0]?.image };
      }),
    [albums, files]
  );
  const visibleAlbumFolders = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return albumFolders;
    return albumFolders.filter((f) => f.album.name.toLowerCase().includes(q));
  }, [albumFolders, fileSearch]);
  const openAlbum = openAlbumId ? albumFolders.find((f) => f.album.id === openAlbumId) : undefined;
  const openAlbumFiles = openAlbumId ? files.filter((f) => f.image.albumId === openAlbumId) : [];

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
      const complianceRows = buildUserComplianceReports([topic], topicPosts, range, exemptions)
        .filter((r) => r.roomsCount > 0)
        .sort((a, b) => b.complianceRate - a.complianceRate || a.name.localeCompare(b.name));
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
  function imageCell(f: FileEntry, index: number) {
    return (
      <div key={`${f.image.id}-${index}`} className="relative group">
        <button onClick={() => setLightbox({ images: visibleImages.map((ff) => ff.image), index })} className="block text-left w-full">
          <ReportMediaThumb media={f.image} className="w-full h-24 object-cover rounded-lg border border-[var(--line)] group-hover:opacity-90" />
          <p className="text-xs mt-1 truncate">{f.image.name}</p>
          <p className="text-[11px] text-[var(--ink-soft)] truncate">
            {getUser(f.authorId)?.name} · <TimeAgo date={f.createdAt} />
          </p>
        </button>
        <div className="absolute top-1 left-1">
          <AlbumPickerButton
            topicId={topic.id}
            imageName={f.image.name}
            albumId={f.image.albumId}
            onChange={(albumId) => setImageAlbum(f.postId, f.image.id, albumId)}
          />
        </div>
        <div className="absolute top-1 right-1">
          <SaveToDocumentsButton topicId={topic.id} topicName={topic.name} file={f.image} />
        </div>
      </div>
    );
  }

  /** A pdf/xlsx attached to a post — a row, not a tile: the filename is the
   * only thing that identifies it, so it gets the width. Opens the real file
   * in a new tab; the same "เพิ่มเข้าไฟล์ทั้งหมดของห้องนี้" button the photos
   * have sits at the end. */
  function docRow(f: FileEntry, key: string) {
    return (
      <div key={key} className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] px-2.5 py-2">
        <ReportFileChip media={f.image} variant="icon" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <a
            href={f.image.url ?? f.image.dataUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium hover:text-[var(--brand-green-dark)] hover:underline"
          >
            {f.image.name}
          </a>
          <button onClick={() => scrollToPost(f.postId)} className="block max-w-full truncate text-[11px] text-[var(--ink-soft)] hover:underline">
            จาก &quot;{f.postTitle}&quot; · {getUser(f.authorId)?.name} · <TimeAgo date={f.createdAt} />
          </button>
        </div>
        <div className="shrink-0">
          <SaveToDocumentsButton topicId={topic.id} topicName={topic.name} file={f.image} variant="row" />
        </div>
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
            description={fileSearch.trim() ? "ลองค้นด้วยคำอื่น" : "สร้างอัลบั้มไว้ก่อน หรือเก็บรูปจากตัวกรอง “รูปภาพ” ลงอัลบั้มได้"}
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

  if (tab === "files") {
    // Inside one album the filter row steps aside entirely — you're in a
    // folder now, and the way out is its own back button, same as before
    // this was a filter rather than a tab of its own.
    if (fileFilter === "albums" && openAlbum) {
      return (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <button
              onClick={() => setOpenAlbumId(null)}
              className="flex items-center gap-1.5 text-sm font-semibold hover:text-[var(--brand-green-dark)]"
            >
              <ArrowLeft className="h-4 w-4" />
              {openAlbum.album.name}
              <span className="text-xs font-normal text-[var(--ink-soft)]">({openAlbum.count})</span>
            </button>
            <div className="flex items-center gap-1">
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
          {openAlbumFiles.length === 0 ? (
            <TopicEmptyState icon={FolderHeart} title="อัลบั้มนี้ยังไม่มีรูป" description="เก็บรูปจากตัวกรอง &quot;รูปภาพ&quot; ลงอัลบั้มนี้ได้" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {openAlbumFiles.map((f, i) => (
                <button
                  key={`${f.image.id}-${i}`}
                  onClick={() => setLightbox({ images: openAlbumFiles.map((ff) => ff.image), index: i })}
                  className="group text-left"
                >
                  <ReportMediaThumb
                    media={f.image}
                    className="w-full h-24 object-cover rounded-lg border border-[var(--line)] group-hover:opacity-90"
                  />
                  <p className="text-xs mt-1 truncate">{f.image.name}</p>
                  <p className="text-[11px] text-[var(--ink-soft)] truncate">{f.postTitle} · <TimeAgo date={f.createdAt} /></p>
                </button>
              ))}
            </div>
          )}
          {lightbox && (
            <ReportImageLightbox
              images={lightbox.images}
              index={lightbox.index}
              onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
              onClose={() => setLightbox(null)}
            />
          )}
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
                <AlertDialogDescription>รูปที่อยู่ในอัลบั้มนี้จะไม่ถูกลบ แค่ไม่ได้อยู่ในอัลบั้มนี้อีกต่อไป — ยังดูได้ในโพสต์เดิม</AlertDialogDescription>
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
      );
    }

    const hasAnything = recentFiles.length + links.length + pinnedLinks.length + albumFolders.length > 0;

    return (
      <div className="flex-1 overflow-y-auto p-4">
        {/* One search box for the whole tab, above the filter row rather than
            inside any one filter — a filename, a link's name and an album
            name are all "something I put in this room", so there's no reason
            to make people find a different box for each. The uploader
            dropdown only narrows things that have an uploader (photos and
            documents), so it hides on the link/album filters. */}
        {hasAnything && (
          <div className="flex items-center gap-2 flex-wrap mb-2.5">
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
          </div>
        )}

        {/* Segmented control, scroll-x on a phone rather than wrapping into a
            second row that shifts everything below it. */}
        <div role="tablist" aria-label="ชนิดของไฟล์" className="no-scrollbar -mx-1 mb-3 flex items-center gap-1 overflow-x-auto px-1">
          {fileFilterOptions.map((opt) => {
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

        {fileFilter === "images" && (
          <>
            <p className="text-xs text-[var(--ink-soft)] mb-3">
              รูป/คลิปในช่วง {filesWindowDays} วันล่าสุด — แตะไอคอนที่มุมรูปเพื่อเก็บลงอัลบั้มแบบถาวร
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
            {/* The room's real document library first — it's the permanent
                half, unlike post attachments which age out of the window
                above. Used to sit at the top of this tab regardless of what
                you came here for, which is what made "ไฟล์" confusing. */}
            <ReportTopicDocuments topicId={topic.id} topicName={topic.name} search={fileSearch} />
            <div className="space-y-1.5">
              {sectionHeading("เอกสารที่แนบในโพสต์", visibleDocs.length)}
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
            {/* The room's own permanent file library (company-files) isn't
                a documents-only shelf — its upload picker and the "เพิ่มเข้า
                ไฟล์ทั้งหมดของห้องนี้" button on any thumbnail both accept any
                file kind, photos and clips included. Nesting it only under
                the "เอกสาร" filter (as the "docs" branch below still does,
                for whoever specifically wants the library view) meant a
                photo saved there was invisible from "ทั้งหมด" and "รูปภาพ"
                both — surfacing it here too, unconditionally like "docs"
                does, so nothing saved into it goes missing from the one
                filter meant to show everything. */}
            <ReportTopicDocuments topicId={topic.id} topicName={topic.name} search={fileSearch} />
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
            images={lightbox.images}
            index={lightbox.index}
            onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
            onClose={() => setLightbox(null)}
          />
        )}
        <AlbumFormDialog
          open={createAlbumOpen}
          onOpenChange={setCreateAlbumOpen}
          title="สร้างอัลบั้มใหม่"
          onSubmit={(name) => setOpenAlbumId(addAlbum(topic.id, name, viewingAsUserId))}
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
          {/* Only meaningful once there's a schedule to be "on time" against
              — the plain-post-count fallback for open rooms has no date
              window to narrow, so it stays hidden there. */}
          {hasSchedule && (
            <DatePresetPicker
              preset={preset}
              customFrom={customFrom}
              customTo={customTo}
              onPresetChange={setPreset}
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
            <div>
              {stats.complianceRows.map((r) => {
                const user = getUser(r.id);
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0 border-[var(--line)]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-6 w-6 shrink-0">
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
                        className={cn(
                          "text-xs font-semibold tabular-nums whitespace-nowrap",
                          r.complianceRate >= 80 ? "text-[var(--brand-green-dark)]" : r.complianceRate >= 50 ? "text-[var(--chart-amber)]" : "text-[var(--chart-red)]"
                        )}
                      >
                        {r.complianceRate}%
                      </span>
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        <StatChip label="ตรงเวลา" value={r.onTime} tone="green" />
                        {r.late > 0 && <StatChip label="สาย" value={r.late} tone="amber" />}
                        {r.missed > 0 && <StatChip label="ไม่ส่ง" value={r.missed} tone="red" />}
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
          <div>
            {stats.contributors.map(({ user, count }) => (
              <div key={user.id} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0 border-[var(--line)]">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                      {user.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium truncate">{user.name}</span>
                  <Badge variant="secondary" className="text-[10px] font-normal shrink-0 hidden sm:inline-flex">
                    {getDepartment(user.departmentId)?.name ?? user.role}
                  </Badge>
                </div>
                <span className={cn("text-xs tabular-nums shrink-0 whitespace-nowrap", count === 0 ? "text-[var(--chart-red)] font-medium" : "text-[var(--ink-soft)]")}>
                  {count} โพสต์
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
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
} as const;

/** One ตรงเวลา/สาย/ไม่ส่ง/แนบรูปไม่ครบ figure as its own small pill instead of a run-on "X · Y · Z" sentence — each number gets its own visual weight and color, easier to scan at a glance than a dense inline string. */
function StatChip({ label, value, tone }: { label: string; value: number; tone: keyof typeof statChipTones }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums", statChipTones[tone])}>
      {label} {value}
    </span>
  );
}
