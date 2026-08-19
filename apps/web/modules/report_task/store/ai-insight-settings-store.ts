import { create } from "zustand";

// Server-synced (see store-hydrator.tsx's ServerStoreSync, apiKey
// "ai-insight-settings") — just the on/off switch. The AI's own output and
// usage counter live server-only under a different, non-client-writable
// key (see lib/ai-insight/analyze.ts's RESULT_KEY comment).
interface AiInsightSettings {
  enabled: boolean;
}

interface AiInsightSettingsStore {
  settings: AiInsightSettings;
  setEnabled: (enabled: boolean) => void;
}

export const useAiInsightSettingsStore = create<AiInsightSettingsStore>()((set) => ({
  settings: { enabled: true },
  setEnabled: (enabled) => set((s) => ({ settings: { ...s.settings, enabled } })),
}));
