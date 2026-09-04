"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { getUser, canManage } from "@/modules/report_task/lib/directory";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useReportFeedStore, type ReportPostImage, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useAttachmentSettingsStore } from "@/modules/report_task/store/attachment-settings-store";
import { uploadReportMedia } from "@/modules/report_task/lib/image-resize";
import { photoCount } from "@/modules/report_task/lib/report-attachment-kind";
import { cutoffsOnDay } from "@/modules/report_task/lib/report-cutoff";
import { localDateStr, now } from "@/modules/report_task/lib/now";
import { cn } from "@/modules/report_task/lib/utils";
import { ReportPostFields, newSection, type DraftSection } from "@/modules/report_task/components/report-feed/report-post-fields";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Clock, Lock, Send, SquarePen } from "lucide-react";
import { toast } from "sonner";

function roundMinutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

// A room's own starter sections (Phase 6 "เทมเพลตโพสต์") pre-fill a brand-new
// draft's headings — bullets stay for the poster to fill in themselves.
function initialSections(topic: ReportTopic): DraftSection[] {
  if (!topic.postTemplateSections || topic.postTemplateSections.length === 0) return [newSection()];
  return topic.postTemplateSections.map((s) => ({ ...newSection(), heading: s.heading }));
}

interface StoredDraft {
  title: string;
  sections: DraftSection[];
  images: ReportPostImage[];
  tagIds: string[];
}

function draftStorageKey(topicId: string): string {
  return `report-draft:${topicId}`;
}

// A refresh used to unmount this component with whatever the user was
// mid-typing still only in memory — gone with no recovery
// ("รีเฟชละข้อมูลที่จะกรอกหายหมดเลย"). sessionStorage survives a reload
// (unlike plain state) while still clearing itself once the tab closes, so
// an abandoned draft doesn't linger forever in a shared browser profile.
function loadDraft(topicId: string): StoredDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(topicId));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

export function ReportComposer({ topic }: { topic: ReportTopic }) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const viewer = getUser(viewingAsUserId)!;
  const addPost = useReportFeedStore((s) => s.addPost);
  const maxImages = useAttachmentSettingsStore((s) => s.settings.maxImagesPerReportPost);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const savedDraft = loadDraft(topic.id);
  const [expanded, setExpanded] = useState(() => !!savedDraft);
  const [title, setTitle] = useState(() => savedDraft?.title ?? "");
  const [sections, setSections] = useState<DraftSection[]>(() => savedDraft?.sections ?? initialSections(topic));
  const [images, setImages] = useState<ReportPostImage[]>(() => savedDraft?.images ?? []);
  const [tagIds, setTagIds] = useState<string[]>(() => savedDraft?.tagIds ?? []);
  const [busy, setBusy] = useState(false);
  // Which round (C4) the poster explicitly chose — null means "not chosen
  // yet, use the default" (nearest round not yet passed, or the last one if
  // every round today is already overdue). Reset on room switch/post/cancel
  // (reset() below) so a stale pick from a previous room's rounds can't leak
  // into this one.
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  // "ไม่นับเป็นการส่ง daily" — a real post (still shows in the feed like any
  // other), just not counted toward this round's compliance. For a casual
  // update/question that isn't "the report" itself, so it doesn't need to
  // be buried as a reply just to avoid getting scored.
  const [excludeFromSubmission, setExcludeFromSubmission] = useState(false);

  // Keeps sessionStorage in sync with every keystroke/attachment change so a
  // reload has something to restore — cleared once the draft is either
  // posted or explicitly cancelled (reset() below) rather than left behind
  // as a stale entry that would keep reappearing on the next visit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isEmpty = !title.trim() && images.length === 0 && tagIds.length === 0 && sections.every((s) => !s.heading.trim() && !s.bulletsText.trim());
    try {
      if (isEmpty) {
        window.sessionStorage.removeItem(draftStorageKey(topic.id));
      } else {
        window.sessionStorage.setItem(draftStorageKey(topic.id), JSON.stringify({ title, sections, images, tagIds }));
      }
    } catch {
      // Storage full/unavailable (private browsing) — the draft just won't
      // survive a reload, same as before this feature existed.
    }
  }, [topic.id, title, sections, images, tagIds]);

  function reset() {
    setTitle("");
    setSections(initialSections(topic));
    setImages([]);
    setTagIds([]);
    setSelectedRoundId(null);
    setExcludeFromSubmission(false);
    setExpanded(false);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(draftStorageKey(topic.id));
      } catch {
        // ignore
      }
    }
  }

  // "ใครโพสต์ได้" (Phase 6) — announcement/policy rooms can lock posting to
  // managers/owner only, same population canManage already gates other
  // company-wide actions with.
  const canPost = topic.postPermission !== "managersOnly" || canManage(viewingAsUserId);
  if (!canPost) {
    return (
      <div className="shrink-0 border-t border-[var(--line)]/60 bg-[var(--bg-soft)]/60 px-5 py-3.5 flex items-center gap-2 text-sm text-[var(--ink-soft)]">
        <Lock className="h-4 w-4 shrink-0" />
        เฉพาะผู้ดูแลโพสต์ในหัวข้อนี้ได้
      </div>
    );
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const available = Math.max(0, maxImages - images.length);
    if (files.length > available) {
      toast.error(`แนบได้สูงสุด ${maxImages} รูป/คลิปต่อโพสต์ — เลือกไว้เกิน ข้ามไป ${files.length - available} ไฟล์`);
    }
    setBusy(true);
    const next: ReportPostImage[] = [];
    try {
      for (const file of Array.from(files).slice(0, available)) {
        const media = await uploadReportMedia(file);
        next.push({ id: `img-${crypto.randomUUID()}`, url: media.url, name: media.name, mime: media.mime, size: media.size });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "แนบไฟล์ไม่สำเร็จบางไฟล์ — ลองใหม่อีกครั้ง");
    } finally {
      // Keep whatever uploaded successfully before the failure — no reason
      // to throw away images that already finished just because a later one broke.
      if (next.length > 0) setImages((prev) => [...prev, ...next]);
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const todayCutoffs = [...cutoffsOnDay(topic, localDateStr(new Date()))].sort(
    (a, b) => roundMinutesOf(a.time) - roundMinutesOf(b.time)
  );
  const nowMinutes = now().getHours() * 60 + now().getMinutes();
  // Default pick: the nearest round not yet passed; once every round today
  // is overdue, default to the last one (someone opening the composer after
  // everything's closed is almost always filing the most recent miss, not
  // re-litigating the morning one).
  const defaultRoundId =
    todayCutoffs.length === 0
      ? null
      : (todayCutoffs.find((r) => roundMinutesOf(r.time) >= nowMinutes) ?? todayCutoffs[todayCutoffs.length - 1])!.id;
  const activeRoundId = selectedRoundId && todayCutoffs.some((r) => r.id === selectedRoundId) ? selectedRoundId : defaultRoundId;
  const activeRound = todayCutoffs.find((r) => r.id === activeRoundId) ?? null;
  // 1 round today → picked automatically, no picker shown (C4's own
  // acceptance criterion) — only 2+ rounds is genuinely ambiguous enough to
  // ask "ส่งของรอบไหน?" for.
  const showRoundPicker = todayCutoffs.length >= 2;
  // Opting a post out of counting as the daily submission also drops the
  // round's own photo requirement — that requirement exists to make sure
  // "the report" actually has evidence attached, and this post was just
  // declared not to be that.
  const minImagesRequired = excludeFromSubmission ? 0 : (activeRound?.minImages ?? topic.minImages);
  const missingRequiredImage = photoCount(images) < minImagesRequired;

  function handleSubmit() {
    if (!title.trim() || missingRequiredImage) return;
    const cleanSections = sections
      .map((s) => ({
        id: s.id,
        heading: s.heading.trim(),
        bullets: s.bulletsText.split("\n").map((b) => b.trim()).filter(Boolean),
      }))
      .filter((s) => s.heading || s.bullets.length > 0);
    addPost(topic.id, viewingAsUserId, {
      title: title.trim(),
      sections: cleanSections,
      images,
      tagIds,
      roundId: activeRound?.id,
      excludeFromSubmission,
    });
    reset();
  }

  if (!expanded) {
    // A full-width, input-styled bar now, not a solid-green button off on
    // its own at the left — a colored CTA button reads as "an action to
    // take", when what's actually sitting here is the entry point to the
    // room's whole conversation ("ปุ่ม 'โพสต์ในหัวข้อนี้' ดูหลุดจาก
    // Layout"). Shaped like the real (collapsed) text field it's standing
    // in for, so it reads as "click here to type" the way an empty input
    // does anywhere else, with the brand color kept just on the leading
    // icon and the send affordance — not painted across the whole bar.
    return (
      <div className="shrink-0 border-t border-[var(--line)]/60 bg-white px-5 py-3">
        <button
          data-tour="composer-trigger"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2.5 rounded-full border border-[var(--line)] bg-white pl-2 pr-3 py-2 text-left transition-colors hover:border-[var(--brand-green)]/50 hover:bg-[var(--bg-soft)]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)]">
            <SquarePen className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 text-sm text-[var(--ink-soft)]">เขียนรายงานหรือข้อความ...</span>
          <Send className="h-4 w-4 shrink-0 text-[var(--ink-faint)]" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 border-t border-[var(--line)]/60 bg-white overflow-hidden"
      // P4 — Ctrl/⌘+Enter submits from anywhere in the composer (title,
      // section bullets, ...), same shortcut as the reply box's plain Enter.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy) {
          e.preventDefault();
          handleSubmit();
        }
      }}
    >
      <div className="max-h-[50vh] overflow-y-auto px-5 pt-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{viewer.avatar}</AvatarFallback>
          </Avatar>
          <p className="text-sm font-medium">{viewer.name}</p>
          {/* 1 round today → same plain info line as before (no choice to
              make). 2+ rounds → the picker below takes over saying which
              round, so this line would just repeat it. */}
          {!showRoundPicker && activeRound && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              <Clock className="h-3 w-3" />
              ตอนนี้อยู่ในรอบ &quot;{activeRound.label}&quot; ({activeRound.time})
              {minImagesRequired > 0 && ` · ต้องแนบรูปอย่างน้อย ${minImagesRequired} รูป`}
            </span>
          )}
        </div>

        {/* C4 — a room with 2+ rounds today can't have the round guessed
            from post time alone (10:00 could be "รอบ 9 สาย" or "รอบ 11
            ก่อนเวลา"), so the poster picks explicitly. Picking a round
            that's already past its own cutoff is allowed (ส่งย้อนหลัง) — it
            just badges late instead of blocking the post. */}
        {showRoundPicker && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-xs text-[var(--ink-soft)] shrink-0">
              <Clock className="h-3.5 w-3.5" />
              ส่งของรอบไหน?
            </span>
            {todayCutoffs.map((r) => {
              const late = nowMinutes > roundMinutesOf(r.time);
              const selected = r.id === activeRoundId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoundId(r.id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    selected
                      ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
                      : "border-[var(--line)] bg-white text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                  )}
                >
                  {r.label} ({r.time}){late && " · ส่งย้อนหลัง = สาย"}
                </button>
              );
            })}
            {minImagesRequired > 0 && <span className="text-xs text-[var(--ink-soft)]">· ต้องแนบรูปอย่างน้อย {minImagesRequired} รูป</span>}
          </div>
        )}

        {/* Only meaningful in a room that actually tracks a schedule — an
            untracked room has no "counts toward daily" obligation to opt a
            post out of in the first place. */}
        {todayCutoffs.length > 0 && (
          <label
            className="flex w-fit items-center gap-1.5 text-[11px] text-[var(--ink-soft)] cursor-pointer"
            title="เช่น ถาม/แจ้งอัปเดตเฉยๆ ไม่ใช่รายงานจริง"
          >
            <Checkbox
              checked={excludeFromSubmission}
              onCheckedChange={(v) => setExcludeFromSubmission(v === true)}
              className="h-3.5 w-3.5"
            />
            โพสต์นี้ไม่นับเป็นการส่ง daily
          </label>
        )}

        <ReportPostFields
          topicId={topic.id}
          title={title}
          onTitleChange={setTitle}
          sections={sections}
          onSectionsChange={setSections}
          images={images}
          onImagesChange={setImages}
          tagIds={tagIds}
          onTagIdsChange={setTagIds}
          minImages={minImagesRequired}
          fileInputRef={fileInputRef}
          busy={busy}
          onFilesSelected={handleFiles}
        />
      </div>

      <div className="flex items-center justify-end gap-2.5 px-5 py-3 mt-1 border-t border-[var(--line)]/60 bg-[var(--bg-soft)]/40">
        {/* P3 — why the button's disabled, not just that it is. */}
        {!busy && (!title.trim() || missingRequiredImage) && (
          <p className="text-xs text-[var(--ink-soft)] mr-auto">
            {!title.trim() ? "ต้องมีหัวข้อ" : `ต้องแนบรูปอีก ${minImagesRequired - photoCount(images)} รูป`}
          </p>
        )}
        <Button data-tour="composer-cancel" variant="ghost" size="lg" onClick={reset} className="text-[var(--ink-soft)]">
          ยกเลิก
        </Button>
        <Button
          size="lg"
          className="rounded-lg px-5 gap-1.5 bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white disabled:opacity-40 transition-transform active:scale-[0.99]"
          disabled={!title.trim() || missingRequiredImage || busy}
          onClick={handleSubmit}
          title={!title.trim() ? "ต้องมีหัวข้อ" : missingRequiredImage ? `ต้องแนบรูปอีก ${minImagesRequired - photoCount(images)} รูป` : undefined}
        >
          <Send className="h-4 w-4" />
          โพสต์ {/* Ctrl/⌘+Enter also submits (P4) — see the keydown handler on the title input below. */}
        </Button>
      </div>
    </div>
  );
}
