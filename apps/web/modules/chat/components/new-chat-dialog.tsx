"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@smartboss/ui/components/avatar";
import { cn } from "@smartboss/ui/cn";
import type { ChatUser } from "../types";

/**
 * โมดัลเบา ๆ ไม่ได้ดึงไลบรารี dialog มาใช้ (โมดูลนี้ยังไม่มี Dialog ของตัวเอง
 * ต่างจาก report_task ที่มีชุด shadcn เต็ม) — เอา overlay + panel ธรรมดาพอ
 */
export function NewChatDialog({
  users,
  onClose,
  onStartDm,
  onCreateGroup,
}: {
  users: ChatUser[];
  onClose: () => void;
  onStartDm: (userId: string) => void;
  onCreateGroup: (name: string, memberIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"pick" | "group">("pick");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => users.filter((u) => u.name.toLowerCase().includes(query.trim().toLowerCase())),
    [users, query]
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-2xl bg-[var(--bg)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {mode === "pick" ? "เริ่มแชทใหม่" : "ตั้งชื่อกลุ่ม"}
          </h3>
          <button type="button" onClick={onClose} className="text-[var(--ink-soft)] hover:text-[var(--ink)]" aria-label="ปิด">
            ✕
          </button>
        </div>

        {mode === "pick" ? (
          <>
            <div className="border-b border-[var(--line)] p-3">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาเพื่อนร่วมงาน..."
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--brand-green)]"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.map((u) => (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center gap-2.5 px-4 py-2 hover:bg-[var(--bg-soft)]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggleSelected(u.id)}
                    className="h-4 w-4 shrink-0"
                  />
                  <Avatar name={u.name} src={u.avatarUrl} className="h-8 w-8 text-[10px]" />
                  <span className="truncate text-sm text-[var(--ink)]">{u.name}</span>
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-[var(--ink-soft)]">ไม่พบเพื่อนร่วมงาน</p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] p-3">
              <button
                type="button"
                onClick={() => {
                  if (selected.size === 0) return;
                  if (selected.size === 1) onStartDm(Array.from(selected)[0]!);
                  else setMode("group");
                }}
                disabled={selected.size === 0}
                className={cn(
                  "w-full rounded-full bg-[var(--brand-green)] px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-40"
                )}
              >
                {selected.size <= 1 ? "เริ่มแชท" : `ถัดไป (${selected.size} คน)`}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="ชื่อกลุ่ม"
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--brand-green)]"
            />
            <p className="text-xs text-[var(--ink-soft)]">สมาชิก {selected.size} คน</p>
            <button
              type="button"
              onClick={() => groupName.trim() && onCreateGroup(groupName.trim(), Array.from(selected))}
              disabled={!groupName.trim()}
              className="mt-auto w-full rounded-full bg-[var(--brand-green)] px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-40"
            >
              สร้างกลุ่ม
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
