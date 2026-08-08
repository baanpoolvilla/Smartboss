"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Keeps the currently-open Task Detail Sheet's id mirrored in the `?task=`
 * URL param — `openTaskId` is derived straight from the param (no local
 * state to keep in sync), so a browser Back that changes the URL is picked
 * up for free on the next render, no effect-driven setState needed.
 *
 * `open()` pushes a new history entry, so the browser Back button pops it —
 * closing the sheet first instead of leaving the whole page — and reloading
 * the page (or sharing the link) reopens the same task. `close()` uses
 * `replace` instead of `back()`: it only needs to strip the param from the
 * current entry, not consume a Back step, so pressing X/Escape never causes
 * an extra Back press to do nothing.
 */
export function useTaskSheetParam(initialFallback?: string | null) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramTaskId = searchParams.get("task");

  const open = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("task", id);
      else params.delete("task");
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, router, searchParams]);

  // One-shot: fold a navigation-intent-sourced initial task (e.g. clicking a
  // dashboard widget that jumps here with "open this task") into the URL too,
  // so Back still closes it — but only when the URL doesn't already carry its
  // own `?task=` (a shared link or a same-page refresh takes priority).
  useEffect(() => {
    if (initialFallback && !paramTaskId) open(initialFallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { openTaskId: paramTaskId, open, close };
}
