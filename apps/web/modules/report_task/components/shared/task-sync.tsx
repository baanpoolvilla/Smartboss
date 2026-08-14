"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task } from "@/modules/report_task/types";

/**
 * File-backed persistence for tasks: load the saved collection from the API on
 * mount (the file is the source of truth), then write the whole working copy
 * back on every change (debounced). Keeps the store fully synchronous — the UI
 * doesn't change — while the persistent home becomes `data/tasks/tasks.json`,
 * ready to swap for the shared DB.
 *
 * Uses fetch with keepalive (not sendBeacon) for every write, including the
 * unload-time flush, so we can always read the response: sendBeacon can only
 * fire-and-forget, which meant tab-close writes both 405'd (no POST handler)
 * and could never report a save failure or a version conflict.
 */
export function TaskSync() {
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot waiting to be written — set the moment a change comes in, only
  // cleared once it's actually sent. A debounce timer that gets cleared
  // (component unmount, Fast Refresh) used to just drop this silently,
  // losing whatever was dragged/edited in the last 500ms; every exit path
  // below now flushes it instead.
  const pendingRef = useRef<Task[] | null>(null);
  // Server's last-known version for this collection (optimistic concurrency).
  const versionRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function reloadFromServer() {
      try {
        const res = await fetch("/api/report-task/tasks");
        const tasks = (await res.json()) as Task[];
        versionRef.current = Number(res.headers.get("X-Data-Version")) || null;
        if (!cancelled && Array.isArray(tasks)) {
          useTaskStore.setState({ tasks });
        }
      } catch {
        // Offline or server down — keep showing what's already in memory.
      }
    }

    async function flush(snapshot: Task[] | null, isUnload = false) {
      if (!snapshot) return;
      pendingRef.current = null;
      const body = JSON.stringify({ tasks: snapshot, expectedVersion: versionRef.current });
      try {
        // `keepalive` only matters for the pagehide flush (surviving the page
        // going away) and Chromium hard-caps keepalive request bodies at
        // ~64KB — past that it fails with a silent "Failed to fetch" instead
        // of an HTTP error. The full task collection routinely exceeds that,
        // so keepalive must stay off for every normal in-page save.
        const res = await fetch("/api/report-task/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
          ...(isUnload ? { keepalive: true } : {}),
        });
        if (res.status === 409) {
          toast.error("มีคนอื่นแก้ไขงานพร้อมกัน กำลังโหลดข้อมูลล่าสุด — การเปลี่ยนแปลงล่าสุดของคุณอาจไม่ถูกบันทึก", { id: "tasksync-conflict" });
          await reloadFromServer();
          return;
        }
        if (!res.ok) {
          // Roll the UI back to what the server actually has instead of
          // leaving it stuck on an edit that never saved — a stray toast is
          // easy to miss, and the store would otherwise silently drift from
          // the persisted copy until the next unrelated reload. A fixed `id`
          // makes a repeated failure (e.g. sweep retrying every minute)
          // replace the existing toast instead of stacking a new one on top.
          toast.error("บันทึกข้อมูลไม่สำเร็จ กำลังโหลดข้อมูลล่าสุดกลับมา", { id: "tasksync-save-error" });
          if (!isUnload) await reloadFromServer();
          return;
        }
        const data = (await res.json().catch(() => null)) as
          | { version?: number; codes?: Record<string, string> }
          | null;
        if (typeof data?.version === "number") versionRef.current = data.version;
        // A newly-created task has no `code` yet in this tab's own state —
        // the server only assigns one once the create actually lands (see
        // task-repo.ts). Merge it in now instead of waiting for the next
        // full reload, so the task number shows up immediately. Skipped
        // (setState left untouched) once every code already matches, so
        // this doesn't loop: applying a real change re-triggers one more
        // flush that then finds nothing left to merge.
        if (data?.codes) {
          const codes = data.codes;
          const current = useTaskStore.getState().tasks;
          let changed = false;
          const next = current.map((t) => {
            const code = codes[t.id];
            if (code && t.code !== code) {
              changed = true;
              return { ...t, code };
            }
            return t;
          });
          if (changed) useTaskStore.setState({ tasks: next });
        }
      } catch {
        toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ การเปลี่ยนแปลงอาจหายไปเมื่อรีเฟรช", { id: "tasksync-network-error" });
        if (!isUnload) await reloadFromServer();
      }
    }

    function flushPending() {
      void flush(pendingRef.current);
    }

    // Triggers the server-side sweep (/api/tasks/sweep) and, only if it
    // actually changed something, reloads so this tab picks up the applied
    // flags/docks. The sweep computes and writes at most once regardless of
    // how many tabs/clients trigger it around the same time (see H3 in the
    // production-readiness audit) — this is just a trigger, not the logic.
    async function runSweep() {
      try {
        const res = await fetch("/api/report-task/tasks/sweep", { method: "POST" });
        const data = (await res.json().catch(() => null)) as { changed?: boolean } | null;
        if (data?.changed) await reloadFromServer();
      } catch {
        // Offline or server down — next tick tries again.
      }
    }

    // Same trigger-only shape as runSweep, for the separate "ใกล้ถึงกำหนด"
    // reminder sweep (tasks/meetings/report cutoffs) — see
    // /api/report-task/reminders/sweep. Doesn't touch the task store, so no
    // reload needed either way.
    async function runReminderSweep() {
      try {
        await fetch("/api/report-task/reminders/sweep", { method: "POST" });
      } catch {
        // Offline or server down — next tick tries again.
      }
    }

    fetch("/api/report-task/tasks")
      .then(async (r) => {
        versionRef.current = Number(r.headers.get("X-Data-Version")) || null;
        return r.json();
      })
      .then((tasks: Task[]) => {
        if (!cancelled && Array.isArray(tasks)) {
          useTaskStore.setState({ tasks });
        }
      })
      .catch(() => {
        toast.error("โหลดข้อมูลงานไม่สำเร็จ ลองรีเฟรชหน้า");
      })
      .finally(() => {
        loadedRef.current = true;
        if (!cancelled) {
          useTaskStore.setState({ loaded: true });
          void runSweep();
          void runReminderSweep();
        }
      });

    // Re-trigger periodically so a strict task gets docked (and any task gets
    // flagged as once-overdue) the moment its due date passes, even if
    // nobody touches the app in the meantime.
    const sweepTimer = setInterval(() => {
      if (loadedRef.current) {
        void runSweep();
        void runReminderSweep();
      }
    }, 60_000);

    // Write-through: save after changes settle. Skips writes until the initial
    // load has completed so we never overwrite the file with seed data.
    const unsub = useTaskStore.subscribe((state, prev) => {
      if (!loadedRef.current || state.tasks === prev.tasks) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = state.tasks;
      timerRef.current = setTimeout(flushPending, 500);
    });

    // Tab close / hard refresh — the component won't get a chance to unmount
    // cleanly, so catch it here too. `keepalive: true` lets this specific
    // request survive the page actually going away.
    function flushOnUnload() {
      void flush(pendingRef.current, true);
    }
    window.addEventListener("pagehide", flushOnUnload);

    return () => {
      cancelled = true;
      unsub();
      clearInterval(sweepTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("pagehide", flushOnUnload);
      flushPending();
    };
  }, []);

  return null;
}
