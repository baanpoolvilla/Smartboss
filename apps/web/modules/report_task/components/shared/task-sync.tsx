"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task } from "@/modules/report_task/types";
import { mergeThreeWay } from "./store-merge";

// Task collides often (everyone works the same board at once), so it polls
// tighter than ServerStoreSync's default 4s — matches report-feed's own
// tuning for a store people actually fight over.
const TASK_POLL_MS = 5000;

// Rollback switches (R10) — this rewrite touches Task's core save path in
// production use, so both new behaviors can be killed independently without
// reverting the whole change: flipping ENABLE_TASK_MERGE back to false
// restores the old "409 → toast → reload-over-your-edit" behavior, and
// ENABLE_TASK_POLL back to false stops the live poll (a conflicting save
// still merges correctly via the 409 path either way — this only controls
// whether *other people's* saves show up without you touching anything).
const ENABLE_TASK_MERGE = true;
const ENABLE_TASK_POLL = true;

/**
 * File/DB-backed persistence for tasks, on the same collaboration model as
 * `ServerStoreSync` (see that file's own doc comment): a light poll pulls in
 * teammates' saves so everyone converges without refreshing, and a 409 from
 * a race gets 3-way merged (per task id) and retried instead of popping a
 * warning and reloading over whatever the user was just editing.
 *
 * `TaskSync` used to be the one store on this whole "read the whole blob /
 * write the whole blob" model that didn't follow that shape — a conflict
 * reloaded and silently discarded the losing edit, and there was no poll at
 * all, so a teammate's change was invisible until a hard refresh. This is
 * that gap closed, kept as its own component (rather than folded into
 * `ServerStoreSync`) because Task's route also runs a server-side "sweep"
 * (overdue docking) and a separate reminder sweep that store has no
 * equivalent of.
 *
 * Uses fetch with keepalive (not sendBeacon) for the unload-time flush so we
 * can still read the response — sendBeacon can only fire-and-forget.
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
  // The task list as the server last confirmed it — the common ancestor for
  // the 3-way merge on conflict (and for reconciling a poll). Kept in sync
  // on every load, reload, successful save, and poll.
  const baseRef = useRef<Task[] | null>(null);
  // True while we're writing server-originated tasks into the store (load,
  // reload, merge, poll). The subscribe listener below checks this so
  // pulling in a teammate's save doesn't get mistaken for a local edit and
  // echoed straight back — which would otherwise bounce identical no-op
  // PUTs between tabs on every poll.
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    function applyRemoteTasks(tasks: Task[]) {
      applyingRemoteRef.current = true;
      try {
        useTaskStore.setState({ tasks });
      } finally {
        applyingRemoteRef.current = false;
      }
    }

    async function reloadFromServer() {
      try {
        const res = await fetch("/api/report-task/tasks");
        const tasks = (await res.json()) as Task[];
        versionRef.current = Number(res.headers.get("X-Data-Version")) || null;
        if (!cancelled && Array.isArray(tasks)) {
          applyRemoteTasks(tasks);
          baseRef.current = tasks;
        }
      } catch {
        // Offline or server down — keep showing what's already in memory.
      }
    }

    async function flush(snapshot: Task[] | null, isUnload = false) {
      if (!snapshot) return;
      pendingRef.current = null;

      // On page unload we get a single keepalive shot and can't do the
      // fetch/merge/retry dance — send optimistically and let a surviving
      // tab (or the next load) reconcile. The server keeps a POST alias
      // specifically for this (see route.ts's own comment) — some browsers'
      // fetch(keepalive) only reliably delivers non-PUT bodies past a
      // certain size on unload. `keepalive` request bodies are also
      // hard-capped at ~64KB by Chromium, so this path stays off for every
      // normal in-page save.
      if (isUnload) {
        try {
          await fetch("/api/report-task/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: snapshot, expectedVersion: versionRef.current }),
            keepalive: true,
          });
        } catch {
          /* best effort on the way out */
        }
        return;
      }

      let mine = snapshot;
      // Bounded retry: in the split second between our merge and our retry
      // someone else could save again. A few passes converge; the cap keeps
      // a very hot board from spinning.
      for (let attempt = 0; attempt < 4; attempt++) {
        let res: Response;
        try {
          res = await fetch("/api/report-task/tasks", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: mine, expectedVersion: versionRef.current }),
          });
        } catch {
          toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ การเปลี่ยนแปลงอาจหายไปเมื่อรีเฟรช", { id: "tasksync-network-error" });
          await reloadFromServer();
          return;
        }

        // Someone saved first. Pull their latest, merge our changes on top
        // per task id, reflect the merge in the UI, and retry — no popup,
        // nothing lost (unless the same task was deleted on one side while
        // edited on the other — see mergeThreeWay's own doc comment).
        if (res.status === 409 && !ENABLE_TASK_MERGE) {
          toast.error("มีคนอื่นแก้ไขงานพร้อมกัน กำลังโหลดข้อมูลล่าสุด — การเปลี่ยนแปลงล่าสุดของคุณอาจไม่ถูกบันทึก", { id: "tasksync-conflict" });
          await reloadFromServer();
          return;
        }
        if (res.status === 409) {
          let latest: Task[];
          let latestVersion: number | null;
          try {
            const latestRes = await fetch("/api/report-task/tasks");
            latest = (await latestRes.json()) as Task[];
            latestVersion = Number(latestRes.headers.get("X-Data-Version")) || null;
          } catch {
            await reloadFromServer();
            return;
          }
          const merged = mergeThreeWay(baseRef.current, mine, latest) as Task[];
          if (!cancelled) applyRemoteTasks(merged);
          versionRef.current = latestVersion;
          baseRef.current = latest; // what the server had when we merged
          mine = merged;
          continue; // retry PUT with merged data + the latest version
        }

        if (!res.ok) {
          // Roll the UI back to what the server actually has instead of
          // leaving it stuck on an edit that never saved — a stray toast is
          // easy to miss, and the store would otherwise silently drift from
          // the persisted copy until the next unrelated reload. A fixed `id`
          // makes a repeated failure (e.g. sweep retrying every minute)
          // replace the existing toast instead of stacking a new one on top.
          toast.error("บันทึกข้อมูลไม่สำเร็จ กำลังโหลดข้อมูลล่าสุดกลับมา", { id: "tasksync-save-error" });
          await reloadFromServer();
          return;
        }

        // Success: bump version + base, and merge in the `code` the server
        // just assigned any newly-created task in this batch — this tab's
        // own state has no code for it yet (see task-repo.ts), so wait for
        // the next full reload would leave the task number blank a beat
        // longer than it needs to.
        const data = (await res.json().catch(() => null)) as { version?: number; codes?: Record<string, string> } | null;
        if (typeof data?.version === "number") versionRef.current = data.version;
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
          if (changed) {
            applyRemoteTasks(next);
            mine = next;
          }
        }
        baseRef.current = mine; // this snapshot is now the server truth
        return;
      }

      // Merge kept losing the race every pass — vanishingly unlikely. Fall
      // back to a reload so the UI at least matches the server.
      await reloadFromServer();
    }

    function flushPending() {
      void flush(pendingRef.current);
    }

    // Triggers the server-side sweep (/api/report-task/tasks/sweep) and,
    // only if it actually changed something, reloads so this tab picks up
    // the applied flags/docks. The sweep computes and writes at most once
    // regardless of how many tabs/clients trigger it around the same time —
    // this is just a trigger, not the logic.
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
          applyRemoteTasks(tasks);
          baseRef.current = tasks;
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
    //
    // Skipped while the tab is hidden. The sweep is a whole-org job, so N open
    // tabs were each waking the server every 60s to redo work that is
    // identical no matter who triggers it — on a 2-core box shared with the
    // workforce API that background chatter is not free, and a backgrounded
    // tab has nobody looking at the result anyway. A tab that comes back to
    // the foreground sweeps immediately (visibilitychange below), so nothing
    // is deferred longer than it takes someone to actually look.
    const sweepTimer = setInterval(() => {
      if (loadedRef.current && document.visibilityState === "visible") {
        void runSweep();
        void runReminderSweep();
      }
    }, 60_000);

    // A backgrounded tab skips the 60s sweepTimer above, but coming back to
    // the foreground shouldn't have to wait up to a minute to catch up — fire
    // once immediately on return instead.
    //
    // Also the real "about to be backgrounded" signal on iOS Safari (issue
    // E): switching apps there doesn't reliably fire `pagehide` or `unload`
    // before the page gets suspended — the app can be frozen or the tab's
    // process reclaimed with zero further JS execution, dropping whatever
    // was still sitting in `pendingRef` waiting on its 0ms debounce timer.
    // `visibilitychange` to "hidden", by contrast, is the one lifecycle
    // event iOS guarantees fires first — https://web.dev/articles/page-lifecycle-api
    // — so flush there too, using the same keepalive/no-retry path `pagehide`
    // already uses, rather than relying on `pagehide` alone.
    function onVisibilityChange() {
      if (!loadedRef.current) return;
      if (document.visibilityState === "visible") {
        void runSweep();
        void runReminderSweep();
        return;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pendingRef.current) void flush(pendingRef.current, true);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Pull in teammates' saves on a light poll so several people viewing the
    // same board converge on their own, instead of only finding out on the
    // next reload/save. Skip while the user has an unsaved edit in flight
    // (don't yank their work mid-type) or the tab is hidden.
    const pollTimer = ENABLE_TASK_POLL
      ? setInterval(() => {
          if (!loadedRef.current) return;
          if (pendingRef.current || timerRef.current) return; // edit in flight — don't overwrite it
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          void (async () => {
            try {
              // R1 — check the lightweight version-only endpoint first
              // (a few dozen bytes, no task rows touched) before paying for
              // a full GET of the company's whole task collection. Most
              // ticks find nothing changed, so this is the common case.
              const versionRes = await fetch("/api/report-task/tasks/version");
              const version = Number(versionRes.headers.get("X-Data-Version")) || null;
              if (version === versionRef.current) return; // nothing new
              if (pendingRef.current || timerRef.current) return; // user started editing while we were checking
              const res = await fetch("/api/report-task/tasks");
              const tasks = (await res.json()) as Task[];
              if (cancelled || !Array.isArray(tasks)) return;
              versionRef.current = Number(res.headers.get("X-Data-Version")) || version;
              applyRemoteTasks(tasks);
              baseRef.current = tasks;
            } catch {
              // transient — next tick tries again
            }
          })();
        }, TASK_POLL_MS)
      : null;

    // Write-through: save after changes settle. Skips writes until the
    // initial load has completed so we never overwrite the server with
    // seed/empty state. Fires on the next tick (0ms), not a longer debounce
    // — every mutation left is a single discrete click (status dropdown,
    // ผ่าน/ไม่ผ่าน, checklist toggle, reaction, ...), so there's no real
    // burst to coalesce, only React's own state-update
    // batching within one click handler, which a 0ms setTimeout still
    // collapses into a single write. Skips writes until the initial load
    // has completed so we never overwrite the server with seed/empty state,
    // and skips remote-originated updates (`applyingRemoteRef`) so a poll or
    // merge never gets mistaken for a user edit and echoed straight back.
    const unsub = useTaskStore.subscribe((state, prev) => {
      if (!loadedRef.current || state.tasks === prev.tasks) return;
      if (applyingRemoteRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = state.tasks;
      timerRef.current = setTimeout(flushPending, 0);
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
      if (pollTimer) clearInterval(pollTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushOnUnload);
      flushPending();
    };
  }, []);

  return null;
}
