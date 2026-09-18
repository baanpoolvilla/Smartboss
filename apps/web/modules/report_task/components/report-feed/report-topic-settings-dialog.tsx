"use client";

import { useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Label } from "@/modules/report_task/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { RoomMembersSummaryCard, RoomMembersDialog } from "@/modules/report_task/components/report-feed/room-members-dialog";
import { useReportFeedStore, type ReportTopic, type SubmissionRound } from "@/modules/report_task/store/report-feed-store";
import { SubmissionRoundDialog } from "@/modules/report_task/components/report-feed/submission-round-dialog";
import { TimePickerField } from "@/modules/report_task/components/shared/time-picker-field";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { resolvedSubmittersOfTopic } from "@/modules/report_task/lib/submission-rounds";
import { users as allUsers } from "@/modules/report_task/lib/directory";
import { departments, getUser, isOwner } from "@/modules/report_task/lib/directory";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { topicModeOf } from "@/modules/report_task/lib/report-topic-membership";
import { canEditReportTopic, canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { useReminderSettingsStore } from "@/modules/report_task/store/reminder-settings-store";
import { useRoomSettingsIntroStore } from "@/modules/report_task/store/room-settings-intro-store";
import { cn } from "@/modules/report_task/lib/utils";
import { uuid } from "@/modules/report_task/lib/uuid";
import { toast } from "sonner";
import { Check, ClipboardCopy, Clock, Globe, HelpCircle, Lock, Pencil, Plus, Trash2, TriangleAlert, User, Users, UserCheck, X } from "lucide-react";

/**
 * แบนเนอร์ต้อนรับ — โผล่อัตโนมัติครั้งแรกที่คนคนนั้นเปิดหน้าตั้งค่าห้อง (ทุกห้อง
 * นับรวมกัน ไม่แยกต่อห้อง — ดู room-settings-intro-store.ts) สรุปทั้ง 4
 * หัวข้อที่หน้านี้คุมได้ พร้อมเน้น 2 จุดที่มักสับสน:
 * "ใครเห็นห้อง" ≠ "รอบส่ง" (เห็นห้องได้ไม่ได้แปลว่าต้องส่ง) และรอบส่งที่แก้ไข
 * แล้วจะแจ้งเตือนคนที่เกี่ยวข้องอัตโนมัติทันที. กดปิดแล้วไม่โผล่อีก แต่เปิดดูซ้ำ
 * ได้เสมอผ่านปุ่ม "?" ข้างหัวเรื่อง — ตั้งใจไม่ทำเป็นทัวร์สปอตไลต์แยกต่างหาก
 * (เคยพิจารณาไว้) เพราะจะพูดเรื่องเดียวกันซ้ำสองรอบ งงกว่าเดิม.
 */
function RoomSettingsIntroBanner({ viewingAsUserId }: { viewingAsUserId: string }) {
  const seenBy = useRoomSettingsIntroStore((s) => s.seenBy);
  const markSeen = useRoomSettingsIntroStore((s) => s.markSeen);
  const [forceOpen, setForceOpen] = useState(false);
  const seen = !!seenBy[viewingAsUserId];
  const open = forceOpen || !seen;

  return (
    <div className="flex items-start justify-between gap-2">
      {!open && (
        <button
          type="button"
          onClick={() => setForceOpen(true)}
          aria-label="เปิดดูคำอธิบายหน้าตั้งค่าห้องอีกครั้ง"
          title="หน้านี้ตั้งค่าอะไรได้บ้าง"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] shrink-0"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      )}
      {open && (
        <div className="w-full rounded-xl border border-[var(--brand-green)]/35 bg-gradient-to-b from-[var(--accent)] to-[var(--accent)]/60 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--ink)]">👋 หน้านี้ตั้งค่าได้ 4 อย่าง</span>
            <button
              type="button"
              onClick={() => {
                markSeen(viewingAsUserId);
                setForceOpen(false);
              }}
              aria-label="ปิดคำอธิบายนี้"
              className="text-[var(--ink-faint)] hover:text-[var(--ink)] shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ol className="space-y-1.5">
            <li className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--ink)]">
              <span className="font-semibold text-[var(--brand-green-dark)] shrink-0">1.</span>
              <span><b>ใครเห็นห้อง</b> — ใครเปิดเข้ามาอ่านได้</span>
            </li>
            <li className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--ink)]">
              <span className="font-semibold text-[var(--brand-green-dark)] shrink-0">2.</span>
              <span>
                <b>รอบส่ง</b> — ใครต้องส่งจริง + กี่โมง{" "}
                <span className="inline-flex items-center gap-0.5 text-[var(--danger)] font-medium">
                  <TriangleAlert className="h-3 w-3 shrink-0" />คนละเรื่องกับข้อ 1 นะ
                </span>{" "}
                — เห็นห้องได้ไม่ได้แปลว่าต้องส่ง
              </span>
            </li>
            <li className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--ink)]">
              <span className="font-semibold text-[var(--brand-green-dark)] shrink-0">3.</span>
              <span><b>แจ้งเตือน</b> — เตือนคนที่ยังไม่ส่งให้อัตโนมัติ</span>
            </li>
            <li className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--ink)]">
              <span className="font-semibold text-[var(--brand-green-dark)] shrink-0">4.</span>
              <span><b>ปิดรับอัตโนมัติ</b> — ล็อกจริง ส่งไม่ได้เมื่อเลยเวลา</span>
            </li>
          </ol>
          <p className="text-[11px] leading-relaxed text-[var(--ink-soft)]">
            💡 แก้ข้อ 2 เมื่อไหร่ คนที่เกี่ยวข้องได้รับแจ้งเตือนทันทีอัตโนมัติ
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                markSeen(viewingAsUserId);
                setForceOpen(false);
              }}
            >
              เข้าใจแล้ว
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
function daysLabel(w?: number[], dayOfMonth?: number): string {
  if (dayOfMonth) return `วันที่ ${dayOfMonth} ของเดือน`;
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
  const lockSettings = useReminderSettingsStore((s) => s.settings.submissionLock);
  const apply = onUpdate ?? ((patch: Partial<ReportTopic>) => updateTopicSettings(topic.id, patch));
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const submitterGroups = useReportFeedStore((s) => s.submitterGroups);
  const allTopics = useReportFeedStore((s) => s.topics);
  const [roundDialogOpen, setRoundDialogOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<SubmissionRound | null>(null);
  // Which round's "คัดลอกไปห้องอื่น" popover is open, and which target rooms
  // are checked in it — keyed by round id so opening one round's popover
  // doesn't carry over a selection made in another's.
  const [copyRoundId, setCopyRoundId] = useState<string | null>(null);
  const [copyTargetIds, setCopyTargetIds] = useState<string[]>([]);
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

  // Rooms this same viewer can actually edit the settings of — same gate the
  // sidebar already uses to decide whether this whole dialog is reachable
  // for a room, so a department head only ever sees their own rooms as copy
  // targets, never a room they couldn't open this dialog for themselves.
  // ไม่รวมห้องที่เก็บเข้ากรุแล้ว (archived) — เห็นในเมนูจริงก็แค่จางๆ/พับไว้
  // ("เห็นห้องที่ไม่มีในแถบเมนูด้วย") คัดลอกรอบส่งเข้าห้องที่เลิกใช้แล้วไม่มี
  // ประโยชน์อะไร มีแต่จะงงว่าทำไมมีห้องโผล่มาที่หาไม่เจอในแถบข้าง
  //
  // canEditReportTopic เพียงอย่างเดียวไม่พอ — มันเช็คแค่ department-head match
  // บน departmentIds เท่านั้น ไม่ได้เช็ค userIds/managerOnly เหมือน
  // canSeeReportTopic ที่แถบข้าง (sidebar) ใช้กรอง `topics` ก่อนส่งลงมา ทำให้
  // ห้องที่ตั้ง visibility แบบเฉพาะบุคคล/ผู้จัดการเท่านั้น หลุดผ่าน canEditReportTopic
  // มาโผล่ในลิสต์นี้ได้ทั้งที่แถบข้างไม่โชว์เลย ("test ในหัวข้อหลัก แต่ทำไมหน้า
  // เว็ปไม่แสดง") — ต้องผ่านทั้งคู่ ให้ตรงกับสิ่งที่ผู้ใช้เห็นในแถบข้างจริงๆ
  //
  // ยังไม่พอจริงๆ — "test" ที่ยังโผล่ (แม้หลังแก้ข้อบน) ไม่ใช่ปัญหาสิทธิ์เลย แต่
  // เป็นหัวข้อหลักแบบ "ห้องใหม่แยกอิสระ" (isCategory: true) ที่ไม่มีห้องย่อยอยู่
  // ข้างใต้แล้ว — ตัวมันเองกดแชทไม่ได้ตั้งแต่ต้น ("หัวข้อหลักไว้จัดหมวดหมู่
  // เท่านั้น กดแชทเองไม่ได้") แถบข้างเลยซ่อนหัวข้อแบบนี้อัตโนมัติเมื่อไม่มีลูกให้
  // จัดหมวดแล้ว (ดู visibleTopics ใน report-feed/page.tsx) — คัดลอกรอบส่งไปที่
  // นี่ไม่มีทางทำได้จริงอยู่แล้ว ต้องกันออกจากลิสต์นี้ตรงๆ ไม่ใช่แค่พึ่งสิทธิ์มองเห็น
  const copyTargets = allTopics.filter(
    (t) =>
      t.id !== topic.id &&
      !t.archived &&
      !t.isCategory &&
      canSeeReportTopic(t.visibility, viewingAsUserId) &&
      canEditReportTopic(t.visibility, viewingAsUserId)
  );
  // จัดกลุ่มตามหัวข้อแม่ให้เห็นชัดว่าห้องไหนอยู่ตรงไหน ("แยกหมวดหมู่ให้ชัดเจน
  // หน่อย") แทนลิสต์แบนที่แค่ต่อชื่อห้องแม่ท้ายชื่อ — และตอบคำถาม "ทำไม test
  // ยังโชว์อยู่" ตรงๆ ในตัว UI เลย: ห้องที่มี parentId แต่หาห้องแม่ไม่เจอ (ห้อง
  // แม่ถูกลบไปแล้ว เหลือแต่ห้องลูกลอยอยู่) จะขึ้นกลุ่ม "ไม่มีหมวดหมู่" แยกออกมา
  // ชัดๆ แทนที่จะเงียบๆ ไม่บอกอะไรเหมือนเดิม
  const copyTargetGroups = (() => {
    const groups = new Map<string, { label: string; items: ReportTopic[] }>();
    for (const t of copyTargets) {
      const key = !t.parentId ? "" : t.parentId;
      const label = !t.parentId ? "หัวข้อหลัก" : (allTopics.find((p) => p.id === t.parentId)?.name ?? "ไม่มีหมวดหมู่ (หาหัวข้อแม่ไม่เจอ)");
      if (!groups.has(key)) groups.set(key, { label, items: [] });
      groups.get(key)!.items.push(t);
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "th"));
  })();

  function toggleCopyTarget(id: string) {
    setCopyTargetIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  // Adds the round as a brand-new round (fresh id) in every picked room —
  // never overwrites/replaces whatever that room's own rounds already are,
  // so copying is always additive and the destination stays editable on its
  // own afterward (same "each room owns its own rounds after that" as
  // filling out the add-round form by hand would).
  function copyRoundToRooms(round: SubmissionRound, targetIds: string[]) {
    for (const id of targetIds) {
      const target = allTopics.find((t) => t.id === id);
      if (!target) continue;
      const targetRounds = target.submissionRounds ?? [];
      updateTopicSettings(id, { submissionRounds: [...targetRounds, { ...round, id: `round-${uuid()}` }] });
    }
    toast.success(`คัดลอกรอบ "${round.label}" ไปอีก ${targetIds.length} ห้องแล้ว`);
    setCopyRoundId(null);
    setCopyTargetIds([]);
  }

  // This room's own "ปิดรับ" time picker — reused both when the company-wide
  // toggle is off (every room always uses its own) and when it's on but this
  // room opted itself out via hardCutoffExemptFromGlobal.
  function ownHardCutoffEditor(indent = true) {
    const pad = indent ? "pl-4" : "";
    return topic.hardCutoffTime ? (
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", pad)}>
        <TimePickerField
          className="w-[104px] shrink-0"
          value={topic.hardCutoffTime}
          onChange={(time) => apply({ hardCutoffTime: time || undefined })}
          aria-label="เวลาปิดรับของห้องนี้"
        />
        <span className="text-[11px] text-[var(--ink-soft)]">น. — เลยเวลานี้ส่งรายงานของวันนั้นไม่ได้อีก (เปิดรับใหม่ทุกเที่ยงคืน)</span>
      </div>
    ) : (
      <p className={cn("text-[11px] text-[var(--ink-faint)]", pad)}>ปิดอยู่ — ส่งได้ตลอดเวลา ไม่มีการปิดรับ</p>
    );
  }

  return (
    <div className="space-y-4">
      {!hideHeading && (
        <div>
          <h2 className="text-base font-semibold">ตั้งค่าห้อง &quot;{topic.name}&quot;</h2>
          <p className="text-sm text-[var(--ink-soft)] mt-0.5">กำหนดข้อบังคับการส่งรีพอตของห้องนี้ — ปรับด้วยตัวเองได้ตลอด</p>
        </div>
      )}

      <RoomSettingsIntroBanner viewingAsUserId={viewingAsUserId} />

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
            <p className="text-[11px] text-[var(--ink-soft)]">
              ป้าย ⏰ &quot;ยังไม่ส่ง&quot; ในแถบข้างเห็นเฉพาะคนที่ต้องส่งรอบนี้จริง + เจ้าของบริษัท + หัวหน้าแผนกของห้อง (ตามสิทธิ) — คนอื่นที่แค่เห็นห้องไม่เห็นป้ายนี้
            </p>
            <p className="text-[11px] text-[var(--ink-soft)]">
              ทุกครั้งที่เพิ่ม/แก้ไข/ลบรอบ ระบบแจ้งเตือนให้อัตโนมัติ — เฉพาะคนที่ได้รับผลกระทบจริง (ถูกเพิ่มเป็นผู้ส่ง/ถูกถอด/เวลาเปลี่ยน) เท่านั้น ไม่ต้องไปบอกเองนอกระบบ
            </p>
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
                    <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">{daysLabel(r.weekdays, r.dayOfMonth)}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {copyTargets.length > 0 && (
                        <Popover
                          open={copyRoundId === r.id}
                          onOpenChange={(open) => {
                            setCopyRoundId(open ? r.id : null);
                            if (open) setCopyTargetIds([]);
                          }}
                        >
                          <PopoverTrigger
                            render={
                              <Button variant="ghost" size="icon" aria-label={`คัดลอกรอบ ${r.label} ไปห้องอื่น`} title="คัดลอกไปห้องอื่น">
                                <ClipboardCopy className="h-3.5 w-3.5 text-[var(--brand-green-dark)]" />
                              </Button>
                            }
                          />
                          <PopoverContent align="end" className="w-64 p-2.5">
                            <p className="text-xs font-semibold">คัดลอกรอบนี้ไปห้องอื่น</p>
                            <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                              เลือกห้องปลายทาง — เพิ่มรอบใหม่ให้ ไม่ทับรอบเดิมที่มีอยู่
                            </p>
                            <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                              {copyTargetGroups.map((g) => (
                                <div key={g.label}>
                                  <p className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">{g.label}</p>
                                  <div className="space-y-0.5">
                                    {g.items.map((t) => {
                                      const checked = copyTargetIds.includes(t.id);
                                      return (
                                        <label
                                          key={t.id}
                                          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-[var(--bg-soft)] cursor-pointer"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleCopyTarget(t.id)}
                                            className="h-3.5 w-3.5 accent-[var(--brand-green)]"
                                          />
                                          <span className="truncate">{t.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2.5 flex gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => {
                                  setCopyRoundId(null);
                                  setCopyTargetIds([]);
                                }}
                              >
                                ยกเลิก
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1"
                                disabled={copyTargetIds.length === 0}
                                onClick={() => copyRoundToRooms(r, copyTargetIds)}
                              >
                                คัดลอก{copyTargetIds.length > 0 ? ` (${copyTargetIds.length})` : ""}
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
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

          {/* ปิดรับรายงาน — separate from the rounds above (those only badge
              "สาย"); this is the one thing that actually disables the
              composer's submit button once passed. Read-only + a link to
              the company-wide setting when that's on, since it overrides
              whatever's picked here. */}
          <div className="rounded-lg border border-[var(--line)] p-2.5 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label className="flex items-center gap-1 text-xs text-[var(--ink-soft)]">
                  <Lock className="h-3 w-3 shrink-0" />ปิดรับรายงานของห้องนี้อัตโนมัติ
                </Label>
                {lockSettings.useGlobalCutoff && (
                  <p className="mt-1 text-[11px] text-[var(--ink-soft)]">
                    ใช้เวลาปิดรับกลางที่ตั้งรวมทุกห้องอยู่: <b className="text-[var(--ink)]">{lockSettings.time} น.</b> — แก้ที่การตั้งค่า ▸ แจ้งเตือนใกล้ถึงกำหนด
                  </p>
                )}
              </div>
              {!lockSettings.useGlobalCutoff && (
                <Switch
                  className="shrink-0"
                  checked={!!topic.hardCutoffTime}
                  onCheckedChange={(v) => apply({ hardCutoffTime: v ? (topic.hardCutoffTime || lockSettings.time) : undefined })}
                />
              )}
            </div>

            {lockSettings.useGlobalCutoff ? (
              <div className="space-y-1.5 pl-4">
                <label className="flex items-center gap-2 text-[11px] text-[var(--ink-soft)] cursor-pointer">
                  <Switch
                    className="shrink-0"
                    checked={!!topic.hardCutoffExemptFromGlobal}
                    onCheckedChange={(v) =>
                      apply({ hardCutoffExemptFromGlobal: v, hardCutoffTime: v ? (topic.hardCutoffTime || lockSettings.time) : topic.hardCutoffTime })
                    }
                  />
                  ยกเว้นห้องนี้จากเวลากลาง — ใช้เวลาของตัวเอง
                </label>
                {topic.hardCutoffExemptFromGlobal && ownHardCutoffEditor(false)}
              </div>
            ) : (
              ownHardCutoffEditor()
            )}
          </div>
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
          topicVisibility={visibility}
        />
      </div>
  );
}
