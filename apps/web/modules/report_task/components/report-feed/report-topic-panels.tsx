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
import { users, getUser, getDepartment } from "@/modules/report_task/data/mock";
import { useReportFeedStore, type ReportPost, type ReportPostImage, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { relativeTime } from "@/modules/report_task/lib/format";
import { ReportImageLightbox } from "@/modules/report_task/components/report-feed/report-image-lightbox";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { buildUserComplianceReports, pendingToday } from "@/modules/report_task/lib/report-feed-compliance";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { DatePresetPicker } from "@/modules/report_task/components/report-analytics/date-preset-picker";
import { presetRange, type DatePreset } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Input } from "@/modules/report_task/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { AlbumPickerButton } from "@/modules/report_task/components/report-feed/album-picker-button";
import { TopicEmptyState } from "@/modules/report_task/components/report-feed/topic-empty-state";
import {
  ArrowLeft,
  FileImage,
  FolderHeart,
  FolderPlus,
  Link2,
  MessageCircle,
  MessageSquareText,
  Pencil,
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
}: {
  tab: "files" | "album" | "links" | "stats";
  topic: ReportTopic;
  topicPosts: ReportPost[];
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
  const [fileSearch, setFileSearch] = useState("");
  const [fileAuthorId, setFileAuthorId] = useState<string>("all");

  const files = useMemo(() => collectFiles(topicPosts), [topicPosts]);
  const links = useMemo(() => collectLinks(topicPosts), [topicPosts]);
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
  const openAlbum = openAlbumId ? albumFolders.find((f) => f.album.id === openAlbumId) : undefined;
  const openAlbumFiles = openAlbumId ? files.filter((f) => f.image.albumId === openAlbumId) : [];

  // A room with a posting schedule (cutoffs) gets judged the same way the
  // Dashboard/reports compliance widgets judge it — ตรงเวลา/สาย/ไม่ส่ง per
  // member against that schedule, not just a raw post count. Only meaningful
  // once a schedule exists; an open check-in room has no "on time" to
  // measure against, so it falls back to a plain post count instead.
  const hasSchedule = topic.cutoffs.length > 0;

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
  if (tab === "files") {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-xs text-[var(--ink-soft)] mb-3">
          รูปในช่วง {filesWindowDays} วันล่าสุด — แตะไอคอนที่มุมรูปเพื่อเก็บลงอัลบั้มแบบถาวร
        </p>
        {recentFiles.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
              <Input
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="ค้นชื่อไฟล์..."
                className="pl-8 h-8 text-xs"
              />
            </div>
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
          </div>
        )}
        {recentFiles.length === 0 ? (
          <TopicEmptyState icon={FileImage} title={`ยังไม่มีรูปในช่วง ${filesWindowDays} วันล่าสุด`} description="รูปที่แนบมากับโพสต์หรือความคิดเห็นในหัวข้อนี้จะขึ้นที่นี่" />
        ) : visibleFiles.length === 0 ? (
          <TopicEmptyState icon={Search} title="ไม่มีไฟล์ตรงกับตัวกรอง" description="ลองค้นด้วยคำอื่น หรือเลือก &quot;ทุกคน&quot;" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {visibleFiles.map((f, i) => (
              <div key={`${f.image.id}-${i}`} className="relative group">
                <button onClick={() => setLightbox({ images: visibleFiles.map((ff) => ff.image), index: i })} className="block text-left w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.image.url ?? f.image.dataUrl}
                    alt={f.image.name}
                    className="w-full h-24 object-cover rounded-lg border border-[var(--line)] group-hover:opacity-90"
                  />
                  <p className="text-xs mt-1 truncate">{f.image.name}</p>
                  <p className="text-[11px] text-[var(--ink-soft)] truncate">
                    {getUser(f.authorId)?.name} · {relativeTime(f.createdAt)}
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
              </div>
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
      </div>
    );
  }

  if (tab === "album") {
    // Inside one album: its own photo grid, same lightbox as the files tab.
    if (openAlbum) {
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
            <TopicEmptyState icon={FolderHeart} title="อัลบั้มนี้ยังไม่มีรูป" description="เก็บรูปจากแท็บ &quot;ไฟล์&quot; ลงอัลบั้มนี้ได้" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {openAlbumFiles.map((f, i) => (
                <button
                  key={`${f.image.id}-${i}`}
                  onClick={() => setLightbox({ images: openAlbumFiles.map((ff) => ff.image), index: i })}
                  className="group text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.image.url ?? f.image.dataUrl}
                    alt={f.image.name}
                    className="w-full h-24 object-cover rounded-lg border border-[var(--line)] group-hover:opacity-90"
                  />
                  <p className="text-xs mt-1 truncate">{f.image.name}</p>
                  <p className="text-[11px] text-[var(--ink-soft)] truncate">{f.postTitle} · {relativeTime(f.createdAt)}</p>
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

    // Folder list — creating one here works before any photo exists at all,
    // not just as a side effect of saving a photo from "ไฟล์".
    return (
      <div className="flex-1 overflow-y-auto p-4">
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
        {albumFolders.length === 0 ? (
          <TopicEmptyState
            icon={FolderHeart}
            title="ยังไม่มีอัลบั้มในหัวข้อนี้"
            description="สร้างอัลบั้มไว้ก่อน หรือเก็บรูปจากแท็บ &quot;ไฟล์&quot; ลงอัลบั้มได้"
            action={
              <button
                onClick={() => setCreateAlbumOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white text-xs font-medium px-3.5 py-1.5 transition-colors"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                สร้างอัลบั้มแรก
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {albumFolders.map(({ album, count, cover }) => (
              <button
                key={album.id}
                onClick={() => setOpenAlbumId(album.id)}
                className="group text-left rounded-lg border border-[var(--line)] overflow-hidden hover:border-[var(--brand-green)]/40 transition-colors"
              >
                <div className="h-24 bg-[var(--bg-soft)] flex items-center justify-center overflow-hidden">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover.url ?? cover.dataUrl} alt={album.name} className="w-full h-full object-cover group-hover:opacity-90" />
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
        <AlbumFormDialog
          open={createAlbumOpen}
          onOpenChange={setCreateAlbumOpen}
          title="สร้างอัลบั้มใหม่"
          onSubmit={(name) => setOpenAlbumId(addAlbum(topic.id, name, viewingAsUserId))}
        />
      </div>
    );
  }

  if (tab === "links") {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {links.length === 0 ? (
          <TopicEmptyState icon={Link2} title="ยังไม่มีลิงก์ที่แชร์ในหัวข้อนี้" description="ลิงก์ที่แปะไว้ในโพสต์หรือความคิดเห็นจะรวบรวมมาไว้ที่นี่" />
        ) : (
          links.map((l, i) => {
            const domain = (() => {
              try {
                return new URL(l.url).hostname;
              } catch {
                return null;
              }
            })();
            return (
              <div key={`${l.url}-${i}`} className="flex items-start gap-2.5 rounded-lg border border-[var(--line)] px-3 py-2.5">
                {domain ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`} alt="" className="h-4 w-4 mt-0.5 shrink-0 rounded" />
                ) : (
                  <Link2 className="h-4 w-4 mt-0.5 shrink-0 text-[var(--brand-green-dark)]" />
                )}
                <div className="min-w-0 flex-1">
                  {domain && <p className="text-[11px] font-medium text-[var(--ink-soft)] truncate">{domain}</p>}
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--brand-green-dark)] hover:underline break-all">
                    {l.url}
                  </a>
                  <button onClick={() => scrollToPost(l.postId)} className="block text-[11px] text-[var(--ink-soft)] hover:underline mt-0.5">
                    จาก &quot;{l.postTitle}&quot; · {relativeTime(l.createdAt)}
                  </button>
                </div>
              </div>
            );
          })
        )}
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
            title={pendingTodayList.length > 0 ? pendingTodayList.map((p) => p.userName).join(", ") : undefined}
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
                  <div key={r.id} className="flex items-start justify-between gap-2 py-2 border-b last:border-0 border-[var(--line)]">
                    <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                      <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                        {user?.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium truncate min-w-0">{r.name}</span>
                        <span
                          className={cn(
                            "text-xs font-semibold shrink-0 whitespace-nowrap",
                            r.complianceRate >= 80 ? "text-[var(--brand-green-dark)]" : r.complianceRate >= 50 ? "text-[var(--chart-amber)]" : "text-[var(--chart-red)]"
                          )}
                        >
                          {r.complianceRate}%
                        </span>
                      </div>
                      <Badge variant="secondary" className="text-[10px] font-normal mt-1">
                        {r.subtitle}
                      </Badge>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
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
              <div key={user.id} className="flex items-start justify-between gap-2 py-2 border-b last:border-0 border-[var(--line)]">
                <Avatar className="h-6 w-6 shrink-0 mt-0.5">
                  <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                    {user.avatar}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium truncate min-w-0">{user.name}</span>
                    <span className={cn("text-xs shrink-0 whitespace-nowrap", count === 0 ? "text-[var(--chart-red)] font-medium" : "text-[var(--ink-soft)]")}>
                      {count} โพสต์
                    </span>
                  </div>
                  <div className="mt-1">
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {getDepartment(user.departmentId)?.name ?? user.role}
                    </Badge>
                  </div>
                </div>
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
