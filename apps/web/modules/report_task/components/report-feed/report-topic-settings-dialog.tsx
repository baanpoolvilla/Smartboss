"use client";

import { useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Label } from "@/modules/report_task/components/ui/label";
import { RoomMembersSummaryCard, RoomMembersDialog } from "@/modules/report_task/components/report-feed/room-members-dialog";
import { useReportFeedStore, type ReportTopic, type SubmissionRound } from "@/modules/report_task/store/report-feed-store";
import { SubmissionRoundDialog } from "@/modules/report_task/components/report-feed/submission-round-dialog";
import { resolvedSubmittersOfTopic } from "@/modules/report_task/lib/submission-rounds";
import { users as allUsers } from "@/modules/report_task/lib/directory";
import { departments, getUser, isOwner } from "@/modules/report_task/lib/directory";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { topicModeOf } from "@/modules/report_task/lib/report-topic-membership";
import { cn } from "@/modules/report_task/lib/utils";
import { Check, Clock, Globe, Lock, Pencil, Plus, Trash2, User, Users, UserCheck } from "lucide-react";

const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
function daysLabel(w?: number[]): string {
  if (!w || w.length === 0) return "ทุกวัน";
  return w.slice().sort((a, b) => a - b).map((d) => WD[d]).join(" ");
}
function whoLabel(r: SubmissionRound, groups: { id: string; name: string }[]): string {
  const s = r.submitters;
  let base: string;
  if (s.mode === "everyone") base = "ทุกคนในห้อง";
  else if (s.mode === "groups") base = "กลุ่ม: " + (s.groupIds ?? []).map((id) => groups.find((g) => g.id === id)?.name ?? "?").join(", ");
  else if (s.mode === "departments") base = "แผนก: " + (s.departmentIds ?? []).map((id) => departments.find((d) => d.id === id)?.name ?? "?").join(", ");
  else base = (s.userIds?.length ?? 0) + " คน";
  const extra: string[] = [];
  if (s.addUserIds?.length) extra.push("+" + s.addUserIds.length);
  if (s.removeUserIds?.length) extra.push("\u2212" + s.removeUserIds.length);
  return base + (extra.length ? " (" + extra.join(" ") + ")" : "");
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
  liveVisibility,
}: {
  topic: ReportTopic;
  hideHeading?: boolean;
  onUpdate?: (patch: Partial<ReportTopic>) => void;
  /** Override for what "who can see this room" (mode buttons, department
   * picker, and the member section) reads — only needed when `topic` is a
   * batched draft (room-settings-sheet.tsx). Unset when `topic` is already
   * live (plain /settings usage), where `topic.visibility` is correct as-is. */
  liveVisibility?: ReportTopic["visibility"];
}) {
  const updateTopicSettings = useReportFeedStore((s) => s.updateTopicSettings);
  const apply = onUpdate ?? ((patch: Partial<ReportTopic>) => updateTopicSettings(topic.id, patch));
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const submitterGroups = useReportFeedStore((s) => s.submitterGroups);
  const [roundDialogOpen, setRoundDialogOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<SubmissionRound | null>(null);
  // "Who can see this room" (mode, departments, members) always saves
  // straight to the store the instant you change it — same "own explicit
  // actions, not a form field to batch" reasoning the member dialog already
  // had (see its own comment below). It used to only be true for members:
  // changing the mode here went into room-settings-sheet.tsx's batched draft
  // instead, so picking a mode, then opening "จัดการสมาชิก" and saving there,
  // then closing the sheet without ever hitting *its* separate "บันทึก" threw
  // the mode change away while the member change (already saved) stuck —
  // confusing regardless of which order you did things in. Reading/writing
  // both through the same live value removes that trap entirely.
  const visibility = liveVisibility ?? topic.visibility;
  const mode = topicModeOf(visibility);
  const memberTopic = { ...topic, visibility };

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
    updateTopicSettings(topic.id, {
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
              ? { userIds: visibility?.userIds?.length ? visibility.userIds : [viewingAsUserId] }
              : { departmentIds: visibility?.departmentIds?.length ? visibility.departmentIds : [departments[0]?.id].filter((x): x is string => !!x) },
    });
  }

  function toggleDept(deptId: string) {
    if (!owner && deptId === ownDeptId) return;
    const current = visibility?.departmentIds ?? [];
    const selected = current.includes(deptId);
    const next = selected ? current.filter((id) => id !== deptId) : [...current, deptId];
    // Never leave the room with zero departments selected — that would
    // silently lock everyone but the owner out with no way back short of
    // reopening this dialog and re-adding one.
    if (next.length === 0) return;
    updateTopicSettings(topic.id, {
      visibility: {
        departmentIds: next,
        extraUserIds: visibility?.extraUserIds,
        exemptUserIds: visibility?.exemptUserIds,
      },
    });
  }

  const rounds = topic.submissionRounds ?? [];
  function saveRound(round: SubmissionRound) {
    const exists = rounds.some((r) => r.id === round.id);
    apply({ submissionRounds: exists ? rounds.map((r) => (r.id === round.id ? round : r)) : [...rounds, round] });
  }
  function removeRound(id: string) {
    apply({ submissionRounds: rounds.filter((r) => r.id !== id) });
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
                const selected = visibility?.departmentIds?.includes(d.id) ?? false;
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
            <RoomMembersSummaryCard topic={memberTopic} canManage={owner || mode === "department"} onManage={() => setMembersDialogOpen(true)} />
            <RoomMembersDialog
              open={membersDialogOpen}
              onOpenChange={setMembersDialogOpen}
              topic={memberTopic}
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

        <div className="space-y-2">
          <div>
            <Label className="text-xs text-[var(--ink-soft)]">รอบส่ง — ใครต้องส่ง + กี่โมง</Label>
            <p className="text-[11px] text-[var(--ink-soft)]">แยกจาก &quot;ใครเห็นห้อง&quot; — เว้นว่าง = ไม่มีใครต้องส่ง ไม่หัก/ไม่นับ</p>
          </div>

          {rounds.length > 0 && (
            <div className="space-y-1.5">
              {rounds.map((r) => (
                <div key={r.id} className="rounded-lg border border-[var(--line)] p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.label}</span>
                    <span className="flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-green-dark)]">
                      <Clock className="h-3 w-3" />ก่อน {r.time}
                    </span>
                    <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">{daysLabel(r.weekdays)}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditingRound(r); setRoundDialogOpen(true); }} aria-label={`แก้รอบ ${r.label}`}>
                        <Pencil className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeRound(r.id)} aria-label={`ลบรอบ ${r.label}`}>
                        <Trash2 className="h-4 w-4 text-[var(--ink-soft)]" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)]">
                    <Users className="h-3 w-3 shrink-0" />
                    <span className="truncate">{whoLabel(r, submitterGroups)}</span>
                    {(r.minImages ?? 0) > 0 && <span className="shrink-0">· รูป ≥ {r.minImages ?? 0}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" className="w-full" onClick={() => { setEditingRound(null); setRoundDialogOpen(true); }}>
            <Plus className="mr-1 h-3.5 w-3.5" />เพิ่มรอบส่ง
          </Button>

          {rounds.length > 0 && (() => {
            const ids = resolvedSubmittersOfTopic(memberTopic, submitterGroups);
            const names = ids.map((id) => allUsers.find((u) => u.id === id)?.name ?? "?");
            return (
              <div className="rounded-lg bg-[var(--bg-soft)] p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <UserCheck className="h-3.5 w-3.5 text-[var(--tone-ok)]" />คนที่ต้องส่งจริงในห้องนี้ · {ids.length} คน
                </div>
                {names.length > 0 && <p className="mt-1 text-[11px] text-[var(--ink-soft)]">{names.slice(0, 12).join(", ")}{names.length > 12 ? ` +${names.length - 12}` : ""}</p>}
                <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--ink-soft)]"><Check className="h-3 w-3 text-[var(--tone-ok)]" />คนลา/หยุดวันนั้นระบบไม่นับให้อัตโนมัติ</p>
              </div>
            );
          })()}
        </div>

        <SubmissionRoundDialog
          // key forces a remount whenever which round is being edited
          // changes (including switching to/from "add new") — its form
          // fields are plain useState seeded from `initial` once on mount,
          // so without this, opening it for a different round (or a second
          // "add" after editing one) kept showing whatever was left over
          // from the previous open instead of that round's real values.
          key={editingRound?.id ?? "new"}
          open={roundDialogOpen}
          onOpenChange={setRoundDialogOpen}
          initial={editingRound}
          onSave={saveRound}
        />
      </div>
  );
}
