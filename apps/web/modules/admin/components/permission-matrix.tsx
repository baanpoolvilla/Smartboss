"use client";

import { useMemo, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import type { PermissionGroup } from "@/modules/admin/data/roles";

/**
 * ตารางเลือกสิทธิ์ของบทบาท — จัดกลุ่มตามโมดูล มีปุ่มเลือกทั้งกลุ่ม
 * ส่งค่าเป็น <input name="permissionIds"> หลายตัวให้ server action
 */
export function PermissionMatrix({
  groups,
  labels,
  defaultSelected,
  readOnly = false,
}: {
  groups: PermissionGroup[];
  /** code → คำอธิบายไทย (ไม่มีก็แสดง code ดิบ) */
  labels: Record<string, string>;
  defaultSelected: string[];
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSelected)
  );

  const total = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups]
  );

  function toggle(id: string) {
    if (readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(group: PermissionGroup, on: boolean) {
    if (readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of group.items) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-(--ink-soft)">
        เลือกแล้ว{" "}
        <span className="font-bold text-(--ink)">{selected.size}</span> จาก{" "}
        {total} สิทธิ์
      </p>

      {groups.map((group) => {
        const all = group.items.every((i) => selected.has(i.id));
        const some = !all && group.items.some((i) => selected.has(i.id));
        return (
          <div
            key={group.key}
            className="overflow-hidden rounded-(--radius) border border-(--line)"
          >
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ backgroundColor: `${group.color}12` }}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
                aria-hidden
              />
              <span
                className="flex-1 text-sm font-bold"
                style={{ color: group.color }}
              >
                {group.name}
              </span>
              <span className="text-[11px] text-(--ink-soft)">
                {group.items.filter((i) => selected.has(i.id)).length}/
                {group.items.length}
              </span>
              {!readOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => toggleGroup(group, !all)}
                >
                  {all ? "ล้างทั้งกลุ่ม" : some ? "เลือกที่เหลือ" : "เลือกทั้งกลุ่ม"}
                </Button>
              )}
            </div>

            <div className="divide-y divide-(--line)">
              {group.items.map((item) => {
                const on = selected.has(item.id);
                return (
                  <label
                    key={item.id}
                    className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 ${
                      readOnly ? "cursor-default" : "hover:bg-(--bg-soft)"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={readOnly}
                      onChange={() => toggle(item.id)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-(--ink)">
                        {labels[item.code] ?? item.code}
                      </span>
                      <span className="block font-mono text-[11px] text-(--ink-soft)">
                        {item.code}
                      </span>
                    </span>
                    {on && (
                      <input type="hidden" name="permissionIds" value={item.id} />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
