import { create } from "zustand";

// Server-synced (see store-hydrator.tsx's ServerStoreSync, apiKey
// "ai-insight-settings") — the on/off switch + auto-vs-manual mode. The
// AI's own output and usage counter live server-only under a different,
// non-client-writable key (see lib/ai-insight/analyze.ts's RESULT_KEY
// comment). `autoMode` is purely a client-side trigger condition — the
// server doesn't need to know *why* an analysis was requested, only that
// it was, so it stays out of the server state entirely.
export type AiInsightAutoMode = "auto" | "manual";

interface AiInsightSettings {
  enabled: boolean;
  /** "auto" = the card re-analyzes itself once the cached result goes stale
   * (see STALE_MS in ai-insight-card.tsx), whenever someone next has the
   * dashboard open — same "piggyback on client activity" pattern as the
   * deadline-reminder sweep, not a real server cron (see AI-Insight
   * CHANGELOG entry). "manual" = only the "วิเคราะห์ใหม่" button ever
   * triggers a new round. */
  autoMode: AiInsightAutoMode;
}

interface AiInsightSettingsStore {
  settings: AiInsightSettings;
  setEnabled: (enabled: boolean) => void;
  setAutoMode: (autoMode: AiInsightAutoMode) => void;
}

export const useAiInsightSettingsStore = create<AiInsightSettingsStore>()((set) => ({
  settings: { enabled: true, autoMode: "auto" },
  setEnabled: (enabled) => set((s) => ({ settings: { ...s.settings, enabled } })),
  setAutoMode: (autoMode) => set((s) => ({ settings: { ...s.settings, autoMode } })),
}));
