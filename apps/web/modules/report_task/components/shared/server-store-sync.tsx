"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { StoreApi, UseBoundStore } from "zustand";
import type { StoreKey } from "@/modules/report_task/lib/db/store-registry";
import { mergeThreeWay } from "./store-merge";

type AnyStore<T> = UseBoundStore<StoreApi<T>>;

/** Default for `pollMs` when a caller doesn't pass one — matches the old
 * always-4s behavior for anything not yet tuned. */
const DEFAULT_POLL_MS = 4000;

/**
 * Generic server-backed replacement for zustand's `persist` + localStorage,
 * for state that's shared across teammates (not per-user view prefs — those
 * stay in localStorage). Loads `select(state)` from `/api/report-task/store/{apiKey}` on
 * mount, then debounce-writes it back after every change.
 *
 * Collaboration model (so several people can edit the same board at once):
 *   - a light poll pulls in other people's saves while you're just viewing, so
 *     everyone converges on the same state without anyone having to refresh;
 *   - if two saves race and the server returns 409, we DON'T pop a warning or
 *     drop the edit — we fetch their latest, 3-way merge our own changes on top
 *     (per item id, so different posts/topics never clobber each other), and
 *     retry. Everybody's edits survive and there's no interruption.
 */
export function ServerStoreSync<T, S>({
  apiKey,
  store,
  select,
  apply,
  /** How often (ms) each open tab checks whether a teammate saved, so other
   * people's edits show up on their own rather than only when you try to
   * save. Every mounted ServerStoreSync polls independently — with 20+ of
   * these live per session (see store-hydrator.tsx), the default is too
   * aggressive for a store nobody edits concurrently in practice (company
   * config, departments, ...); pass a longer interval for those, and keep
   * this short only where people actually collide (report-feed,
   * notifications). Pass `false` to skip polling entirely — a conflicting
   * save still merges correctly via the 409 path, this only controls
   * whether *other people's* saves show up without you touching anything.
   */
  pollMs = DEFAULT_POLL_MS,
}: {
  apiKey: StoreKey;
  store: AnyStore<T>;
  select: (state: T) => S;
  apply: (state: T, slice: S) => T;
  pollMs?: number | false;
}) {
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<S | null>(null);
  const versionRef = useRef<number | null>(null);
  // The slice as the server last confirmed it — the common ancestor for the
  // 3-way merge on conflict. Kept in sync on every load and every successful save.
  const baseRef = useRef<S | null>(null);
  // True while we're writing server-originated data into the store (load, poll,
  // merge). The subscribe listener checks this so pulling in a teammate's save
  // doesn't get mistaken for a local edit and echoed straight back — which
  // would otherwise bounce identical no-op writes between tabs every poll.
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    function applyRemoteState(mutator: (s: T) => T) {
      applyingRemoteRef.current = true;
      try {
        store.setState(mutator);
      } finally {
        applyingRemoteRef.current = false;
      }
    }

    // GET the current server slice + version. `slice` is null for a store the
    // company has never saved yet.
    async function fetchServer(): Promise<{ slice: S | null; version: number | null }> {
      const res = await fetch(`/api/report-task/store/${apiKey}`, { cache: "no-store" });
      const version = Number(res.headers.get("X-Data-Version")) || null;
      const slice = (await res.json()) as S | null;
      return { slice, version };
    }

    async function load() {
      try {
        const { slice, version } = await fetchServer();
        versionRef.current = version;
        // A brand-new store has nothing saved server-side yet (slice is null) —
        // still run `apply` (with the store's own current slice as a no-op
        // merge) so callers that bake bookkeeping like `loaded: true` into
        // `apply` see it regardless of whether the server had data.
        if (!cancelled) {
          applyRemoteState((s) => apply(s, slice != null ? slice : select(s)));
          baseRef.current = select(store.getState()); // in sync with the server now
        }
      } catch {
        toast.error(`โหลดข้อมูลไม่สำเร็จ (${apiKey}) ลองรีเฟรชหน้า`);
      } finally {
        loadedRef.current = true;
      }
    }

    async function flush(snapshot: S | null, isUnload = false) {
      if (!snapshot) return;
      pendingRef.current = null;

      // On page unload we get a single keepalive shot and can't do the
      // fetch/merge/retry dance — send optimistically and let a surviving tab
      // (or the next load) reconcile. `keepalive` bodies are hard-capped at
      // ~64KB by Chromium, so this stays off for every normal in-page save.
      if (isUnload) {
        try {
          await fetch(`/api/report-task/store/${apiKey}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: snapshot, expectedVersion: versionRef.current }),
            keepalive: true,
          });
        } catch {
          /* best effort on the way out */
        }
        return;
      }

      let mine = snapshot;
      // Bounded retry: in the split second between our merge and our retry
      // someone else could save again. A few passes converge; the cap keeps a
      // very hot board from spinning.
      for (let attempt = 0; attempt < 4; attempt++) {
        let res: Response;
        try {
          res = await fetch(`/api/report-task/store/${apiKey}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: mine, expectedVersion: versionRef.current }),
          });
        } catch {
          toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ การเปลี่ยนแปลงอาจหายไปเมื่อรีเฟรช", { id: `storesync-network-error-${apiKey}` });
          await load();
          return;
        }

        if (res.status === 409) {
          // Someone saved first. Pull their latest, merge our changes on top,
          // reflect the merge in the UI, and retry — no popup, nothing lost.
          let latest: { slice: S | null; version: number | null };
          try {
            latest = await fetchServer();
          } catch {
            await load();
            return;
          }
          const merged = mergeThreeWay(baseRef.current, mine, latest.slice) as NonNullable<S>;
          if (!cancelled) applyRemoteState((s) => apply(s, merged));
          versionRef.current = latest.version;
          baseRef.current = latest.slice; // what the server had when we merged
          mine = merged;
          continue; // retry PUT with merged data + the latest version
        }

        if (!res.ok) {
          // A real failure (not a concurrency race) — roll the UI back to what
          // the server actually has instead of leaving it stuck on an edit that
          // never saved. `id` is namespaced per store so a repeat replaces its
          // own toast instead of stacking.
          toast.error("บันทึกข้อมูลไม่สำเร็จ กำลังโหลดข้อมูลล่าสุดกลับมา", { id: `storesync-save-error-${apiKey}` });
          await load();
          return;
        }

        const data = (await res.json().catch(() => null)) as { version?: number } | null;
        if (typeof data?.version === "number") versionRef.current = data.version;
        baseRef.current = mine; // this snapshot is now the server truth
        return;
      }

      // Merge kept losing the race every pass — vanishingly unlikely. Fall back
      // to a silent reload so the UI at least matches the server.
      await load();
    }

    function flushPending() {
      void flush(pendingRef.current);
    }

    void load();

    const unsub = store.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (applyingRemoteRef.current) return; // server-originated, not a user edit
      const next = select(state);
      // `select` typically returns a fresh object/array literal on every call,
      // so a reference compare to `select(prev)` is always unequal even when
      // nothing changed. Compare serialized contents so a no-op is skipped.
      if (JSON.stringify(next) === JSON.stringify(select(prev))) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = next;
      timerRef.current = setTimeout(flushPending, 500);
    });

    // Pull in teammates' saves on a light poll so several people viewing the
    // same board converge on their own. Skip while the user has an unsaved edit
    // in flight (don't yank their work) or the tab is hidden. `pollMs: false`
    // opts a store out entirely — a conflicting save still merges correctly
    // via the 409 path in flush() either way, this only affects whether
    // someone else's save (with no conflict of your own) shows up live.
    const poll =
      pollMs === false
        ? null
        : setInterval(() => {
            if (!loadedRef.current) return;
            if (pendingRef.current || timerRef.current) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            void (async () => {
              try {
                const res = await fetch(`/api/report-task/store/${apiKey}`, { cache: "no-store" });
                const version = Number(res.headers.get("X-Data-Version")) || null;
                if (version === versionRef.current) return; // nothing new
                if (pendingRef.current || timerRef.current) return; // user started editing meanwhile
                const slice = (await res.json()) as S | null;
                if (cancelled) return;
                versionRef.current = version;
                if (slice != null) {
                  applyRemoteState((s) => apply(s, slice));
                  baseRef.current = select(store.getState());
                }
              } catch {
                /* transient — next tick will retry */
              }
            })();
          }, pollMs);

    function flushOnUnload() {
      void flush(pendingRef.current, true);
    }
    window.addEventListener("pagehide", flushOnUnload);

    return () => {
      cancelled = true;
      unsub();
      if (poll) clearInterval(poll);
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("pagehide", flushOnUnload);
      flushPending();
    };
    // apiKey/store/select/apply are expected to be stable identities from the
    // caller (module-scope store hooks, inline selectors defined per mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, store]);

  return null;
}
