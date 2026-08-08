"use client";

import { practiceMissions } from "@/modules/report_task/store/practice-mission-store";
import { cn } from "@/modules/report_task/lib/utils";
import { Check } from "lucide-react";

export function PracticeMissionsPanel({ completed, activeMissionId }: { completed: string[]; activeMissionId: string | null }) {
  const doneCount = completed.length;
  const total = practiceMissions.length;
  const pct = Math.round((doneCount / total) * 100);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-4 space-y-3.5">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span>ภารกิจ {doneCount}/{total}</span>
          <span className="text-[var(--brand-green-dark)] tabular-nums">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--brand-green)] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="space-y-1">
        {practiceMissions.map((m) => {
          const done = completed.includes(m.id);
          const active = m.id === activeMissionId;
          return (
            <li
              key={m.id}
              className={cn(
                "flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
                active && !done && "bg-[var(--accent)]"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  done ? "bg-[var(--brand-green)] border-[var(--brand-green)]" : "border-[var(--line)]"
                )}
              >
                {done && <Check className="h-2.5 w-2.5 text-white" />}
              </span>
              <div className="min-w-0">
                <p className={cn("text-xs font-medium", done && "line-through text-[var(--ink-soft)]")}>{m.title}</p>
                {active && !done && <p className="text-[11px] text-[var(--ink-soft)] mt-0.5">{m.description}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
