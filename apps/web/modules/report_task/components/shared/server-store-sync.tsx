"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { StoreApi, UseBoundStore } from "zustand";
import type { StoreKey } from "@/modules/report_task/lib/db/store-registry";

type AnyStore<T> = UseBoundStore<StoreApi<T>>;

/**
 * Generic server-backed replacement for zustand's `persist` + localStorage,
 * for state that's shared across teammates (not per-user view prefs — those
 * stay in localStorage). Loads `select(state)` from `/api/report-task/store/{apiKey}` on
 * mount, then debounce-writes it back after every change.
 *
 * Same write-through + optimistic-concurrency + toast-on-conflict shape as
 * `TaskSync` — mount one of these per shared store (see `store-hydrator.tsx`)
 * instead of duplicating that plumbing in every store file.
 */
export function ServerStoreSync<T, S>({
  apiKey,
  store,
  select,
  apply,
}: {
  apiKey: StoreKey;
  store: AnyStore<T>;
  select: (state: T) => S;
  apply: (state: T, slice: S) => T;
}) {
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<S | null>(null);
  const versionRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/report-task/store/${apiKey}`);
        versionRef.current = Number(res.headers.get("X-Data-Version")) || null;
        const slice = (await res.json()) as S | null;
        // A brand-new store has nothing saved server-side yet (slice is
        // null) — still run `apply` (with the store's own current slice as a
        // no-op merge) so callers that bake bookkeeping like `loaded: true`
        // into `apply` see it regardless of whether the server had data.
        if (!cancelled) {
          store.setState((s) => apply(s, slice != null ? slice : select(s)));
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
      const body = JSON.stringify({ data: snapshot, expectedVersion: versionRef.current });
      try {
        // `keepalive` only matters for the pagehide flush (surviving the page
        // going away) and Chromium hard-caps keepalive request bodies at
        // ~64KB, past which the fetch fails silently instead of returning an
        // HTTP error — so it must stay off for every normal in-page save.
        const res = await fetch(`/api/report-task/store/${apiKey}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
          ...(isUnload ? { keepalive: true } : {}),
        });
        if (res.status === 409) {
          toast.error("มีคนอื่นแก้ไขข้อมูลพร้อมกัน กำลังโหลดข้อมูลล่าสุด", { id: `storesync-conflict-${apiKey}` });
          await load();
          return;
        }
        if (!res.ok) {
          // Roll the UI back to what the server actually has instead of
          // leaving it stuck on an edit that never saved — a stray toast is
          // easy to miss, and the store would otherwise silently drift from
          // the persisted copy until the next unrelated reload. `id` is
          // namespaced per store so a repeated failure replaces its own
          // toast instead of stacking, while different stores failing at
          // the same time still each get their own visible toast.
          toast.error("บันทึกข้อมูลไม่สำเร็จ กำลังโหลดข้อมูลล่าสุดกลับมา", { id: `storesync-save-error-${apiKey}` });
          if (!isUnload) await load();
          return;
        }
        const data = (await res.json().catch(() => null)) as { version?: number } | null;
        if (typeof data?.version === "number") versionRef.current = data.version;
      } catch {
        toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ การเปลี่ยนแปลงอาจหายไปเมื่อรีเฟรช", { id: `storesync-network-error-${apiKey}` });
        if (!isUnload) await load();
      }
    }

    function flushPending() {
      void flush(pendingRef.current);
    }

    void load();

    const unsub = store.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      const next = select(state);
      // `select` typically returns a fresh object/array literal on every
      // call (e.g. `{ topics: s.topics, posts: s.posts }`), so comparing it
      // to `select(prev)` by reference is *always* unequal even when the
      // selected fields didn't actually change — that defeated this guard
      // entirely, scheduling (and eventually flushing) a write on every
      // unrelated store update. Compare the serialized contents instead so
      // a no-op change is actually skipped.
      if (JSON.stringify(next) === JSON.stringify(select(prev))) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = next;
      timerRef.current = setTimeout(flushPending, 500);
    });

    function flushOnUnload() {
      void flush(pendingRef.current, true);
    }
    window.addEventListener("pagehide", flushOnUnload);

    return () => {
      cancelled = true;
      unsub();
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
