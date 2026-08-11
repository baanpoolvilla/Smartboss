"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { Button } from "@/modules/report_task/components/ui/button";
import { ReportTopicSettingsPanel } from "@/modules/report_task/components/report-feed/report-topic-settings-dialog";
import { useReportFeedStore, topicColors, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canManage } from "@/modules/report_task/data/mock";
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";

const weekdayLabels = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

const reminderOptions = [
  { value: "0", label: "ปิด" },
  { value: "15", label: "15 นาทีก่อนถึงรอบ" },
  { value: "30", label: "30 นาทีก่อนถึงรอบ" },
  { value: "60", label: "60 นาทีก่อนถึงรอบ" },
];

/**
 * Room settings, opened straight from the room's own ⚙ (Phase 6) — replaces
 * the old "gear ⚙ → whole-page navigation to /settings, pick this same room
 * again from a dropdown" round trip (G1/G2). Everything below except member
 * management (its own dialog, own explicit actions) and archive (its own
 * confirm step) batches into a local `draft` and only actually saves on
 * "บันทึก" — reopening for a different room, or this same one again later,
 * resets the draft straight from the real topic, which is all "ยกเลิก"
 * needs to do too (nothing was ever written until Save was clicked).
 */
export function RoomSettingsSheet({
  open,
  onOpenChange,
  topic,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: ReportTopic;
}) {
  const updateTopicSettings = useReportFeedStore((s) => s.updateTopicSettings);
  const setNotifyPreference = useReportFeedStore((s) => s.setNotifyPreference);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [templateDraft, setTemplateDraft] = useState("");
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  const [draft, setDraft] = useState<ReportTopic>(topic);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  // Reopening (or switching to a different room while open) starts from the
  // real, currently-saved topic — the only two moments a draft should ever
  // be (re)seeded. Tracked here instead of in an effect: an effect that
  // calls setState synchronously on mount/update just to mirror a prop
  // triggers an extra render for no reason — this "adjust state during
  // render" form (React's own recommended replacement) does the same reset
  // in the same render pass instead.
  const [resetKey, setResetKey] = useState<string | null>(open ? topic.id : null);
  if (open && resetKey !== topic.id) {
    setResetKey(topic.id);
    setDraft(topic);
    setDirtyKeys(new Set());
  } else if (!open && resetKey !== null) {
    setResetKey(null);
  }

  function patchDraft(patch: Partial<ReportTopic>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setDirtyKeys((prev) => new Set([...prev, ...Object.keys(patch)]));
  }

  function handleSave() {
    updateTopicSettings(topic.id, draft);
    setDirtyKeys(new Set());
    toast.success("บันทึกการตั้งค่าห้องแล้ว");
  }

  function handleCancel() {
    setDraft(topic);
    setDirtyKeys(new Set());
  }

  const requiredWeekdays = draft.requiredWeekdays ?? [];
  function toggleWeekday(day: number) {
    const isAllDays = requiredWeekdays.length === 0;
    // Starting from "every day" (undefined/empty), the first tap should
    // narrow to just that day, not toggle it off from an implicit full set.
    const current = isAllDays ? [0, 1, 2, 3, 4, 5, 6] : requiredWeekdays;
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    if (next.length === 0) return; // never let this collapse to "no day required"
    patchDraft({ requiredWeekdays: next.length === 7 ? undefined : next });
  }

  function addTemplateSection() {
    const heading = templateDraft.trim();
    if (!heading) return;
    patchDraft({ postTemplateSections: [...(draft.postTemplateSections ?? []), { heading }] });
    setTemplateDraft("");
  }

  function removeTemplateSection(index: number) {
    const next = (draft.postTemplateSections ?? []).filter((_, i) => i !== index);
    patchDraft({ postTemplateSections: next.length > 0 ? next : undefined });
  }

  const myNotifyPreference = topic.notifyPreference?.[viewingAsUserId] ?? "all";
  const isManager = canManage(viewingAsUserId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 sm:max-w-md w-full max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-5 py-3.5 border-b border-[var(--line)]">
          <DialogTitle className="truncate">ตั้งค่าห้อง &quot;{topic.name}&quot;</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* ทั่วไป */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">ทั่วไป</p>
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">ชื่อห้อง</Label>
              <Input value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">คำอธิบาย</Label>
              <Textarea
                value={draft.description ?? ""}
                onChange={(e) => patchDraft({ description: e.target.value })}
                rows={2}
                className="resize-none"
                placeholder="บอกคร่าวๆ ว่าหัวข้อนี้ไว้คุยเรื่องอะไร"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">สี</Label>
              <div className="flex items-center gap-2.5 flex-wrap">
                {topicColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => patchDraft({ color: c })}
                    aria-label={`เลือกสี ${c}`}
                    className={cn(
                      "h-7 w-7 rounded-full shrink-0 transition-transform",
                      draft.color === c && "scale-110 ring-2 ring-offset-2 ring-[var(--line)]"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* สิทธิ์ (เพิ่มเติมจาก visibility ด้านล่าง) */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">สิทธิ์การโพสต์</p>
            <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
              <div className="min-w-0 pr-3">
                <p className="text-sm font-medium">เฉพาะผู้ดูแลโพสต์ได้</p>
                <p className="text-xs text-[var(--ink-soft)]">เหมาะกับห้องประกาศ/นโยบาย — คนอื่นยังอ่านและคอมเมนต์ได้ตามปกติ</p>
              </div>
              <Switch
                checked={draft.postPermission === "managersOnly"}
                onCheckedChange={(v) => patchDraft({ postPermission: v ? "managersOnly" : "everyone" })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
              <div className="min-w-0 pr-3">
                <p className="text-sm font-medium">ปิดคอมเมนต์ (อ่านอย่างเดียว)</p>
                <p className="text-xs text-[var(--ink-soft)]">ความคิดเห็นเดิมยังแสดงอยู่ แค่เพิ่มใหม่ไม่ได้</p>
              </div>
              <Switch
                checked={!!draft.commentsDisabled}
                onCheckedChange={(v) => patchDraft({ commentsDisabled: v })}
              />
            </div>
          </section>

          {/* สิทธิ์การมองเห็น + กติกาการส่งรายงาน (จำนวนรูป/รอบตัดยอด) — มาจาก
              ReportTopicSettingsPanel ที่ใช้ร่วมกับหน้า /settings ด้วย จึงคง
              โครงสร้างภายในไว้ตามเดิม แค่ครอบหัวข้อกลุ่มไว้จากภายนอกให้สอดคล้อง
              กับหมวดอื่นๆ ใน Sheet นี้ — ส่ง draft + patchDraft ผ่าน onUpdate
              แทนการเซฟทันที (onUpdate ไม่ระบุ = เซฟทันทีเหมือนเดิมที่ /settings). */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">สิทธิ์การมองเห็น &amp; กติกาการส่งรายงาน</p>
            <ReportTopicSettingsPanel topic={draft} hideHeading onUpdate={patchDraft} />
          </section>

          {/* กติกา เพิ่มเติม */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">วันที่ต้องส่งรายงาน</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {weekdayLabels.map((label, day) => {
                const active = requiredWeekdays.length === 0 || requiredWeekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleWeekday(day)}
                    className={cn(
                      "h-8 w-8 rounded-full text-xs font-medium transition-colors shrink-0",
                      active ? "bg-[var(--brand-green)] text-[var(--ink)]" : "bg-[var(--bg-soft)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--ink-soft)]">
              วันที่ไม่เลือกจะไม่นับ &quot;ไม่ส่ง&quot; ในสถิติ — ค่าเริ่มต้นคือทุกวัน (รวมเสาร์–อาทิตย์)
            </p>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">เทมเพลตโพสต์</p>
            <p className="text-[11px] text-[var(--ink-soft)]">หัวข้อย่อยตั้งต้นที่จะขึ้นให้อัตโนมัติทุกครั้งที่เริ่มโพสต์ใหม่ในห้องนี้</p>
            {(draft.postTemplateSections ?? []).length > 0 && (
              <div className="space-y-1.5">
                {draft.postTemplateSections!.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 py-1.5">
                    <span className="flex-1 text-sm truncate">{s.heading}</span>
                    <button
                      onClick={() => removeTemplateSection(i)}
                      className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-[var(--ink-soft)] hover:text-[var(--chart-red)] hover:bg-[var(--chart-red)]/10"
                      aria-label={`ลบหัวข้อย่อย ${s.heading}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={templateDraft}
                onChange={(e) => setTemplateDraft(e.target.value)}
                placeholder="เช่น งานที่ทำวันนี้"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTemplateSection())}
                className="flex-1"
              />
              <button
                onClick={addTemplateSection}
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg border border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                aria-label="เพิ่มหัวข้อย่อยในเทมเพลต"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </section>

          {/* การแจ้งเตือน */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">การแจ้งเตือน</p>
            {isManager && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--ink-soft)]">เตือนก่อนถึงรอบส่ง (คนที่ยังไม่ส่ง)</Label>
                  <Select
                    value={String(draft.remindBeforeCutoffMinutes ?? 0)}
                    onValueChange={(v) => v && patchDraft({ remindBeforeCutoffMinutes: Number(v) || undefined })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{reminderOptions.find((o) => o.value === String(draft.remindBeforeCutoffMinutes ?? 0))?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {reminderOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
                  <div className="min-w-0 pr-3">
                    <p className="text-sm font-medium">สรุปให้หัวหน้าหลังปิดรอบ</p>
                    <p className="text-xs text-[var(--ink-soft)]">ใครส่งช้า/ไม่ส่งในรอบนั้น</p>
                  </div>
                  <Switch
                    checked={!!draft.notifyManagerSummary}
                    onCheckedChange={(v) => patchDraft({ notifyManagerSummary: v })}
                  />
                </div>
                <p className="text-[11px] text-[var(--ink-soft)]">บันทึกการตั้งค่าไว้แล้ว — ระบบส่งแจ้งเตือนอัตโนมัติยังอยู่ระหว่างพัฒนา</p>
              </>
            )}
            {/* ส่วนตัว ไม่กระทบคนอื่น — เซฟทันทีเหมือนเดิม ไม่รวมอยู่ใน draft/บันทึกด้านล่าง */}
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">การแจ้งเตือนของฉันในห้องนี้</Label>
              <Select value={myNotifyPreference} onValueChange={(v) => v && setNotifyPreference(topic.id, viewingAsUserId, v as "all" | "mentions" | "off")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {myNotifyPreference === "all" ? "ทุกโพสต์" : myNotifyPreference === "mentions" ? "เฉพาะที่กล่าวถึงฉัน" : "ปิด"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกโพสต์</SelectItem>
                  <SelectItem value="mentions">เฉพาะที่กล่าวถึงฉัน</SelectItem>
                  <SelectItem value="off">ปิด</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* ข้อมูล */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">ข้อมูล</p>
            <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
              <div className="min-w-0 pr-3">
                <p className="text-sm font-medium">อายุรูปในแท็บ &quot;ไฟล์&quot;</p>
                <p className="text-xs text-[var(--ink-soft)]">รูปเก่ากว่านี้จะไม่แสดงในแท็บไฟล์ (อัลบั้มไม่มีวันหมดอายุ)</p>
              </div>
              <Select
                value={String(draft.filesRetentionDays ?? 7)}
                onValueChange={(v) => v && patchDraft({ filesRetentionDays: Number(v) === 7 ? undefined : Number(v) })}
              >
                <SelectTrigger className="w-24 shrink-0">
                  <SelectValue>{draft.filesRetentionDays ?? 7} วัน</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[3, 7, 14, 30].map((d) => (
                    <SelectItem key={d} value={String(d)}>{d} วัน</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* เก็บเข้าคลัง — action ทำงานทันทีพร้อม toast ของตัวเอง เหมือน
                "ลบหัวข้อ" ไม่รวมอยู่ใน draft/บันทึกด้านล่าง เพื่อไม่ให้การกด
                "ยกเลิก" ทีหลังไปย้อนสถานะเก็บเข้าคลังที่ยืนยันไปแล้วโดยไม่ตั้งใจ. */}
            <div className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2.5">
              <div className="min-w-0 pr-3">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  {topic.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  {topic.archived ? "กู้คืนจากคลัง" : "เก็บเข้าคลัง"}
                </p>
                <p className="text-xs text-[var(--ink-soft)]">
                  {topic.archived ? "ห้องนี้ถูกเก็บเข้าคลังอยู่ — กู้คืนแล้วจะกลับมาแสดงตามปกติ" : "ห้องเก่าที่ไม่ใช้แล้ว ซ่อนแบบไม่ต้องลบ ยังกู้คืนได้เสมอ ไม่เหมือน \"ลบหัวข้อ\""}
                </p>
              </div>
              <button
                onClick={() => {
                  if (topic.archived) {
                    updateTopicSettings(topic.id, { archived: false });
                    toast.success(`กู้คืนห้อง "${topic.name}" แล้ว`);
                    return;
                  }
                  if (!archiveConfirm) {
                    setArchiveConfirm(true);
                    return;
                  }
                  updateTopicSettings(topic.id, { archived: true });
                  setArchiveConfirm(false);
                  toast.success(`เก็บห้อง "${topic.name}" เข้าคลังแล้ว`);
                }}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  archiveConfirm
                    ? "border-[var(--chart-red)] bg-red-50 text-[var(--chart-red)]"
                    : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                )}
              >
                {topic.archived ? "กู้คืน" : archiveConfirm ? "ยืนยันเก็บเข้าคลัง" : "เก็บเข้าคลัง"}
              </button>
            </div>
          </section>
        </div>

        {/* Save/Cancel bar (Phase 6) — everything above except member
            management and archive batches here instead of saving as you
            type, same shape as mockup section E's `.savebar`. */}
        <div className="shrink-0 flex items-center gap-2.5 px-5 py-3 border-t border-[var(--line)] bg-[var(--bg-soft)]">
          <p className="text-[11.5px] text-[var(--ink-soft)]">
            {dirtyKeys.size > 0 ? `มีการเปลี่ยนแปลง ${dirtyKeys.size} รายการที่ยังไม่บันทึก` : "ไม่มีการเปลี่ยนแปลง"}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={dirtyKeys.size === 0} onClick={handleCancel}>
              ยกเลิก
            </Button>
            <Button
              size="sm"
              disabled={dirtyKeys.size === 0 || !draft.name.trim()}
              className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
              onClick={handleSave}
            >
              บันทึก
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
