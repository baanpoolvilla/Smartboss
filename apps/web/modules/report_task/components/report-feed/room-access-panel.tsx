"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Eye, Globe, Lock, Minus, MessageSquare, PenLine, Search, AlarmClock, SlidersHorizontal } from "lucide-react";
import { Input } from "@/modules/report_task/components/ui/input";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { useReportFeedStore, type ReportTopic, type ReportTopicVisibility } from "@/modules/report_task/store/report-feed-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { canManage, getUser, isDepartmentHead, isOwner } from "@/modules/report_task/lib/directory";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { topicModeOf } from "@/modules/report_task/lib/report-topic-membership";
import { resolvedSubmittersOfTopic } from "@/modules/report_task/lib/submission-rounds";
import { cn } from "@/modules/report_task/lib/utils";
import type { User } from "@/modules/report_task/types";

/**
 * "ใครเห็นห้องนี้ ทำอะไรได้บ้าง" — ตารางเดียว ติ๊กแผนก/รายคนได้ตรง ๆ และเห็นทันทีว่าแต่ละคน
 * เห็น / โพสต์ / คอมเมนต์ / ต้องส่ง ได้หรือไม่ (ผู้ใช้ 10/11/2569 "อยากให้รู้ว่ามีใครเห็นบ้าง ทำอะไรได้แบบไหน
 * มีให้ติ๊กเลือก ปรับง่ายเข้าใจง่าย ตอนนี้ยังดูงงมาก")
 *
 * เก็บข้อมูลรูปแบบเดิมทุกอย่าง (visibility: departmentIds + extraUserIds / userIds / managerOnly · postPermission ·
 * commentsDisabled) — กติกาว่าใครเห็นห้องยังเป็น canSeeReportTopic ตัวเดิม หน้านี้แค่เปลี่ยนวิธีเลือก
 *  - ติ๊กแผนก = ทั้งแผนก (รวมคนที่เข้าแผนกทีหลัง)
 *  - ติ๊กรายคน = เพิ่มรายคน (extraUserIds ถ้ามีแผนกที่ติ๊กอยู่ / userIds ถ้าไม่มีแผนกเลย)
 *  - เอาคนออกจากแผนกที่ติ๊กทั้งแผนก = แผนกนั้นกลายเป็นรายคน (คนอื่นยังเห็นเหมือนเดิม คนเข้าใหม่ไม่เห็นอัตโนมัติ)
 */

type Mode = "open" | "custom" | "manager";

function Tick({ state, disabled, onClick, label }: { state: boolean | "some"; disabled?: boolean; onClick?: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "some" ? "mixed" : state}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-[18px] w-[18px] shrink-0 rounded border flex items-center justify-center transition-colors",
        state ? "bg-[var(--brand-navy,#1f3a5f)] border-[var(--brand-navy,#1f3a5f)] text-white" : "border-[var(--line-strong,#c5ccd3)] bg-white",
        disabled ? "opacity-45 cursor-not-allowed" : "cursor-pointer hover:border-[var(--brand-navy,#1f3a5f)]"
      )}
    >
      {state === "some" ? <Minus className="h-3 w-3" /> : state ? <Check className="h-3 w-3" /> : null}
    </button>
  );
}

function Cap({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      title={label}
      className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full", on ? "text-[var(--brand-navy,#1f3a5f)]" : "text-[var(--ink-faint,#b7bec7)]")}
    >
      {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Minus className="h-3.5 w-3.5" />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function RoomAccessPanel({
  topic,
  apply,
  staged,
  viewingAsUserId,
  hideTitle,
  readOnly,
}: {
  /** อยู่ใต้แท็บ "ใครเห็นห้อง" ที่บอกชื่อไว้แล้ว — ไม่ต้องขึ้นหัวข้อซ้ำ */
  hideTitle?: boolean;
  /** ดูอย่างเดียว — คนที่แก้ห้องนี้ไม่ได้ กดปุ่มจำนวนสมาชิกบนหัวห้อง (ไม่มีอะไรกดเปลี่ยนได้) */
  readOnly?: boolean;
  /** ห้อง (หรือ draft ของหน้าต่างตั้งค่าห้อง) — อ่าน visibility/postPermission/commentsDisabled/รอบส่ง จากที่นี่ */
  topic: ReportTopic;
  apply: (patch: Partial<ReportTopic>) => void;
  /** true = เข้า draft รอกดบันทึก (แจ้งเตือนคนที่ถูกเพิ่มตอนบันทึก) · false = บันทึกทันที แจ้งเตือนที่นี่ */
  staged: boolean;
  viewingAsUserId: string;
}) {
  const employees = useEmployeeStore((s) => s.employees);
  const loaded = useEmployeeStore((s) => s.loaded);
  const depts = useDepartmentStore((s) => s.departments);
  const submitterGroups = useReportFeedStore((s) => s.submitterGroups);
  const [search, setSearch] = useState("");
  // คนเยอะ (ผู้ใช้ 10/11/2569 "ถ้าคนในแผนกเยอะ มันไม่ขึ้นยาวเลยหรอ") — เกิน SMALL_ORG คน แผนกพับไว้ก่อน เห็นแค่หัวแผนก+ตัวเลข
  // กดเปิดทีละแผนก · แผนกหนึ่งโชว์ทีละ PAGE คน แล้วกด "ดูอีก N คน" · ตารางสูงสุด ~60% จอ เลื่อนในกรอบ หัวตารางค้างไว้
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");

  const vis = topic.visibility;
  const legacyMode = topicModeOf(vis);
  const mode: Mode = legacyMode === "open" ? "open" : legacyMode === "manager" ? "manager" : "custom";
  const owner = isOwner(viewingAsUserId);
  const ownDeptId = getUser(viewingAsUserId)?.departmentId;
  const deptIds = useMemo(() => new Set(mode === "custom" ? (vis?.departmentIds ?? []) : []), [mode, vis?.departmentIds]);
  const people = useMemo(() => new Set(mode === "custom" ? [...(vis?.userIds ?? []), ...(vis?.extraUserIds ?? [])] : []), [mode, vis?.userIds, vis?.extraUserIds]);

  const submitters = useMemo(() => new Set(resolvedSubmittersOfTopic(topic, submitterGroups)), [topic, submitterGroups]);
  const sees = (u: User) => canSeeReportTopic(vis, u.id);
  const canPost = (u: User) => sees(u) && (topic.postPermission !== "managersOnly" || canManage(u.id));
  const canComment = (u: User) => sees(u) && !topic.commentsDisabled;

  const counts = useMemo(() => {
    const seeing = employees.filter((u) => canSeeReportTopic(vis, u.id));
    return {
      see: seeing.length,
      post: seeing.filter((u) => topic.postPermission !== "managersOnly" || canManage(u.id)).length,
      comment: topic.commentsDisabled ? 0 : seeing.length,
      send: employees.filter((u) => submitters.has(u.id)).length,
    };
  }, [employees, vis, topic.postPermission, topic.commentsDisabled, submitters]);

  /** บันทึก visibility แบบ "เลือกเอง" — แปลงกลับเป็นรูปแบบเดิม (departmentIds+extraUserIds หรือ userIds) */
  function commitCustom(nextDepts: Set<string>, nextPeople: Set<string>) {
    // คนที่อยู่ในแผนกที่ติ๊กแล้ว ไม่ต้องเก็บซ้ำเป็นรายคน
    const deptOf = new Map(employees.map((u) => [u.id, u.departmentId]));
    const extras = [...nextPeople].filter((id) => !nextDepts.has(deptOf.get(id) ?? ""));
    if (nextDepts.size === 0 && extras.length === 0) {
      toast.error("ต้องมีอย่างน้อย 1 แผนกหรือ 1 คนที่เห็นห้องนี้ — ถ้าจะให้ทุกคนเห็น เลือก \"ทุกคนในบริษัท\"");
      return;
    }
    const exemptUserIds = vis?.exemptUserIds;
    const next: ReportTopicVisibility =
      nextDepts.size > 0
        ? { departmentIds: [...nextDepts], extraUserIds: extras, ...(exemptUserIds ? { exemptUserIds } : {}) }
        : { userIds: extras, ...(exemptUserIds ? { exemptUserIds } : {}) };
    applyVisibility(next);
  }

  function applyVisibility(next: ReportTopicVisibility | undefined) {
    if (!staged) {
      const added = employees
        .filter((u) => u.id !== viewingAsUserId && !canSeeReportTopic(vis, u.id) && canSeeReportTopic(next, u.id))
        .map((u) => u.id);
      if (added.length > 0) {
        const actorName = getUser(viewingAsUserId)?.name ?? "มีคน";
        useNotificationStore
          .getState()
          .notifyMany(added, viewingAsUserId, `${actorName} เพิ่มคุณเข้าห้อง Report "${topic.name}"`, undefined, `/chat-report/report-feed?topic=${topic.id}`, topic.name);
      }
    }
    apply({ visibility: next });
  }

  function setMode(next: Mode) {
    if (readOnly) return;
    if (next === mode) return;
    if (!owner) return;
    if (next === "open") return applyVisibility(undefined);
    if (next === "manager") return applyVisibility({ managerOnly: true });
    // เลือกเอง — เริ่มจากคนที่เห็นอยู่ตอนนี้ (ไม่มีใครหลุดหรือได้เพิ่มเพราะแค่สลับโหมด) · ยกเว้นเริ่มจากทุกคน = เริ่มที่แผนกตัวเอง
    if (mode === "manager") {
      const heads = employees.filter((u) => !u.isOwner && isDepartmentHead(u.id)).map((u) => u.id);
      if (heads.length > 0) return applyVisibility({ userIds: heads });
    }
    // จากทุกคน: ติ๊กทุกแผนกที่ไม่มีคนงานรายวันปน (แผนกที่มีปน = ติ๊กรายคนเฉพาะคนที่ไม่ใช่คนงาน) + คนไม่มีแผนก
    // ⇒ คนที่เห็นห้องหลังสลับ = คนเดิมเป๊ะ แล้วค่อยติ๊กออกเอง
    const seen = employees.filter((u) => !u.isOwner && canSeeReportTopic(vis, u.id));
    const fullDepts = depts.filter((d) => {
      const members = employees.filter((u) => u.departmentId === d.id && !u.isOwner);
      return members.length > 0 && members.every((u) => seen.includes(u));
    }).map((d) => d.id);
    const fullSet = new Set(fullDepts);
    const extras = seen.filter((u) => !fullSet.has(u.departmentId)).map((u) => u.id);
    if (fullDepts.length > 0) applyVisibility({ departmentIds: fullDepts, extraUserIds: extras });
    else applyVisibility({ userIds: extras.length ? extras : [viewingAsUserId] });
  }

  function toggleDept(deptId: string) {
    if (readOnly) return;
    if (mode !== "custom") return;
    if (!owner && deptId === ownDeptId) return;
    const nextDepts = new Set(deptIds);
    const nextPeople = new Set(people);
    const members = employees.filter((u) => u.departmentId === deptId);
    const nonOwners = members.filter((u) => !u.isOwner);
    const allPicked = nonOwners.length > 0 && nonOwners.every((u) => nextPeople.has(u.id));
    if (nextDepts.has(deptId) || allPicked) {
      nextDepts.delete(deptId);
      for (const u of members) nextPeople.delete(u.id);
    } else {
      // ติ๊กแผนกที่มีคนถูกติ๊กรายคนอยู่บางคน = ทั้งแผนก
      nextDepts.add(deptId);
    }
    commitCustom(nextDepts, nextPeople);
  }

  function togglePerson(u: User) {
    if (readOnly) return;
    if (mode !== "custom" || u.isOwner) return;
    const nextDepts = new Set(deptIds);
    const nextPeople = new Set(people);
    if (sees(u)) {
      if (u.departmentId && nextDepts.has(u.departmentId)) {
        if (!owner && u.departmentId === ownDeptId) {
          toast.error("เอาคนในแผนกตัวเองออกไม่ได้ — ต้องให้เจ้าของบริษัทปรับให้");
          return;
        }
        // แผนกนี้เปลี่ยนจาก "ทั้งแผนก" เป็นรายคน — คนอื่นในแผนกยังเห็นเหมือนเดิม
        nextDepts.delete(u.departmentId);
        for (const m of employees) if (m.departmentId === u.departmentId && m.id !== u.id && !m.isOwner) nextPeople.add(m.id);
        toast.info(`แผนก "${depts.find((d) => d.id === u.departmentId)?.name ?? ""}" เปลี่ยนเป็นเลือกรายคนแล้ว — คนที่เข้าแผนกนี้ทีหลังจะไม่เห็นห้องอัตโนมัติ`);
      }
      nextPeople.delete(u.id);
    } else {
      nextPeople.add(u.id);
    }
    commitCustom(nextDepts, nextPeople);
  }

  function reasonOf(u: User): string {
    if (u.isOwner) return "เจ้าของบริษัท · เห็นทุกห้อง";
    if (mode === "open") return u.isWorker ? "คนงานรายวัน · ไม่เห็นห้องที่เปิดให้ทุกคน" : "ห้องเปิดให้ทุกคน";
    if (mode === "manager") return isDepartmentHead(u.id) ? "หัวหน้าแผนก" : "";
    if (u.departmentId && deptIds.has(u.departmentId)) return "ติ๊กทั้งแผนก";
    if (people.has(u.id)) return "เลือกรายคน";
    return "";
  }

  const q = search.trim().toLowerCase();
  const SMALL_ORG = 15;
  const PAGE = 10;
  const smallOrg = employees.length <= SMALL_ORG;
  const groups = useMemo(() => {
    const byDept = new Map<string, User[]>();
    for (const u of employees) {
      const key = u.departmentId && depts.some((d) => d.id === u.departmentId) ? u.departmentId : "";
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(u);
    }
    const list = [
      ...depts.map((d) => ({ id: d.id, name: d.name, users: byDept.get(d.id) ?? [] })),
      ...(byDept.get("")?.length ? [{ id: "", name: "ไม่มีแผนก", users: byDept.get("")! }] : []),
    ];
    return list
      .map((g) => ({ ...g, users: [...g.users].sort((a, b) => a.name.localeCompare(b.name, "th")) }))
      .filter((g) => g.users.length > 0);
  }, [employees, depts]);

  const modeOptions: { mode: Mode; label: string; hint: string; icon: typeof Globe }[] = [
    { mode: "open", label: "ทุกคนในบริษัท", hint: "ไม่ต้องเลือกอะไรเพิ่ม", icon: Globe },
    { mode: "custom", label: "เลือกเอง", hint: "ติ๊กแผนก หรือรายคน ด้านล่าง", icon: SlidersHorizontal },
    { mode: "manager", label: "หัวหน้าเท่านั้น", hint: "หัวหน้าแผนกทุกแผนก", icon: Lock },
  ];

  return (
    <div className="space-y-3" data-testid="room-access-panel">
      {!hideTitle && <div>
        <p className="text-sm font-semibold text-[var(--ink)]">ใครเห็นห้องนี้ ทำอะไรได้บ้าง</p>
        <p className="text-[11.5px] text-[var(--ink-soft)]">ติ๊กในตารางได้เลย ช่องขวามือบอกว่าแต่ละคนทำอะไรได้</p>
      </div>}

      {/* สรุปตัวเลข — ตอบ "มีใครเห็นบ้าง" ได้ในบรรทัดเดียว */}
      <div className="grid grid-cols-4 gap-1.5" data-testid="room-access-counts">
        {[
          { icon: Eye, label: "เห็นห้อง", n: counts.see },
          { icon: PenLine, label: "โพสต์ได้", n: counts.post },
          { icon: MessageSquare, label: "คอมเมนต์ได้", n: counts.comment },
          { icon: AlarmClock, label: "ต้องส่ง", n: counts.send },
        ].map(({ icon: Icon, label, n }) => (
          <div key={label} className="rounded-lg border border-[var(--line)] bg-white px-2 py-1.5 text-center">
            <p className="flex items-center justify-center gap-1 text-[10.5px] text-[var(--ink-soft)]">
              <Icon className="h-3 w-3" />
              {label}
            </p>
            <p className="text-base font-bold tabular-nums leading-tight">{loaded ? n : "…"}</p>
          </div>
        ))}
      </div>

      {/* 1) ใครเห็นห้อง */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-[var(--ink-soft)]">1. ใครเห็นห้องนี้</p>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="ใครเห็นห้องนี้">
          {modeOptions.map(({ mode: m, label, hint, icon: Icon }) => {
            const active = mode === m;
            const locked = (readOnly || !owner) && m !== mode;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                onClick={() => setMode(m)}
                title={locked ? "หัวหน้าแผนกเปลี่ยนแบบนี้ไม่ได้ — ต้องให้เจ้าของบริษัทเปลี่ยน" : hint}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg border px-1.5 py-2 text-center transition-colors",
                  active
                    ? "border-[var(--brand-navy,#1f3a5f)] bg-[var(--brand-navy,#1f3a5f)] text-white"
                    : locked
                      ? "border-[var(--line)] opacity-40 cursor-not-allowed"
                      : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-xs font-semibold">{label}</span>
                <span className={cn("text-[10px] leading-tight", active ? "text-white/80" : "text-[var(--ink-soft)]")}>{hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2) ทำอะไรได้ */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-[var(--ink-soft)]">{readOnly ? "2. จำกัดสิทธิ์ในห้องนี้" : "2. จำกัดสิทธิ์ (ปกติไม่ต้องเปิด — คนที่เห็นห้องโพสต์และคอมเมนต์ได้ทุกคน)"}</p>
        {/* เดิมเป็น dropdown 2 อันที่ขึ้น "ทุกคนที่เห็นห้อง" ซ้ำกับข้อ 1 (ผู้ใช้ 10/11/2569 "มันดูซ้ำซ้อนไหม") — เป็นสวิตช์ เปิดเฉพาะตอนอยากจำกัด */}
        <div className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
          <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-medium"><PenLine className="h-3.5 w-3.5" />เฉพาะหัวหน้า/ผู้ดูแลโพสต์ได้</span>
              <span className="block text-[11px] text-[var(--ink-soft)]">เหมาะกับห้องประกาศ คนอื่นอ่านได้อย่างเดียว</span>
            </span>
            <Switch
              aria-label="เฉพาะหัวหน้าโพสต์ได้"
              disabled={readOnly}
              checked={topic.postPermission === "managersOnly"}
              onCheckedChange={(v) => apply({ postPermission: v ? "managersOnly" : "everyone" })}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-medium"><MessageSquare className="h-3.5 w-3.5" />ปิดคอมเมนต์</span>
              <span className="block text-[11px] text-[var(--ink-soft)]">คอมเมนต์เดิมยังอยู่ แค่เพิ่มใหม่ไม่ได้</span>
            </span>
            <Switch
              aria-label="ปิดคอมเมนต์"
              disabled={readOnly}
              checked={!!topic.commentsDisabled}
              onCheckedChange={(v) => apply({ commentsDisabled: v })}
            />
          </label>
        </div>
        <p className="text-[10.5px] text-[var(--ink-soft)]">ช่อง &quot;ต้องส่ง&quot; มาจากรอบส่งรายงาน — เห็นห้องได้ไม่ได้แปลว่าต้องส่ง</p>
      </div>

      {/* 3) รายชื่อ */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-[var(--ink-soft)]">3. รายชื่อ{mode === "custom" && !readOnly ? " — ติ๊กเพื่อเลือก" : ""}</p>
          {!smallOrg && <p className="text-[10.5px] text-[var(--ink-soft)]">กดชื่อแผนกเพื่อดูรายชื่อ</p>}
        </div>
        {mode !== "custom" && (
          <p className="rounded-md bg-[var(--bg-soft)] px-2.5 py-1.5 text-[11px] text-[var(--ink-soft)]">
            {owner && !readOnly ? "อยากติ๊กเลือกรายคน/รายแผนก กด \"เลือกเอง\" ด้านบนก่อน" : "ดูอย่างเดียว"}
          </p>
        )}
        <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อหรือตำแหน่ง" className="pl-8 h-8 text-sm" />
        </div>
          <select
            aria-label="แสดงเฉพาะ"
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "in" | "out")}
            className="h-8 rounded-md border border-[var(--line)] bg-white px-2 text-[12.5px]"
          >
            <option value="all">ทุกคน</option>
            <option value="in">เฉพาะคนที่เห็น</option>
            <option value="out">เฉพาะคนที่ไม่เห็น</option>
          </select>
        </div>

        <div className="rounded-lg border border-[var(--line)] overflow-y-auto max-h-[60vh] sm:max-h-[440px]" data-testid="room-access-list">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-[10.5px] font-medium text-[var(--ink-soft)]">
            <span className="flex-1">ชื่อ</span>
            {[
              { icon: Eye, label: "เห็น" },
              { icon: PenLine, label: "โพสต์" },
              { icon: MessageSquare, label: "คอมเมนต์" },
              { icon: AlarmClock, label: "ต้องส่ง" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="w-12 flex flex-col items-center leading-tight">
                <Icon className="h-3 w-3" />
                <span className="text-[9.5px]">{label}</span>
              </span>
            ))}
          </div>
          {!loaded ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--ink-soft)]">กำลังโหลดรายชื่อ…</p>
          ) : (
            groups.map((g) => {
              const matched = g.users.filter(
                (u) =>
                  (!q || u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)) &&
                  (filter === "all" || (filter === "in" ? sees(u) : !sees(u)))
              );
              if (matched.length === 0) return null;
              const narrowed = !!q || filter !== "all";
              const shown = showAll.has(g.id) || narrowed ? matched : matched.slice(0, PAGE);
              const nonOwners = g.users.filter((u) => !u.isOwner);
              const seeing = g.users.filter((u) => sees(u)).length;
              const nonOwnerSeeing = nonOwners.filter((u) => sees(u)).length;
              const deptState: boolean | "some" = deptIds.has(g.id) ? true : nonOwnerSeeing === 0 ? false : nonOwnerSeeing === nonOwners.length ? true : "some";
              const isCollapsed = !narrowed && (smallOrg ? toggled.has(g.id) : !toggled.has(g.id));
              const deptLocked = !!readOnly || mode !== "custom" || !g.id || (!owner && g.id === ownDeptId);
              return (
                <div key={g.id || "none"} className="border-b border-[var(--line)] last:border-b-0">
                  <div className="flex items-center gap-2 bg-white px-2.5 py-1.5" data-testid={`room-access-dept-${g.name}`}>
                    <Tick
                      state={deptState}
                      disabled={deptLocked}
                      onClick={() => toggleDept(g.id)}
                      label={`ทั้งแผนก ${g.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => setToggled((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                      className="flex flex-1 items-center gap-1.5 text-left"
                    >
                      <span className="text-[13px] font-semibold">{g.name}</span>
                      <span className="text-[11px] text-[var(--ink-soft)]">เห็น {seeing}/{g.users.length} คน</span>
                      {deptIds.has(g.id) && <span className="rounded-full bg-[var(--bg-soft)] px-1.5 text-[10px] text-[var(--ink-soft)]">ทั้งแผนก</span>}
                      <ChevronDown className={cn("ml-auto h-3.5 w-3.5 text-[var(--ink-soft)] transition-transform", isCollapsed && "-rotate-90")} />
                    </button>
                  </div>
                  {!isCollapsed &&
                    shown.map((u) => {
                      const s = sees(u);
                      const reason = reasonOf(u);
                      return (
                        <div key={u.id} className={cn("flex items-center gap-2 px-2.5 py-1.5 pl-7", !s && "bg-[var(--bg-soft)]/40")} data-testid={`room-access-row-${u.name}`}>
                          <Tick state={s} disabled={!!readOnly || mode !== "custom" || !!u.isOwner} onClick={() => togglePerson(u)} label={`${u.name} เห็นห้องนี้`} />
                          <div className="min-w-0 flex-1">
                            <p className={cn("truncate text-[13px]", s ? "text-[var(--ink)]" : "text-[var(--ink-soft)]")}>{u.name}</p>
                            <p className="truncate text-[10.5px] text-[var(--ink-soft)]">
                              {u.role}
                              {reason && <> · {reason}</>}
                            </p>
                          </div>
                          <span className="w-12 text-center"><Cap on={s} label="เห็นห้อง" /></span>
                          <span className="w-12 text-center"><Cap on={canPost(u)} label="โพสต์ได้" /></span>
                          <span className="w-12 text-center"><Cap on={canComment(u)} label="คอมเมนต์ได้" /></span>
                          <span className="w-12 text-center"><Cap on={submitters.has(u.id)} label="ต้องส่งรายงาน" /></span>
                        </div>
                      );
                    })}
                  {!isCollapsed && shown.length < matched.length && (
                    <button
                      type="button"
                      onClick={() => setShowAll((s) => new Set(s).add(g.id))}
                      className="w-full px-2.5 py-1.5 pl-7 text-left text-[12px] font-medium text-[var(--brand-navy,#1f3a5f)] hover:bg-[var(--bg-soft)]"
                    >
                      ดูอีก {matched.length - shown.length} คน
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
        <p className="text-[10.5px] text-[var(--ink-soft)]">
          ติ๊กแผนก = ทั้งแผนก คนที่เข้าแผนกทีหลังเห็นด้วยอัตโนมัติ · ติ๊กรายคน = เฉพาะคนนั้น · เจ้าของบริษัทเห็นทุกห้องเสมอ
        </p>
      </div>
    </div>
  );
}
