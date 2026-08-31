"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { inputClass } from "@/modules/admin/components/ui";
import type { DiscordRound } from "@/modules/report_task/lib/discord/decider";
import {
  upsertChannelAction,
  deleteChannelAction,
  upsertLinkAction,
  deleteLinkAction,
  type ChannelInput,
} from "@/modules/admin/data/discord-report-actions";

export interface ChannelRow extends ChannelInput {}
export interface LinkRow {
  discordUserId: string;
  employeeId: string;
}
export interface EmployeeRow {
  id: string;
  name: string;
  email: string;
}
export interface SubmissionRow {
  id: string;
  employeeId: string | null;
  discordUserId: string;
  channelId: string;
  topicId: string;
  roundId: string;
  postedAt: string | null;
  imageCount: number;
  status: string | null;
}

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  "on-time": { label: "✓ ตรงเวลา", cls: "bg-emerald-100 text-emerald-700" },
  late: { label: "⏰ สาย", cls: "bg-amber-100 text-amber-700" },
  missed: { label: "✕ ไม่ส่ง", cls: "bg-rose-100 text-rose-700" },
  "image-incomplete": { label: "⚠ รูปไม่ครบ", cls: "bg-amber-100 text-amber-700" },
  exempt: { label: "ยกเว้น", cls: "bg-slate-100 text-slate-600" },
};

function emptyChannel(): ChannelRow {
  return {
    discordChannelId: "",
    topicId: "",
    label: "",
    rounds: [],
    minImages: 0,
    requiredWeekdays: [],
    useRoster: true,
    keywordOnly: false,
    keyword: "daily",
    active: true,
  };
}

export function DiscordReportsClient(props: {
  channels: ChannelRow[];
  links: LinkRow[];
  employees: EmployeeRow[];
  submissions: SubmissionRow[];
  date: string;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<"review" | "channels" | "links">("review");
  const empById = new Map(props.employees.map((e) => [e.id, e]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-(--line)">
        {(
          [
            ["review", "ตรวจรายงาน"],
            ["channels", "ตั้งค่าห้อง"],
            ["links", "ผูกพนักงาน"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === key
                ? "border-(--brand-green-dark) text-(--ink)"
                : "border-transparent text-(--ink-soft) hover:text-(--ink)"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "review" && (
        <ReviewTab
          submissions={props.submissions}
          channels={props.channels}
          empById={empById}
          date={props.date}
        />
      )}
      {tab === "channels" && (
        <ChannelsTab channels={props.channels} canManage={props.canManage} />
      )}
      {tab === "links" && (
        <LinksTab
          links={props.links}
          employees={props.employees}
          empById={empById}
          canManage={props.canManage}
        />
      )}
    </div>
  );
}

/* ─────────────── แท็บ 1: ตรวจรายงาน ─────────────── */
function ReviewTab(props: {
  submissions: SubmissionRow[];
  channels: ChannelRow[];
  empById: Map<string, EmployeeRow>;
  date: string;
}) {
  const router = useRouter();
  const chLabel = new Map(props.channels.map((c) => [c.discordChannelId, c.label || c.discordChannelId]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-(--ink-soft)">วันที่</label>
        <input
          type="date"
          defaultValue={props.date}
          onChange={(e) => router.push(`/admin/discord-reports?date=${e.target.value}`)}
          className={inputClass + " w-auto"}
        />
      </div>
      {props.submissions.length === 0 ? (
        <p className="text-sm text-(--ink-soft) py-8 text-center">ยังไม่มีการส่งรายงานในวันนี้</p>
      ) : (
        <div className="overflow-x-auto border border-(--line) rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-(--ink-faint) bg-(--surface-2)">
                <th className="px-3 py-2 font-medium">พนักงาน</th>
                <th className="px-3 py-2 font-medium">ห้อง</th>
                <th className="px-3 py-2 font-medium">รอบ</th>
                <th className="px-3 py-2 font-medium">เวลาส่ง</th>
                <th className="px-3 py-2 font-medium">รูป</th>
                <th className="px-3 py-2 font-medium">ผล</th>
              </tr>
            </thead>
            <tbody>
              {props.submissions.map((s) => {
                const emp = s.employeeId ? props.empById.get(s.employeeId) : null;
                const meta = s.status ? STATUS_META[s.status] : undefined;
                const time = s.postedAt
                  ? new Date(new Date(s.postedAt).getTime() + 7 * 3600_000).toISOString().slice(11, 16)
                  : "—";
                return (
                  <tr key={s.id} className="border-t border-(--line)">
                    <td className="px-3 py-2">
                      {emp ? emp.name : <span className="text-(--ink-faint)">@{s.discordUserId} · ยังไม่ผูก</span>}
                    </td>
                    <td className="px-3 py-2">{chLabel.get(s.channelId) ?? s.channelId}</td>
                    <td className="px-3 py-2">{s.roundId}</td>
                    <td className="px-3 py-2 tabular-nums">{time}</td>
                    <td className="px-3 py-2 tabular-nums">{s.imageCount}</td>
                    <td className="px-3 py-2">
                      {meta ? (
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                          {meta.label}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────── แท็บ 2: ตั้งค่าห้อง ─────────────── */
function ChannelsTab(props: { channels: ChannelRow[]; canManage: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {props.channels.map((c) => (
        <ChannelEditor key={c.discordChannelId} initial={c} canManage={props.canManage} isNew={false} />
      ))}
      {adding ? (
        <ChannelEditor initial={emptyChannel()} canManage={props.canManage} isNew onDone={() => setAdding(false)} />
      ) : (
        props.canManage && (
          <button
            onClick={() => setAdding(true)}
            className="self-start rounded-lg border border-dashed border-(--line-strong) px-4 py-2 text-sm text-(--ink-soft) hover:text-(--ink)"
          >
            + เพิ่มห้อง
          </button>
        )
      )}
    </div>
  );
}

function ChannelEditor(props: {
  initial: ChannelRow;
  canManage: boolean;
  isNew: boolean;
  onDone?: () => void;
}) {
  const [c, setC] = useState<ChannelRow>(props.initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof ChannelRow>(k: K, v: ChannelRow[K]) => setC((p) => ({ ...p, [k]: v }));

  const save = () =>
    start(async () => {
      const r = await upsertChannelAction(c);
      setMsg(r.ok ? "บันทึกแล้ว" : r.error ?? "ผิดพลาด");
      if (r.ok) {
        props.onDone?.();
        router.refresh();
      }
    });

  const remove = () =>
    start(async () => {
      const r = await deleteChannelAction(c.discordChannelId);
      if (r.ok) router.refresh();
      else setMsg(r.error ?? "ลบไม่สำเร็จ");
    });

  const setRound = (i: number, patch: Partial<DiscordRound>) =>
    set(
      "rounds",
      c.rounds.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    );

  return (
    <div className="rounded-xl border border-(--line) bg-(--surface) p-4 flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-(--ink-soft)">ชื่อ/แผนก (ไว้แสดง)</span>
          <input className={inputClass} value={c.label} onChange={(e) => set("label", e.target.value)} placeholder="เช่น Marketing" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-(--ink-soft)">Channel ID</span>
          <input
            className={inputClass}
            value={c.discordChannelId}
            onChange={(e) => set("discordChannelId", e.target.value)}
            placeholder="1534084262792401046"
            disabled={!props.isNew}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-(--ink-soft)">Topic ID (ล้อ ReportTopic)</span>
          <input className={inputClass} value={c.topicId} onChange={(e) => set("topicId", e.target.value)} placeholder="topic-daily" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-(--ink-soft)">รูปขั้นต่ำ (ค่ากลางห้อง)</span>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={c.minImages}
            onChange={(e) => set("minImages", Number(e.target.value))}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-(--ink-soft)">วันที่ต้องส่ง (ว่าง = ยึด roster ของ HR)</span>
        <div className="flex gap-1.5 flex-wrap">
          {WEEKDAYS.map((d, i) => {
            const on = c.requiredWeekdays.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() =>
                  set(
                    "requiredWeekdays",
                    on ? c.requiredWeekdays.filter((x) => x !== i) : [...c.requiredWeekdays, i]
                  )
                }
                className={`h-8 w-8 rounded-lg text-xs ${on ? "bg-(--brand-green-dark) text-white" : "bg-(--surface-2) text-(--ink-soft)"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <span className="text-(--ink-soft)">รอบส่ง (cutoff)</span>
        {c.rounds.map((r, i) => (
          <div key={i} className="flex gap-2 items-center flex-wrap">
            <input
              className={inputClass + " w-28"}
              placeholder="ชื่อรอบ"
              value={r.label}
              onChange={(e) => setRound(i, { label: e.target.value })}
            />
            <input
              type="time"
              className={inputClass + " w-32"}
              value={r.time}
              onChange={(e) => setRound(i, { time: e.target.value })}
            />
            <input
              type="number"
              min={0}
              className={inputClass + " w-24"}
              placeholder="รูป"
              value={r.minImages ?? ""}
              onChange={(e) => setRound(i, { minImages: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
            <button type="button" onClick={() => set("rounds", c.rounds.filter((_, idx) => idx !== i))} className="text-(--ink-faint) hover:text-rose-600 text-sm">
              ลบ
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => set("rounds", [...c.rounds, { id: `r${Date.now()}`, label: "", time: "17:00" }])}
          className="self-start text-sm text-(--ink-soft) hover:text-(--ink)"
        >
          + เพิ่มรอบ
        </button>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.useRoster} onChange={(e) => set("useRoster", e.target.checked)} className="h-4 w-4" />
          ยึดวันทำงานจาก HR roster
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.keywordOnly} onChange={(e) => set("keywordOnly", e.target.checked)} className="h-4 w-4" />
          นับเฉพาะโพสต์ที่มีคำว่า
        </label>
        <input className={inputClass + " w-28"} value={c.keyword} onChange={(e) => set("keyword", e.target.value)} disabled={!c.keywordOnly} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4" />
          เปิดใช้งาน
        </label>
      </div>

      {props.canManage && (
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={pending || !c.discordChannelId}
            className="rounded-lg bg-(--brand-green-dark) px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            บันทึก
          </button>
          {!props.isNew && (
            <button onClick={remove} disabled={pending} className="rounded-lg px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50">
              ลบห้อง
            </button>
          )}
          {msg && <span className="text-xs text-(--ink-soft)">{msg}</span>}
        </div>
      )}
    </div>
  );
}

/* ─────────────── แท็บ 3: ผูกพนักงาน ─────────────── */
function LinksTab(props: {
  links: LinkRow[];
  employees: EmployeeRow[];
  empById: Map<string, EmployeeRow>;
  canManage: boolean;
}) {
  const [newUid, setNewUid] = useState("");
  const [newEmp, setNewEmp] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const add = () =>
    start(async () => {
      const r = await upsertLinkAction(newUid, newEmp);
      if (r.ok) {
        setNewUid("");
        setNewEmp("");
        router.refresh();
      }
    });
  const del = (uid: string) =>
    start(async () => {
      const r = await deleteLinkAction(uid);
      if (r.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto border border-(--line) rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-(--ink-faint) bg-(--surface-2)">
              <th className="px-3 py-2 font-medium">Discord User ID</th>
              <th className="px-3 py-2 font-medium">พนักงาน</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {props.links.map((l) => (
              <tr key={l.discordUserId} className="border-t border-(--line)">
                <td className="px-3 py-2 font-mono text-xs">{l.discordUserId}</td>
                <td className="px-3 py-2">{props.empById.get(l.employeeId)?.name ?? l.employeeId}</td>
                <td className="px-3 py-2 text-right">
                  {props.canManage && (
                    <button onClick={() => del(l.discordUserId)} disabled={pending} className="text-(--ink-faint) hover:text-rose-600 text-sm">
                      ลบ
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {props.links.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-(--ink-soft)">ยังไม่มีการผูก</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {props.canManage && (
        <div className="flex gap-2 flex-wrap items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-(--ink-soft)">Discord User ID</span>
            <input className={inputClass} value={newUid} onChange={(e) => setNewUid(e.target.value)} placeholder="1112223334" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-(--ink-soft)">พนักงาน</span>
            <select className={inputClass} value={newEmp} onChange={(e) => setNewEmp(e.target.value)}>
              <option value="">— เลือก —</option>
              {props.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.email})
                </option>
              ))}
            </select>
          </label>
          <button onClick={add} disabled={pending || !newUid || !newEmp} className="rounded-lg bg-(--brand-green-dark) px-4 py-2 text-sm text-white disabled:opacity-50">
            ผูก
          </button>
        </div>
      )}
    </div>
  );
}
