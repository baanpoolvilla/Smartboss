"use client";

import { useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { RoomMembersSummaryCard, RoomMembersDialog } from "@/modules/report_task/components/report-feed/room-members-dialog";
import { useReportFeedStore, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { departments, getUser, isOwner } from "@/modules/report_task/lib/directory";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { topicModeOf } from "@/modules/report_task/lib/report-topic-membership";
import { cn } from "@/modules/report_task/lib/utils";
import { Check, Globe, ImagePlus, Lock, Minus, Plus, Trash2, User, Users } from "lucide-react";

const MAX_REQUIRED_IMAGES = 6;

function ImageCountStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-white px-1 shrink-0">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value <= 0}
        className="h-6 w-6 flex items-center justify-center text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-30"
        aria-label="ลดจำนวนรูปขั้นต่ำ"
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-5 text-center text-sm font-medium tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(MAX_REQUIRED_IMAGES, value + 1))}
        disabled={value >= MAX_REQUIRED_IMAGES}
        className="h-6 w-6 flex items-center justify-center text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-30"
        aria-label="เพิ่มจำนวนรูปขั้นต่ำ"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

type VisibilityMode = "open" | "department" | "manager" | "person";

const modeOptions: { mode: VisibilityMode; label: string; icon: typeof Globe }[] = [
  { mode: "open", label: "ทุกคน", icon: Globe },
  { mode: "department", label: "เฉพาะแผนก", icon: Users },
  { mode: "person", label: "เฉพาะบุคคล", icon: User },
  { mode: "manager", label: "หัวหน้า/ผู้บริหาร", icon: Lock },
];

/** One room's settings — lives on the settings page (src/app/settings/page.tsx), with a room picker above it since it's per-topic, not company-wide (there, every change still saves instantly — `onUpdate` isn't passed). Also reused inside room-settings-sheet.tsx, which batches everything into its own draft/Save-Cancel bar instead — passes `onUpdate` so visibility/min-images/cutoff changes land in that draft rather than the store directly, and `hideHeading` drops this component's own duplicate "ตั้งค่าห้อง X" line there. Member management (RoomMembersDialog below) always saves instantly either way — its own dialog, own explicit add/remove actions, not a form field to batch. */
export function ReportTopicSettingsPanel({
  topic,
  hideHeading,
  onUpdate,
}: {
  topic: ReportTopic;
  hideHeading?: boolean;
  onUpdate?: (patch: Partial<ReportTopic>) => void;
}) {
  const updateTopicSettings = useReportFeedStore((s) => s.updateTopicSettings);
  const apply = onUpdate ?? ((patch: Partial<ReportTopic>) => updateTopicSettings(topic.id, patch));
  const [newLabel, setNewLabel] = useState("");
  const [newTime, setNewTime] = useState("09:00");
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const mode = topicModeOf(topic.visibility);

  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const owner = isOwner(viewingAsUserId);
  const ownDeptId = getUser(viewingAsUserId)?.departmentId;

  // A department head only ever reaches this dialog for a room scoped to
  // their own department (see canEditReportTopic) — switching to any other
  // mode, or unchecking their own department, would edit them out of the
  // room with no way back short of the company owner reopening it for them.
  // The owner has no such restriction; every mode/department stays theirs.
  function setMode(next: VisibilityMode) {
    if (!owner && next !== "department") return;
    apply({
      visibility:
        next === "open"
          ? undefined
          : next === "manager"
            ? { managerOnly: true }
            : next === "person"
              // An empty userIds array reads as "no restriction" everywhere
              // (canSeeReportTopic, modeOf) — same failure mode as the
              // department list hitting zero, so seed it with whoever's
              // picking the mode rather than leaving it empty and silently
              // falling back to open-to-everyone.
              ? { userIds: topic.visibility?.userIds?.length ? topic.visibility.userIds : [viewingAsUserId] }
              : { departmentIds: topic.visibility?.departmentIds?.length ? topic.visibility.departmentIds : [departments[0]?.id].filter((x): x is string => !!x) },
    });
  }

  function toggleDept(deptId: string) {
    if (!owner && deptId === ownDeptId) return;
    const current = topic.visibility?.departmentIds ?? [];
    const selected = current.includes(deptId);
    const next = selected ? current.filter((id) => id !== deptId) : [...current, deptId];
    // Never leave the room with zero departments selected — that would
    // silently lock everyone but the owner out with no way back short of
    // reopening this dialog and re-adding one.
    if (next.length === 0) return;
    apply({
      visibility: {
        departmentIds: next,
        extraUserIds: topic.visibility?.extraUserIds,
        exemptUserIds: topic.visibility?.exemptUserIds,
      },
    });
  }

  function addCutoff() {
    const label = newLabel.trim();
    if (!label || !newTime) return;
    apply({
      cutoffs: [...topic.cutoffs, { id: `cutoff-${crypto.randomUUID()}`, label, time: newTime }],
    });
    setNewLabel("");
  }

  function removeCutoff(id: string) {
    apply({ cutoffs: topic.cutoffs.filter((c) => c.id !== id) });
  }

  function setCutoffMinImages(id: string, value: number | undefined) {
    apply({
      cutoffs: topic.cutoffs.map((c) => (c.id === id ? { ...c, minImages: value } : c)),
    });
  }

  return (
    <div className="space-y-4">
      {!hideHeading && (
        <div>
          <h2 className="text-base font-semibold">ตั้งค่าห้อง &quot;{topic.name}&quot;</h2>
          <p className="text-sm text-[var(--ink-soft)] mt-0.5">กำหนดข้อบังคับการส่งรีพอตของห้องนี้ — ปรับด้วยตัวเองได้ตลอด</p>
        </div>
      )}


      <div className="space-y-2">
          <Label className="text-xs text-[var(--ink-soft)]">ใครเห็นห้องนี้ได้บ้าง</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {modeOptions.map(({ mode: m, label, icon: Icon }) => {
              const active = mode === m;
              const locked = !owner && m !== "department";
              return (
                <button
                  key={m}
                  type="button"
                  disabled={locked}
                  onClick={() => setMode(m)}
                  title={locked ? "หัวหน้าแผนกเปลี่ยนเป็นโหมดนี้ไม่ได้ — จะทำให้แก้ห้องนี้เองไม่ได้อีก ต้องให้เจ้าของบริษัทเปลี่ยนแทน" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors",
                    active
                      ? "border-[var(--brand-green)] bg-[var(--accent)]"
                      : locked
                        ? "border-[var(--line)] opacity-40 cursor-not-allowed"
                        : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-medium">{label}</span>
                </button>
              );
            })}
          </div>

          {mode === "department" && (
            <div className="grid grid-cols-2 gap-1 pt-1">
              {departments.map((d) => {
                const selected = topic.visibility?.departmentIds?.includes(d.id) ?? false;
                const locked = !owner && d.id === ownDeptId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={locked}
                    onClick={() => toggleDept(d.id)}
                    title={locked ? "ถอดแผนกตัวเองออกไม่ได้ — จะทำให้แก้ห้องนี้เองไม่ได้อีก" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      locked ? "opacity-60 cursor-not-allowed" : "hover:bg-[var(--bg-soft)]"
                    )}
                  >
                    <span
                      className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                        selected ? "bg-[var(--brand-green)] border-[var(--brand-green)]" : "border-[var(--line)]"
                      )}
                    >
                      {selected && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <span className="truncate">{d.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="pt-1.5">
            {/* This panel is only ever reached for a topic the viewer can
                edit — the owner for any mode, a department head only ever
                for their own department (see canEditReportTopic) — so
                whichever mode is showing, "can manage" is exactly that. */}
            <RoomMembersSummaryCard topic={topic} canManage={owner || mode === "department"} onManage={() => setMembersDialogOpen(true)} />
            <RoomMembersDialog
              open={membersDialogOpen}
              onOpenChange={setMembersDialogOpen}
              topic={topic}
              updateTopicSettings={updateTopicSettings}
              canManage={owner || mode === "department"}
            />
          </div>

          <p className="text-[11px] text-[var(--ink-soft)]">
            {mode === "open" && "ทุกคนในบริษัทเห็นและโพสต์ในห้องนี้ได้"}
            {mode === "department" && "เฉพาะคนในแผนกที่เลือก บวกคนที่เพิ่มเองด้านบน เห็นห้องนี้ได้ — เจ้าของบริษัทเห็นทุกห้องเสมอ"}
            {mode === "person" && "เฉพาะคนที่เลือกไว้ด้านบนเห็นห้องนี้ — เจ้าของบริษัทเห็นทุกห้องเสมอ"}
            {mode === "manager" && "เฉพาะหัวหน้าแผนกและเจ้าของบริษัทเห็นห้องนี้"}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">จำนวนรูปขั้นต่ำต่อโพสต์ (ค่าเริ่มต้น)</p>
            <p className="text-xs text-[var(--ink-soft)]">
              {topic.cutoffs.length > 0
                ? "ใช้กับรอบที่ไม่ได้กำหนดจำนวนรูปไว้เฉพาะด้านล่าง"
                : topic.minImages > 0
                  ? `โพสต์ต้องแนบอย่างน้อย ${topic.minImages} รูปถึงจะโพสต์ได้`
                  : "0 = ไม่บังคับแนบรูป"}
            </p>
          </div>
          <ImageCountStepper value={topic.minImages} onChange={(v) => apply({ minImages: v })} />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-[var(--ink-soft)]">รอบตัดยอดรีพอต (เช่น เช้า 09:00, เย็น 18:00)</Label>
          {topic.cutoffs.length > 0 && (
            <div className="space-y-1.5">
              {topic.cutoffs.map((c) => (
                <div key={c.id} className="rounded-lg border border-[var(--line)] p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-medium">{c.label}</span>
                    <span className="text-sm tabular-nums text-[var(--ink-soft)]">{c.time}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCutoff(c.id)}
                      aria-label={`ลบรอบ ${c.label}`}
                    >
                      <Trash2 className="h-4 w-4 text-[var(--ink-soft)]" />
                    </Button>
                  </div>
                  {/* Per-round override — e.g. เช้าต้องแนบ 2 รูป, เย็นแค่เช็คอินก็พอ. */}
                  <div className="flex items-center gap-1.5 pl-0.5">
                    <ImagePlus className="h-3 w-3 text-[var(--ink-soft)] shrink-0" />
                    <button
                      type="button"
                      onClick={() => setCutoffMinImages(c.id, c.minImages === undefined ? topic.minImages : undefined)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                        c.minImages === undefined
                          ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
                          : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                      )}
                    >
                      ตามค่าเริ่มต้น{c.minImages === undefined ? ` (${topic.minImages})` : ""}
                    </button>
                    {c.minImages !== undefined && (
                      <>
                        <span className="text-[11px] text-[var(--ink-soft)]">กำหนดเอง:</span>
                        <ImageCountStepper value={c.minImages} onChange={(v) => setCutoffMinImages(c.id, v)} />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] p-2">
            <Input
              aria-label="ชื่อรอบตัดยอด"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="ชื่อรอบ เช่น เช้า"
              className="flex-1"
            />
            <Input
              type="time"
              aria-label="เวลาตัดยอด"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="w-28 shrink-0"
            />
            <Button variant="outline" size="icon" onClick={addCutoff} aria-label="เพิ่มรอบตัดยอด">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-[var(--ink-soft)]">
            โพสต์ที่ส่งหลังเวลาที่กำหนดจะขึ้นป้าย &quot;ส่งช้า&quot; สีเตือนบนโพสต์ — ไม่บล็อกการโพสต์
          </p>
        </div>
      </div>
  );
}
