"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/modules/report_task/components/ui/sheet";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
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
 * again from a dropdown" round trip (G1/G2). Every control still saves
 * instantly on change, same as every other settings surface in this app
 * (ReportTopicSettingsPanel already worked this way) — Phase 0 already fixed
 * the silent-failure-toast-spam that made "did this actually save?" (G5) a
 * real worry, so this doesn't reinvent a separate draft/save/cancel flow.
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

  const requiredWeekdays = topic.requiredWeekdays ?? [];
  function toggleWeekday(day: number) {
    const isAllDays = requiredWeekdays.length === 0;
    // Starting from "every day" (undefined/empty), the first tap should
    // narrow to just that day, not toggle it off from an implicit full set.
    const current = isAllDays ? [0, 1, 2, 3, 4, 5, 6] : requiredWeekdays;
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    if (next.length === 0) return; // never let this collapse to "no day required"
    updateTopicSettings(topic.id, { requiredWeekdays: next.length === 7 ? undefined : next });
  }

  function addTemplateSection() {
    const heading = templateDraft.trim();
    if (!heading) return;
    updateTopicSettings(topic.id, { postTemplateSections: [...(topic.postTemplateSections ?? []), { heading }] });
    setTemplateDraft("");
  }

  function removeTemplateSection(index: number) {
    const next = (topic.postTemplateSections ?? []).filter((_, i) => i !== index);
    updateTopicSettings(topic.id, { postTemplateSections: next.length > 0 ? next : undefined });
  }

  const myNotifyPreference = topic.notifyPreference?.[viewingAsUserId] ?? "all";
  const isManager = canManage(viewingAsUserId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 w-full sm:max-w-md flex flex-col">
        <SheetHeader className="px-5 py-3.5 border-b border-[var(--line)]">
          <SheetTitle className="truncate">ตั้งค่าห้อง &quot;{topic.name}&quot;</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* ทั่วไป */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">ทั่วไป</p>
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">ชื่อห้อง</Label>
              <Input value={topic.name} onChange={(e) => e.target.value.trim() && updateTopicSettings(topic.id, { name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">คำอธิบาย</Label>
              <Textarea
                value={topic.description ?? ""}
                onChange={(e) => updateTopicSettings(topic.id, { description: e.target.value })}
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
                    onClick={() => updateTopicSettings(topic.id, { color: c })}
                    aria-label={`เลือกสี ${c}`}
                    className={cn(
                      "h-7 w-7 rounded-full shrink-0 transition-transform",
                      topic.color === c && "scale-110 ring-2 ring-offset-2 ring-[var(--line)]"
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
                checked={topic.postPermission === "managersOnly"}
                onCheckedChange={(v) => updateTopicSettings(topic.id, { postPermission: v ? "managersOnly" : "everyone" })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
              <div className="min-w-0 pr-3">
                <p className="text-sm font-medium">ปิดคอมเมนต์ (อ่านอย่างเดียว)</p>
                <p className="text-xs text-[var(--ink-soft)]">ความคิดเห็นเดิมยังแสดงอยู่ แค่เพิ่มใหม่ไม่ได้</p>
              </div>
              <Switch
                checked={!!topic.commentsDisabled}
                onCheckedChange={(v) => updateTopicSettings(topic.id, { commentsDisabled: v })}
              />
            </div>
          </section>

          <ReportTopicSettingsPanel topic={topic} hideHeading />

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
            {(topic.postTemplateSections ?? []).length > 0 && (
              <div className="space-y-1.5">
                {topic.postTemplateSections!.map((s, i) => (
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
                    value={String(topic.remindBeforeCutoffMinutes ?? 0)}
                    onValueChange={(v) => v && updateTopicSettings(topic.id, { remindBeforeCutoffMinutes: Number(v) || undefined })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{reminderOptions.find((o) => o.value === String(topic.remindBeforeCutoffMinutes ?? 0))?.label}</SelectValue>
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
                    checked={!!topic.notifyManagerSummary}
                    onCheckedChange={(v) => updateTopicSettings(topic.id, { notifyManagerSummary: v })}
                  />
                </div>
                <p className="text-[11px] text-[var(--ink-soft)]">บันทึกการตั้งค่าไว้แล้ว — ระบบส่งแจ้งเตือนอัตโนมัติยังอยู่ระหว่างพัฒนา</p>
              </>
            )}
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
                value={String(topic.filesRetentionDays ?? 7)}
                onValueChange={(v) => v && updateTopicSettings(topic.id, { filesRetentionDays: Number(v) === 7 ? undefined : Number(v) })}
              >
                <SelectTrigger className="w-24 shrink-0">
                  <SelectValue>{topic.filesRetentionDays ?? 7} วัน</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[3, 7, 14, 30].map((d) => (
                    <SelectItem key={d} value={String(d)}>{d} วัน</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
      </SheetContent>
    </Sheet>
  );
}
