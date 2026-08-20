import { useCallback, useEffect, useRef, useState } from "react";
import { useAiInsightSettingsStore } from "@/modules/report_task/store/ai-insight-settings-store";
import type { StatusResponse } from "@/modules/report_task/components/dashboard/ai-insight-shared";

/** How old the cached result needs to be before "ออโต้" mode refreshes it on
 * someone's next visit — there's no real server cron behind this (see
 * ai-insight-settings-store.ts), so "roughly once a day" is approximated as
 * "stale past 20h" checked whenever anyone has the dashboard open, same
 * piggyback pattern as the deadline-reminder sweep. */
const STALE_MS = 20 * 60 * 60 * 1000;

/** Shared fetch/analyze state for AI Insight, used by both the collapsed
 * dashboard card and the full detail page so they read the same live data
 * instead of drifting out of sync. */
export function useAiInsight() {
  const enabled = useAiInsightSettingsStore((s) => s.settings.enabled);
  const setEnabled = useAiInsightSettingsStore((s) => s.setEnabled);
  const autoMode = useAiInsightSettingsStore((s) => s.settings.autoMode);
  const setAutoMode = useAiInsightSettingsStore((s) => s.setAutoMode);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTriedRef = useRef(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/report-task/ai-insight");
    if (!res.ok) return;
    const data = (await res.json()) as StatusResponse;
    setStatus(data);
    return data;
  }, []);

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/report-task/ai-insight", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "วิเคราะห์ไม่สำเร็จ");
        await loadStatus();
        return;
      }
      setStatus(data as StatusResponse);
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    } finally {
      setAnalyzing(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    // Fetch-on-mount, not "derive state from props" — the pattern the
    // set-state-in-effect rule is meant to catch. Nothing to derive here
    // synchronously; the status genuinely only exists server-side.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
  }, [loadStatus]);

  // "ออโต้" mode: refresh once per visit if there's no result yet, or the
  // cached one is past STALE_MS — "manual" mode never auto-triggers, only
  // the "วิเคราะห์ใหม่" button does (still bounded by quota either way).
  // Runs at most once per mount (autoTriedRef), not on a timer — see
  // STALE_MS's own comment on why this approximates "daily" rather than
  // guaranteeing it.
  useEffect(() => {
    if (autoTriedRef.current || !status) return;
    if (!status.unlocked || !status.enabled || autoMode !== "auto" || status.quotaRemaining <= 0) return;
    const stale = !status.state.generatedAt || Date.now() - new Date(status.state.generatedAt).getTime() > STALE_MS;
    if (stale) {
      autoTriedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void runAnalysis();
    }
  }, [status, autoMode, runAnalysis]);

  return { enabled, setEnabled, autoMode, setAutoMode, status, analyzing, error, runAnalysis };
}
