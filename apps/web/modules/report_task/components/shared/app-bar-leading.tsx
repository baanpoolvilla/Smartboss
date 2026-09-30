"use client";

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

/**
 * Lets one specific page (currently only report-feed's mobile room switcher)
 * render its own control into the shared AppBar's left slot instead of its
 * own row inside the page body — asked for explicitly ("อยากให้สามขีดไปซ้าย
 * บน...แค่นั้นเองเฉพาะหน้านี้"). Scoped to this one page on purpose: every
 * other page under this module has nothing to put here, so ReportTaskScaffold
 * just passes `null` through to AppScaffold's `leading` prop by default.
 *
 * Two contexts, not one: the page that *sets* the node must not re-render when
 * the node changes. With a single `{ node, setNode }` context the setter page
 * was also a consumer — every setNode re-rendered it, which built a new node,
 * which called setNode again — an endless render loop that starved Next's
 * navigation (clicking "แชท" from the report page did nothing until a refresh).
 */
const LeadingNodeContext = createContext<ReactNode>(null);
const SetLeadingContext = createContext<Dispatch<SetStateAction<ReactNode>> | null>(null);

export function AppBarLeadingProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return (
    <SetLeadingContext.Provider value={setNode}>
      <LeadingNodeContext.Provider value={node}>{children}</LeadingNodeContext.Provider>
    </SetLeadingContext.Provider>
  );
}

export function useAppBarLeading(): ReactNode {
  return useContext(LeadingNodeContext);
}

/** Registers `node` as the AppBar's left-slot control for as long as the
 * calling page is mounted — clears itself on unmount so navigating to a page
 * without one doesn't leave a stale button behind. `node` may be rebuilt on
 * every render: only the AppBar re-renders when it changes, never the page. */
export function useSetAppBarLeading(node: ReactNode) {
  const setNode = useContext(SetLeadingContext);
  useEffect(() => {
    setNode?.(node);
  }, [setNode, node]);
  useEffect(() => () => setNode?.(null), [setNode]);
}
