"use server";

import { requireOrg, hasPermission } from "@smartboss/auth";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { workOrderAccess } from "@/modules/maintenance/data/work-order-access";
import {
  scoreWatchDocks,
  scoreWatchRows,
  type ScoreWatchDockRow,
  type ScoreWatchGroup,
  type ScoreWatchRow,
} from "@/modules/maintenance/data/score-watch";

const GROUPS: ScoreWatchGroup[] = ["late", "soon", "later", "none"];

/** กดโดนัทบนแดชบอร์ด: รายชื่อใบของกลุ่มนั้น เท่าที่คนนี้มีสิทธิ์เห็น */
export async function loadScoreWatchRowsAction(group: ScoreWatchGroup): Promise<ScoreWatchRow[]> {
  if (!GROUPS.includes(group)) return [];
  const s = await requireOrg();
  return scoreWatchRows(s.orgId, await workOrderAccess(s), group);
}

/** กด "คะแนนที่โดนหัก": ทั้งบริษัทเฉพาะคนมีสิทธิ์ดูผลงาน ไม่งั้นของตัวเอง — เหมือนตัวเลขบนโดนัท */
export async function loadScoreWatchDocksAction(): Promise<ScoreWatchDockRow[]> {
  const s = await requireOrg();
  return scoreWatchDocks(s.orgId, await workOrderAccess(s), hasPermission(s, ADMIN_PERMS.performanceView));
}
