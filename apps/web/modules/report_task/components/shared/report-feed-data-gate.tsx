"use client";

import type { ReactNode } from "react";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";

/**
 * Same idea as TaskDataGate, for report-feed's own server-synced `loaded`
 * flag — renders `fallback` until the initial ServerStoreSync GET for
 * "report-feed" has resolved, then the real children.
 */
export function ReportFeedDataGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const loaded = useReportFeedStore((s) => s.loaded);
  return <>{loaded ? children : fallback}</>;
}
