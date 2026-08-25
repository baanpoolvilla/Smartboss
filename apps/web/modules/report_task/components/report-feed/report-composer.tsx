"use client";

import { useRef, useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { getUser, canManage } from "@/modules/report_task/lib/directory";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useReportFeedStore, type ReportPostImage, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { uploadCompressedImage } from "@/modules/report_task/lib/image-resize";
import { currentCutoff, minImagesNow } from "@/modules/report_task/lib/report-cutoff";
import { ReportPostFields, newSection, type DraftSection } from "@/modules/report_task/components/report-feed/report-post-fields";
import { Clock, Lock, Send } from "lucide-react";
import { toast } from "sonner";

// A room's own starter sections (Phase 6 "เทมเพลตโพสต์") pre-fill a brand-new
// draft's headings — bullets stay for the poster to fill in themselves.
function initialSections(topic: ReportTopic): DraftSection[] {
  if (!topic.postTemplateSections || topic.postTemplateSections.length === 0) return [newSection()];
  return topic.postTemplateSections.map((s) => ({ ...newSection(), heading: s.heading }));
}

export function ReportComposer({ topic }: { topic: ReportTopic }) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const viewer = getUser(viewingAsUserId)!;
  const addPost = useReportFeedStore((s) => s.addPost);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<DraftSection[]>(() => initialSections(topic));
  const [images, setImages] = useState<ReportPostImage[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle("");
    setSections(initialSections(topic));
    setImages([]);
    setTagIds([]);
    setExpanded(false);
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
    setBusy(true);
    const next: ReportPostImage[] = [];
    try {
      for (const file of Array.from(files).slice(0, 6 - images.length)) {
        const url = await uploadCompressedImage(file);
        next.push({ id: `img-${crypto.randomUUID()}`, url, name: file.name });
      }
    } catch {
      toast.error("แนบรูปไม่สำเร็จบางไฟล์ — ลองใหม่อีกครั้ง");
    } finally {
      // Keep whatever uploaded successfully before the failure — no reason
      // to throw away images that already finished just because a later one broke.
      if (next.length > 0) setImages((prev) => [...prev, ...next]);
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const minImagesRequired = minImagesNow(topic);
  const missingRequiredImage = images.length < minImagesRequired;
  const activeRound = currentCutoff(topic.cutoffs);

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
    });
    reset();
  }

  if (!expanded) {
    return (
      <div className="shrink-0 border-t border-[var(--line)]/60 bg-white px-5 py-3.5">
        <button
          data-tour="composer-trigger"
          onClick={() => setExpanded(true)}
          className="w-full flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--bg-soft)] px-4 py-2.5 text-left text-[15px] text-[var(--ink-soft)] hover:border-[var(--brand-green)]/40 hover:bg-white transition-colors duration-200"
        >
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{viewer.avatar}</AvatarFallback>
          </Avatar>
          เริ่มการสนทนาใหม่ใน &quot;{topic.name}&quot;...
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
          {activeRound && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              <Clock className="h-3 w-3" />
              ตอนนี้อยู่ในรอบ &quot;{activeRound.label}&quot; ({activeRound.time})
              {minImagesRequired > 0 && ` · ต้องแนบรูปอย่างน้อย ${minImagesRequired} รูป`}
            </span>
          )}
        </div>

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
            {!title.trim() ? "ต้องมีหัวข้อ" : `ต้องแนบรูปอีก ${minImagesRequired - images.length} รูป`}
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
          title={!title.trim() ? "ต้องมีหัวข้อ" : missingRequiredImage ? `ต้องแนบรูปอีก ${minImagesRequired - images.length} รูป` : undefined}
        >
          <Send className="h-4 w-4" />
          โพสต์ {/* Ctrl/⌘+Enter also submits (P4) — see the keydown handler on the title input below. */}
        </Button>
      </div>
    </div>
  );
}
