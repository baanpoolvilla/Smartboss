"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/modules/report_task/lib/format";

/**
 * "5 นาทีที่แล้ว" — the same string `relativeTime` has always produced, just
 * rendered in a way that doesn't break hydration.
 *
 * The problem it solves: `relativeTime` reads the clock at render time, and
 * the page is rendered twice — once on the server, then again in the browser
 * when React hydrates it. Those two renders happen seconds (sometimes
 * minutes, if the response sat in a cache) apart, so a post sitting right on
 * a boundary comes out "5 นาทีที่แล้ว" from the server and "6 นาทีที่แล้ว" in
 * the browser. React treats text that doesn't match as a broken render:
 * it throws (minified error #418 — "server rendered text didn't match"),
 * discards the server's HTML and re-renders the whole tree. On the รายงาน
 * feed, where every post row carries one of these, that fires on most page
 * loads.
 *
 * `suppressHydrationWarning` is React's own escape hatch for exactly this
 * case (their docs name timestamps as the example): the mismatch is expected
 * and harmless, so it shouldn't be treated as a bug. It is deliberately
 * scoped to this one <span> and nothing else — a real mismatch anywhere
 * around it still reports normally.
 *
 * The mount effect then forces one re-render, because suppressing the
 * warning also stops React from patching that text: without it the DOM would
 * keep whatever the server wrote until something else happened to re-render
 * the row.
 */
export function TimeAgo({ date, className }: { date: string | Date; className?: string }) {
  const [, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <span className={className} suppressHydrationWarning>
      {relativeTime(date)}
    </span>
  );
}
