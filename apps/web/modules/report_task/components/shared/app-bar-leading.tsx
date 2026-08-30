"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Lets one specific page (currently only report-feed's mobile room switcher)
 * render its own control into the shared AppBar's left slot instead of its
 * own row inside the page body — asked for explicitly ("อยากให้สามขีดไปซ้าย
 * บน...แค่นั้นเองเฉพาะหน้านี้"). Scoped to this one page on purpose: every
 * other page under this module has nothing to put here, so ReportTaskScaffold
 * just passes `null` through to AppScaffold's `leading` prop by default.
 */
const AppBarLeadingContext = createContext<{
  node: ReactNode;
  setNode: (n: ReactNode) => void;
} | null>(null);

export function AppBarLeadingProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return <AppBarLeadingContext.Provider value={{ node, setNode }}>{children}</AppBarLeadingContext.Provider>;
}

export function useAppBarLeading(): ReactNode {
  return useContext(AppBarLeadingContext)?.node ?? null;
}

/** Registers `node` as the AppBar's left-slot control for as long as the
 * calling page is mounted — clears itself on unmount so navigating to a page
 * without one doesn't leave a stale button behind. `node` should be a stable
 * (memoized) element: this re-registers every time the reference changes. */
export function useSetAppBarLeading(node: ReactNode) {
  const ctx = useContext(AppBarLeadingContext);
  useEffect(() => {
    ctx?.setNode(node);
    return () => ctx?.setNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, node]);
}
