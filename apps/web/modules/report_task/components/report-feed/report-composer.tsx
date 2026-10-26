"use client";

import { useEffect, useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { getUser, canManage } from "@/modules/report_task/lib/directory";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useReportFeedStore, type ReportPostImage, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useAttachmentSettingsStore } from "@/modules/report_task/store/attachment-settings-store";
import { uploadReportMedia } from "@/modules/report_task/lib/image-resize";
import { photoCount } from "@/modules/report_task/lib/report-attachment-kind";
import {
  roundsForUserOnDay,
  attributePostToRound,
  effectiveRoundsOf,
  attributionRounds,
  earlyRoundsForUserOnDay,
  earlyPostsForRound,
} from "@/modules/report_task/lib/submission-rounds";
import { useReportPenaltySettingsStore } from "@/modules/report_task/store/report-penalty-settings-store";
import { effectiveHardCutoffTime, isPastHardCutoff } from "@/modules/report_task/lib/report-cutoff";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { isExemptDate } from "@/modules/report_task/lib/report-feed-exemptions";
import { useReminderSettingsStore } from "@/modules/report_task/store/reminder-settings-store";
import { localDateStr, now } from "@/modules/report_task/lib/now";
import { cn } from "@/modules/report_task/lib/utils";
import { ReportPostFields, newSection, type DraftSection } from "@/modules/report_task/components/report-feed/report-post-fields";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Check, Clock, Lock, Maximize2, Minimize2, Send, SquarePen, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { uuid } from "@/modules/report_task/lib/uuid";
import { useRetroSubmitStore } from "@/modules/report_task/store/retro-submit-store";
import { useWorkerUi } from "@/modules/daily_worker/components/use-worker-ui";

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
  // คนงาน: ข้อความบนฟอร์มตามภาษาที่เลือก (พม่า/ไทย/อังกฤษ) · คนอื่นไทยเหมือนเดิม
  const { lang, t: wt } = useWorkerUi();
  // ยังไม่มีชื่อตัวเองในรายชื่อ (เพิ่งเปิดหน้า รายชื่อจริงยังโหลดไม่เสร็จ) — แสดงว่างไปก่อน ไม่ให้หน้าพัง
  const viewer = getUser(viewingAsUserId) ?? { name: "", avatar: "", avatarUrl: null };
  const addPost = useReportFeedStore((s) => s.addPost);
  const submitterGroups = useReportFeedStore((s) => s.submitterGroups);
  const allPosts = useReportFeedStore((s) => s.posts);
  const maxImages = useAttachmentSettingsStore((s) => s.settings.maxImagesPerReportPost);

  const savedDraft = loadDraft(topic.id);
  const [expanded, setExpanded] = useState(() => !!savedDraft);
  // ขยายฟอร์มเกือบเต็มจอ — รายงานยาว ๆ ในกรอบครึ่งจอ (ค่าเริ่ม) ต้องเลื่อนไปมาเยอะกว่าจะแก้ได้
  const [tall, setTall] = useState(false);
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
  // โหมดส่งย้อนหลัง — กด "ส่งย้อนหลัง" ที่แถบเหนือช่องนี้ (retro-submit-banner.tsx) หลัง CEO อนุมัติคำร้อง
  const retroTarget = useRetroSubmitStore((s) => s.target);
  const setRetroTarget = useRetroSubmitStore((s) => s.setTarget);
  const retro = retroTarget && retroTarget.topicId === topic.id ? retroTarget : null;
  const retroRound = retro ? (effectiveRoundsOf(topic).find((r) => r.id === retro.roundId) ?? null) : null;

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
    setRetroTarget(null);
    setExpanded(false);
    setTall(false);
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
  // company-wide actions with. Checked here but not returned early until
  // after every hook below (rules-of-hooks) — the late-toast effect has to
  // run on every render regardless of whether this topic ends up rendering
  // the locked notice instead of the real composer.
  const canPost = topic.postPermission !== "managersOnly" || canManage(viewingAsUserId);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    const available = Math.max(0, maxImages - images.length);
    if (files.length > available) {
      toast.error(`แนบได้สูงสุด ${maxImages} รูป/คลิปต่อโพสต์ — เลือกไว้เกิน ข้ามไป ${files.length - available} ไฟล์`);
    }
    setBusy(true);
    const next: ReportPostImage[] = [];
    try {
      for (const file of files.slice(0, available)) {
        const media = await uploadReportMedia(file);
        next.push({ id: `img-${uuid()}`, url: media.url, name: media.name, mime: media.mime, size: media.size, thumbUrl: media.thumbUrl ?? undefined });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "แนบไฟล์ไม่สำเร็จบางไฟล์ — ลองใหม่อีกครั้ง");
    } finally {
      // Keep whatever uploaded successfully before the failure — no reason
      // to throw away images that already finished just because a later one broke.
      if (next.length > 0) setImages((prev) => [...prev, ...next]);
      setBusy(false);
    }
  }

  const today = localDateStr(new Date());
  // A round this poster already has a post filed against today (attributed
  // by explicit roundId, or guessed from time when older) is done — showing
  // it again invited a second post to double up on the same round instead of
  // starting the next one, and there's no way to tell "genuinely posting
  // again for this round" apart from "picker just showed it out of habit"
  // ("ถ้าคนนั้นส่งไปแล้วต้องไม่มีให้เลือก...ยกเว้นยกเลิกโพสนั้นๆ"). Recomputed
  // live off the store's own posts, so deleting that post is all it takes
  // for the round to reappear here — no separate "undo" state to track.
  const allRoundsForAttribution = attributionRounds(
    roundsForUserOnDay(topic, viewingAsUserId, today, submitterGroups),
    effectiveRoundsOf(topic)
  );
  const myPostsToday = allPosts.filter(
    (p) => p.topicId === topic.id && p.authorId === viewingAsUserId && !p.excludeFromSubmission && localDateStr(new Date(p.createdAt)) === today
  );
  const fulfilledRoundIds = new Set(
    myPostsToday
      .map((p) => attributePostToRound(p, allRoundsForAttribution, myPostsToday)?.id)
      .filter((id): id is string => !!id)
  );
  // Scoped to this poster specifically (roundsForUserOnDay), not every round
  // the room runs that day (cutoffsOnDay) — a round someone isn't actually a
  // submitter of has no business showing up asking them "ส่งของรอบไหน?" when
  // it was never theirs to answer for ("ถ้าคนไม่มีรอบส่งนั้นตรงนี้ต้องไม่ขึ้น").
  // On leave/holiday/routine day-off today, this poster owes no round at
  // all — showing "ตอนนี้อยู่ในรอบ ..." here was misleading a viewer into
  // thinking a round was still due (this label is purely informational; the
  // composer stays open and postable regardless — see excludeFromSubmission
  // above), same exemption the room-sidebar hover status already honors.
  const complianceExemptions = useReportComplianceExemptions();
  const viewerExemptToday = isExemptDate(complianceExemptions, viewingAsUserId, today);
  const earlySubmitDays = useReportPenaltySettingsStore((s) => s.earlySubmitDays);
  const dueTodayCutoffs = viewerExemptToday
    ? []
    : [...roundsForUserOnDay(topic, viewingAsUserId, today, submitterGroups)]
        .filter((r) => !fulfilledRoundIds.has(r.id))
        // ส่งล่วงหน้าไปแล้ว = รอบนี้ของวันนี้ครบแล้ว ไม่ต้องให้เลือกอีก
        .filter((r) => earlyPostsForRound(allPosts, topic.id, viewingAsUserId, r, today, earlySubmitDays).length === 0)
        .sort((a, b) => roundMinutesOf(a.time) - roundMinutesOf(b.time));
  // ส่งล่วงหน้า: รอบรายสัปดาห์/รายเดือนที่ใกล้ครบกำหนด (ภายในจำนวนวันที่ตั้งไว้) และยังไม่ได้ส่งล่วงหน้า —
  // ต่อท้ายรอบของวันนี้ เลือกเองได้ ไม่ใช่ค่าเริ่มต้นถ้าวันนี้มีรอบที่ต้องส่งอยู่แล้ว
  const earlyDueById = new Map(
    earlyRoundsForUserOnDay(topic, viewingAsUserId, today, submitterGroups, earlySubmitDays)
      .filter(({ round, dueDay }) => earlyPostsForRound(allPosts, topic.id, viewingAsUserId, round, dueDay, earlySubmitDays).length === 0)
      .map(({ round, dueDay }) => [round.id, { round, dueDay }] as const)
  );
  const todayCutoffs = [...dueTodayCutoffs, ...[...earlyDueById.values()].map((e) => e.round)];
  const earlyDueLabel = (roundId: string) => {
    const due = earlyDueById.get(roundId)?.dueDay;
    if (!due) return null;
    const [, m, d] = due.split("-");
    return `${d}/${m}`;
  };
  const nowMinutes = now().getHours() * 60 + now().getMinutes();
  // Default pick: the nearest round not yet passed; once every round today
  // is overdue, default to the last one (someone opening the composer after
  // everything's closed is almost always filing the most recent miss, not
  // re-litigating the morning one).
  const defaultRoundId =
    dueTodayCutoffs.length === 0
      ? (todayCutoffs[0]?.id ?? null)
      : (dueTodayCutoffs.find((r) => roundMinutesOf(r.time) >= nowMinutes) ?? dueTodayCutoffs[dueTodayCutoffs.length - 1])!.id;
  const activeRoundId = selectedRoundId && todayCutoffs.some((r) => r.id === selectedRoundId) ? selectedRoundId : defaultRoundId;
  const activeRound = todayCutoffs.find((r) => r.id === activeRoundId) ?? null;
  // 1 round today → picked automatically, no picker shown (C4's own
  // acceptance criterion) — only 2+ rounds is genuinely ambiguous enough to
  // ask "ส่งของรอบไหน?" for.
  const showRoundPicker = todayCutoffs.length >= 2;
  // คำเตือนเรื่องรอบ (ไม่ได้เปลี่ยนว่าระบบเลือกรอบไหนให้ — ยังเป็นรอบถัดไปที่ยังไม่ปิด
  // เหมือนเดิม คนเลือกเอง) แต่ต้องเห็นชัดว่ากำลังจะนับเป็นอะไร:
  //  - รอบที่เลือกเลยเวลาแล้ว ⇒ โพสต์นี้นับเป็นส่งสาย
  //  - มีรอบก่อนหน้าที่เลยเวลาแล้วแต่ยังไม่ได้ส่ง ⇒ อาจเป็นรายงานของรอบนั้น (เจอจริง:
  //    รายงานเช้าโพสต์ 9:37 ระบบเลือกรอบ Evening ให้ คนโพสต์ไม่ทันเห็น — รอบเช้าเลย
  //    กลายเป็นขาดส่ง ทั้งที่ส่งแล้ว) — มีปุ่มสลับไปรอบนั้นได้ทันที
  const activeRoundEarlyDue = activeRound ? earlyDueLabel(activeRound.id) : null;
  const activeRoundLate = !!activeRound && !activeRoundEarlyDue && !excludeFromSubmission && nowMinutes > roundMinutesOf(activeRound.time);
  const missedEarlierRounds =
    activeRound && !activeRoundEarlyDue && !excludeFromSubmission
      ? dueTodayCutoffs.filter(
          (r) => r.id !== activeRound.id && roundMinutesOf(r.time) < roundMinutesOf(activeRound.time) && nowMinutes > roundMinutesOf(r.time)
        )
      : [];
  // Opting a post out of counting as the daily submission also drops the
  // round's own photo requirement — that requirement exists to make sure
  // "the report" actually has evidence attached, and this post was just
  // declared not to be that.
  const minImagesRequired = retro ? (retroRound?.minImages ?? 0) : excludeFromSubmission ? 0 : (activeRound?.minImages ?? 0);
  const missingRequiredImage = photoCount(images) < minImagesRequired;
  // Hard "ปิดรับ" deadline — unlike a round's own `time` (which only ever
  // badges a late post), this actually blocks the submit button once passed.
  // Skipped for a post opted out of counting as the report (a stray comment
  // isn't "the report" this deadline exists for) and for someone already
  // exempt today (leave/holiday/routine day off) — they owe nothing today
  // regardless of the clock, so there's nothing here to lock.
  const lockSettings = useReminderSettingsStore((s) => s.settings.submissionLock);
  const hardCutoff = effectiveHardCutoffTime(topic, lockSettings);
  // ส่งย้อนหลัง: ไม่ติดเวลาปิดรับของวันนี้ — ติดแค่กำหนดส่งย้อนหลัง (23:59 วันตัดรอบ)
  const retroExpired = !!retro && now().getTime() >= new Date(retro.retroDeadline).getTime();
  const submissionLocked = retro
    ? retroExpired
    : !excludeFromSubmission && !viewerExemptToday && !activeRoundEarlyDue && isPastHardCutoff(hardCutoff, nowMinutes);
  function doSubmit() {
    const cleanSections = sections
      .map((s) => ({
        id: s.id,
        heading: s.heading.trim(),
        bullets: s.bulletsText.split("\n").map((b) => b.trim()).filter(Boolean),
      }))
      .filter((s) => s.heading || s.bullets.length > 0);
    if (retro) {
      // ไม่นับเป็นรีพอตของวันนี้ (excludeFromSubmission) แต่นับเป็นของวัน/รอบที่ลืม (retroFor — report-retro.ts)
      addPost(topic.id, viewingAsUserId, {
        title: title.trim(),
        sections: cleanSections,
        images,
        tagIds,
        excludeFromSubmission: true,
        retroFor: { requestId: retro.id, day: retro.day, roundId: retro.roundId },
      });
      toast.success("ส่งรีพอตย้อนหลังแล้ว — ระบบคืนคะแนนให้ภายในไม่กี่นาที");
      reset();
      return;
    }
    addPost(topic.id, viewingAsUserId, {
      title: title.trim(),
      sections: cleanSections,
      images,
      tagIds,
      roundId: activeRound?.id,
      // Snapshotted now, at submission — see the field's own doc comment on
      // ReportPost. Without this, editing the round's time later silently
      // re-judges this post's ตรงเวลา/สาย badge against the NEW time forever
      // after, even though it was actually sent against the time in force
      // right now.
      roundTimeAtSubmission: activeRound?.time,
      excludeFromSubmission,
    });
    reset();
  }

  function handleSubmit() {
    if (!title.trim() || missingRequiredImage || submissionLocked) return;
    doSubmit();
  }

  if (!canPost) {
    return (
      <div className="shrink-0 border-t border-[var(--line)]/60 bg-[var(--bg-soft)]/60 px-5 py-3.5 flex items-center gap-2 text-sm text-[var(--ink-soft)]">
        <Lock className="h-4 w-4 shrink-0" />
        เฉพาะผู้ดูแลโพสต์ในหัวข้อนี้ได้
      </div>
    );
  }

  if (!expanded && !retro) {
    // A full-width, input-styled bar now, not a solid-green button off on
    // its own at the left — a colored CTA button reads as "an action to
    // take", when what's actually sitting here is the entry point to the
    // room's whole conversation ("ปุ่ม 'โพสต์ในหัวข้อนี้' ดูหลุดจาก
    // Layout"). Shaped like the real (collapsed) text field it's standing
    // in for, so it reads as "click here to type" the way an empty input
    // does anywhere else, with the brand color kept just on the leading
    // icon and the send affordance — not painted across the whole bar.
    return (
      <div data-hide-while-replying className="shrink-0 border-t border-[var(--line)]/60 bg-white px-5 py-3">
        <button
          data-tour="composer-trigger"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2.5 rounded-full border border-[var(--line)] bg-white pl-2 pr-3 py-2 text-left transition-colors hover:border-[var(--brand-green)]/50 hover:bg-[var(--bg-soft)]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)]">
            <SquarePen className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 text-sm text-[var(--ink-soft)]">{wt("writeReport")}</span>
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
      <div
        className={cn(
          "overflow-y-auto overscroll-contain px-5 pt-4 space-y-3",
          // เต็มจอ: เหลือที่ให้แถบบน + แถบปุ่มของฟอร์ม + เมนูล่างของมือถือ (dvh = หดตามคีย์บอร์ด)
          tall ? "h-[calc(100dvh-13rem)] lg:h-[calc(100dvh-9rem)]" : "max-h-[50vh]"
        )}
      >
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={viewer.avatarUrl ?? undefined} alt={viewer.name} />
            <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{viewer.avatar}</AvatarFallback>
          </Avatar>
          <p className="text-sm font-medium">{viewer.name}</p>
          {/* 1 round today → same plain info line as before (no choice to
              make). 2+ rounds → the picker below takes over saying which
              round, so this line would just repeat it. */}
          {!retro && !showRoundPicker && activeRound && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              <Clock className="h-3 w-3" />
              {activeRoundEarlyDue
                ? `ส่งล่วงหน้า "${activeRound.label}" (ครบกำหนด ${activeRoundEarlyDue})`
                : <>{wt("currentRound")} &quot;{activeRound.label}&quot; ({activeRound.time})</>}
              {minImagesRequired > 0 && ` · ${wt("minPhotos", { n: minImagesRequired })}`}
            </span>
          )}
        </div>

        {/* C4 — a room with 2+ rounds today can't have the round guessed
            from post time alone (10:00 could be "รอบ 9 สาย" or "รอบ 11
            ก่อนเวลา"), so the poster picks explicitly. Picking a round
            that's already past its own cutoff is allowed (ส่งย้อนหลัง) — it
            just badges late instead of blocking the post. */}
        {retro && (
          <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-900">
            <span className="min-w-0 flex-1">
              กำลังส่งรีพอต<b>ย้อนหลัง</b>ของวันที่ {retro.day}
              {retroRound ? ` รอบ "${retroRound.label}" (${retroRound.time})` : ""} · CEO อนุมัติแล้ว · ไม่นับเป็นรีพอตของวันนี้
              {minImagesRequired > 0 && ` · ต้องแนบรูปอย่างน้อย ${minImagesRequired} รูป`}
              {retroExpired && <b className="text-[var(--chart-red)]"> · เลยกำหนดส่งย้อนหลังแล้ว</b>}
            </span>
            <button
              type="button"
              onClick={() => setRetroTarget(null)}
              className="rounded-full border border-violet-300 bg-white px-2 py-0.5 font-semibold text-violet-900 hover:bg-violet-100"
            >
              ไม่ส่งย้อนหลัง
            </button>
          </div>
        )}

        {!retro && showRoundPicker && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-xs text-[var(--ink-soft)] shrink-0">
              <Clock className="h-3.5 w-3.5" />
              {wt("whichRound")}
            </span>
            {todayCutoffs.map((r) => {
              const earlyDue = earlyDueLabel(r.id);
              const late = !earlyDue && nowMinutes > roundMinutesOf(r.time);
              const selected = r.id === activeRoundId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoundId(r.id)}
                  // ข้อความเต็ม ("เลยรอบนี้แล้ว — เลือกได้ แต่จะนับว่าส่งย้อนหลัง
                  // = สาย") อยู่ใน title แทนตัวชิปเอง — บนตัวชิปเหลือแค่คำสั้นๆ
                  // + สีแดง/ไอคอน ไม่งั้นชิปยาวเกินจนกินพื้นที่แนวตั้งมากบนจอมือถือ
                  // ถึงจะ wrap ไม่ล้นจอก็ตาม
                  aria-pressed={selected}
                  title={late ? `${r.label} เลยเวลาปิดรอบแล้ว (${r.time}) — เลือกได้ แต่จะนับว่าส่งย้อนหลัง = สาย` : undefined}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    // เลือกอยู่ = พื้นทึบสีเข้ม + ตัวหนังสือขาว + ติ๊กถูก ต่างจาก
                    // ปุ่มเปล่าๆ ชัดเจนแบบ "กดปุ่มแล้วยุบลง" ไม่ใช่แค่ไล่เฉดสี
                    // อ่อน/เข้มที่คนละยุ่งดูออกยาก (เดิมของสองสถานะต่างกันแค่เฉด
                    // พื้นหลังจางๆ กับสีขอบ — บนจอมือถือแทบแยกไม่ออก)
                    selected
                      ? late
                        ? "border-transparent bg-[var(--chart-red)] text-white shadow-sm"
                        : "border-transparent bg-[var(--brand-green)] text-white shadow-sm"
                      : late
                        ? "border-red-200 bg-red-50/70 text-[var(--chart-red)] hover:bg-red-50"
                        : "border-[var(--line)] bg-white text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                  )}
                >
                  {selected ? <Check className="h-3 w-3 shrink-0" strokeWidth={3} /> : late && <TriangleAlert className="h-3 w-3 shrink-0" />}
                  {earlyDue ? `${r.label} · ส่งล่วงหน้า (ครบ ${earlyDue})` : `${r.label} (${r.time})`}
                  {late && <b className="font-semibold">&nbsp;· {wt("late")}</b>}
                </button>
              );
            })}
            {minImagesRequired > 0 && <span className="text-xs text-[var(--ink-soft)]">· {wt("minPhotos", { n: minImagesRequired })}</span>}
          </div>
        )}

        {!retro && (missedEarlierRounds.length > 0 || activeRoundLate) && activeRound && (
          <div role="status" className="flex flex-col gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {missedEarlierRounds.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                <span>
                  ยังไม่ได้ส่ง <b>&quot;{r.label}&quot;</b> ({r.time}) — ถ้าโพสต์นี้เป็นรายงานของรอบนั้น
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRoundId(r.id)}
                  className="rounded-full border border-amber-400 bg-white px-2 py-0.5 font-semibold text-amber-900 hover:bg-amber-100"
                >
                  เลือก &quot;{r.label}&quot;
                </button>
                <span className="text-amber-800/80">(จะนับเป็นส่งสาย)</span>
              </div>
            ))}
            {activeRoundLate && (
              <div className="flex items-center gap-1.5">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                {lang === "th" ? (
                  <span>
                    โพสต์นี้จะนับเป็น<b>ส่งสาย</b>ของ &quot;{activeRound.label}&quot; — เลยเวลา {activeRound.time} แล้ว
                  </span>
                ) : (
                  <span>{wt("lateRoundWarn", { round: activeRound.label, time: activeRound.time })}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Only meaningful in a room that actually tracks a schedule — an
            untracked room has no "counts toward daily" obligation to opt a
            post out of in the first place. The wording spells out the actual
            consequence (ถูกนับว่ายังไม่ส่ง) instead of just naming the
            mechanism — a poster who ticked this not realizing it could make
            them show up as "ขาดส่ง" on the dashboard (a real post, on time,
            with content and photos, still counted as a missed report) had no
            way to tell from "ไม่นับเป็นการส่งรีพอต" alone that this is what
            it meant, since that phrase alone reads as neutral/technical
            rather than as a warning. */}
        {!retro && todayCutoffs.length > 0 && (
          <div className="w-fit">
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)] cursor-pointer">
              <Checkbox
                checked={excludeFromSubmission}
                onCheckedChange={(v) => setExcludeFromSubmission(v === true)}
                className="h-3.5 w-3.5"
              />
              {wt("notTodayReport")}
            </label>
            {excludeFromSubmission && (
              <p className="mt-1 pl-5 text-[10.5px] text-[var(--chart-red)]">
                จะถูกนับว่า &quot;ยังไม่ส่งรีพอตวันนี้&quot; ในแดชบอร์ด แม้โพสต์นี้จะมีเนื้อหาก็ตาม
              </p>
            )}
          </div>
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
          busy={busy}
          onFilesSelected={handleFiles}
          onEnterSubmit={() => {
            if (!busy) handleSubmit();
          }}
        />
      </div>

      <div className="flex items-center justify-end gap-2.5 px-5 py-3 mt-1 border-t border-[var(--line)]/60 bg-[var(--bg-soft)]/40">
        {/* อยู่แถบล่างที่มองเห็นตลอด (หัวฟอร์มเลื่อนหายได้) */}
        <button
          type="button"
          onClick={() => setTall((v) => !v)}
          aria-pressed={tall}
          aria-label={tall ? "ย่อฟอร์ม" : "ขยายฟอร์มเต็มจอ"}
          title={tall ? "ย่อฟอร์ม" : "ขยายฟอร์มเต็มจอ — เห็นข้อความได้มากขึ้น"}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
        >
          {tall ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          <span className="hidden sm:inline">{tall ? wt("collapse") : wt("expand")}</span>
        </button>
        {/* คอมเท่านั้น (มือถือ Enter = ขึ้นบรรทัด) — บอกให้รู้ว่า Enter โพสต์เลย */}
        <span className="mr-auto hidden min-w-0 truncate text-[11px] text-[var(--ink-faint)] [@media(hover:hover)]:inline">{wt("enterHint")}</span>
        {/* P3 — why the button's disabled, not just that it is. */}
        {!busy && (!title.trim() || missingRequiredImage || submissionLocked) && (
          <p className="min-w-0 truncate text-xs text-[var(--ink-soft)]">
            {submissionLocked
              ? wt("closedToday", { time: hardCutoff ?? "" })
              : !title.trim()
                ? wt("needTitle")
                : wt("needPhotos", { n: minImagesRequired - photoCount(images) })}
          </p>
        )}
        <Button data-tour="composer-cancel" variant="ghost" size="lg" onClick={reset} className="text-[var(--ink-soft)]">
          {wt("cancel")}
        </Button>
        <Button
          size="lg"
          className="rounded-lg px-5 gap-1.5 bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white disabled:opacity-40 transition-transform active:scale-[0.99]"
          disabled={!title.trim() || missingRequiredImage || busy || submissionLocked}
          onClick={handleSubmit}
          title={
            submissionLocked
              ? `ปิดรับรายงานของวันนี้แล้ว (หลัง ${hardCutoff} น.)`
              : !title.trim()
                ? wt("needTitle")
                : missingRequiredImage
                  ? wt("needPhotos", { n: minImagesRequired - photoCount(images) })
                  : undefined
          }
        >
          <Send className="h-4 w-4" />
          {wt("post")} {/* Ctrl/⌘+Enter also submits (P4) — see the keydown handler on the title input below. */}
        </Button>
      </div>
    </div>
  );
}
