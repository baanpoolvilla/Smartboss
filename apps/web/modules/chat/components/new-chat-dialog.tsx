"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, Users, X } from "lucide-react";
import { cn } from "@smartboss/ui/cn";

import type { ChatUser } from "../types";
import { ChatAvatar } from "./chat-avatar";

/** หน้าต่างลอยพื้นฐานของแชท — มือถือเต็มจอ, คอมเป็นกล่องกลางจอ */
export function ChatModal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  // วาดที่ <body> — กรอบของหน้าขังลำดับชั้นไว้ ไม่งั้นเมนูล่างของระบบบนมือถือทับปุ่มล่างของหน้าต่างนี้
  return createPortal(
    <div className="chat-ui fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-(--bg) shadow-2xl sm:h-auto sm:max-h-[80vh] sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center gap-2 border-b border-(--line) px-4 py-3">
          <h3 className="flex-1 text-[15px] font-semibold text-(--ink)">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label="ปิด">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-(--line) p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/** รายชื่อพนักงานพร้อมค้นหา + กรองตามแผนก (เลือกหลายคนได้) */
export function MemberPicker({
  users,
  selected,
  onToggle,
  onToggleMany,
  onlineIds,
  exclude,
}: {
  users: ChatUser[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleMany?: (ids: string[], on: boolean) => void;
  onlineIds: Record<string, true>;
  exclude?: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState<string | null>(null);

  const pool = useMemo(() => users.filter((u) => !exclude?.has(u.id)), [users, exclude]);
  const departments = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of pool) if (u.departmentId && u.departmentName) map.set(u.departmentId, u.departmentName);
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "th"));
  }, [pool]);

  const q = query.trim().toLowerCase();
  const list = pool.filter((u) => (!dept || u.departmentId === dept) && (!q || u.name.toLowerCase().includes(q)));
  const allSelected = list.length > 0 && list.every((u) => selected.has(u.id));

  return (
    <div>
      <div className="sticky top-0 z-10 space-y-2 bg-(--bg) px-4 pb-2 pt-3">
        <label className="flex items-center gap-2 rounded-xl bg-(--bg-soft) px-3 py-2">
          <Search className="h-4 w-4 text-(--ink-soft)" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ"
            className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          />
        </label>
        {departments.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setDept(null)}
              className={cn("shrink-0 rounded-full px-3 py-1 text-[12px]", !dept ? "bg-(--chat-accent) text-white" : "bg-(--bg-soft) text-(--ink-soft)")}
            >
              ทุกแผนก
            </button>
            {departments.map(([id, name]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDept(id)}
                className={cn("shrink-0 rounded-full px-3 py-1 text-[12px]", dept === id ? "bg-(--chat-accent) text-white" : "bg-(--bg-soft) text-(--ink-soft)")}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {onToggleMany && list.length > 1 && (
          <button type="button" onClick={() => onToggleMany(list.map((u) => u.id), !allSelected)} className="text-[12.5px] font-medium text-(--chat-accent-strong)">
            {allSelected ? "ไม่เลือกทั้งหมดในรายการนี้" : `เลือกทั้งหมด (${list.length} คน)`}
          </button>
        )}
      </div>
      <div className="pb-2">
        {list.length === 0 && <p className="px-4 py-8 text-center text-sm text-(--ink-soft)">ไม่พบรายชื่อ</p>}
        {list.map((u) => {
          const on = selected.has(u.id);
          return (
            <button key={u.id} type="button" onClick={() => onToggle(u.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-(--bg-soft)">
              <div className="relative">
                <ChatAvatar name={u.name} src={u.avatarUrl} colorKey={u.id} className="h-10 w-10" />
                {onlineIds[u.id] && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-(--bg) bg-[#22c55e]" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--ink)">{u.name}</p>
                {u.departmentName && <p className="truncate text-[12px] text-(--ink-soft)">{u.departmentName}</p>}
              </div>
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                  on ? "border-(--chat-accent) bg-(--chat-accent) text-white" : "border-(--line)"
                )}
              >
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** เริ่มแชทส่วนตัว หรือสร้างกลุ่มใหม่ */
export function NewChatDialog({
  users,
  meId,
  onlineIds,
  onClose,
  onStartDm,
  onCreateGroup,
}: {
  users: ChatUser[];
  meId: string;
  onlineIds: Record<string, true>;
  onClose: () => void;
  onStartDm: (userId: string) => void;
  onCreateGroup: (name: string, memberIds: string[]) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const others = useMemo(() => users.filter((u) => u.id !== meId), [users, meId]);

  const toggle = (id: string) => {
    if (mode === "dm") {
      onStartDm(id);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ChatModal
      title={mode === "dm" ? "เริ่มแชทใหม่" : "สร้างกลุ่ม"}
      onClose={onClose}
      footer={
        mode === "group" ? (
          <div className="space-y-2">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="ตั้งชื่อกลุ่ม"
              maxLength={100}
              className="w-full rounded-xl border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm focus:border-(--chat-accent) focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !groupName.trim() || selected.size === 0}
              onClick={async () => {
                setBusy(true);
                try {
                  await onCreateGroup(groupName.trim(), [...selected]);
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full rounded-xl bg-(--chat-accent) py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "กำลังสร้าง…" : `สร้างกลุ่ม (${selected.size + 1} คน)`}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="flex gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={() => setMode("dm")}
          className={cn("flex-1 rounded-xl py-2 text-sm", mode === "dm" ? "bg-(--chat-accent-soft) font-semibold text-(--chat-accent-strong)" : "bg-(--bg-soft) text-(--ink-soft)")}
        >
          แชทส่วนตัว
        </button>
        <button
          type="button"
          onClick={() => setMode("group")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm",
            mode === "group" ? "bg-(--chat-accent-soft) font-semibold text-(--chat-accent-strong)" : "bg-(--bg-soft) text-(--ink-soft)"
          )}
        >
          <Users className="h-4 w-4" /> สร้างกลุ่ม
        </button>
      </div>
      <MemberPicker
        users={others}
        selected={mode === "group" ? selected : new Set()}
        onToggle={toggle}
        onToggleMany={
          mode === "group"
            ? (ids, on) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const id of ids) {
                    if (on) next.add(id);
                    else next.delete(id);
                  }
                  return next;
                })
            : undefined
        }
        onlineIds={onlineIds}
      />
    </ChatModal>
  );
}
