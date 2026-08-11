import { create } from "zustand";
import type { IssueDeskConfig } from "@/modules/report_task/types/issue";
import { ALL_ISSUE_CATEGORIES } from "@/modules/report_task/types/issue";

// Separate store (and separate server-sync key, "issue-desk-config") from
// the tickets themselves (issue-report-store.ts) — config is small and
// changes rarely, tickets grow without bound, and every ticket mutation
// would otherwise re-save this too. See ISSUE_REPORT_SYSTEM_SPEC.md §3.4.
const DEFAULT_CONFIG: IssueDeskConfig = {
  // Defaults to Engineering, the closest existing stand-in for "ฝ่ายดูแล
  // ระบบ/IT" until a dedicated department is created.
  recipientDepartmentIds: ["dep-eng"],
  extraAgentUserIds: [],
  enabledCategories: ALL_ISSUE_CATEGORIES,
  knownIssuesBanner: null,
};

interface IssueDeskConfigStore {
  config: IssueDeskConfig;
  setConfig: (patch: Partial<IssueDeskConfig>) => void;
}

export const useIssueDeskConfigStore = create<IssueDeskConfigStore>()((set) => ({
  config: DEFAULT_CONFIG,
  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
}));
