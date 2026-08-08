"use client";

import type { ReactNode } from "react";
import { useTaskStore } from "@/modules/report_task/store/task-store";

/**
 * Renders `fallback` until the file-backed task data has loaded, then the real
 * children. Works from server pages too (children/fallback are passed as props).
 * SSR and first client render both show the fallback, so no hydration mismatch.
 */
export function TaskDataGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const loaded = useTaskStore((s) => s.loaded);
  return <>{loaded ? children : fallback}</>;
}
