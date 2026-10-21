import "server-only";

import type { Viewer } from "./data";
import { listVisibleRequests } from "./data";
import type { RequestView } from "./db";
import { KIND_META, KINDS, costOf, daysInMonthOf, round2, type RequestKind } from "./types";

/** รายการของเดือน `month` (ตามวันที่ทำงาน/วันที่จ่าย) ที่ยังมีผล — ไม่นับไม่อนุมัติ/ยกเลิก */
export async function monthRequests(orgId: string, viewer: Viewer, month: string): Promise<RequestView[]> {
  const rows = await listVisibleRequests(orgId, viewer, { from: `${month}-01`, to: `${month}-${String(daysInMonthOf(month)).padStart(2, "0")}` });
  return rows.filter((r) => r.status !== "rejected" && r.status !== "cancelled");
}

export interface Group {
  key: string;
  label: string;
  count: number;
  total: number;
  byKind: Partial<Record<RequestKind, number>>;
}

export function groupBy(rows: RequestView[], keyOf: (r: RequestView) => [string, string]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const [key, label] = keyOf(r);
    const g = map.get(key) ?? { key, label, count: 0, total: 0, byKind: {} };
    g.count++;
    g.total = round2(g.total + costOf(r));
    g.byKind[r.kind] = round2((g.byKind[r.kind] ?? 0) + costOf(r));
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function kindTotals(rows: RequestView[]) {
  return KINDS.map((k) => {
    const list = rows.filter((r) => r.kind === k);
    return { kind: k, label: KIND_META[k].label, count: list.length, total: round2(list.reduce((s, r) => s + costOf(r), 0)), paid: round2(list.reduce((s, r) => s + r.paidTotal, 0)) };
  });
}
