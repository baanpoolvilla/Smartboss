import type { NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";

import { withDirectory } from "@/modules/report_task/lib/directory";
import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";
import { listDepartmentsWithOverlay } from "@/modules/report_task/lib/db/departments";
import { readStoreCached } from "@/modules/report_task/lib/db/store-cached-read";
import { readStoreVersion } from "@/modules/report_task/lib/db/org-store";
import { readStorePayload } from "@/modules/report_task/lib/db/store-read";
import { readTasksCached } from "@/modules/report_task/lib/db/task-cache";
import { readTasksVersion } from "@/modules/report_task/lib/db/task-repo";
import { countReportTileBadge, countTaskTileBadge } from "@/modules/report_task/lib/home-badge-count";
import { isOthersPersonalTask } from "@/modules/report_task/lib/personal-task";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { TaskReviewSettings } from "@/modules/report_task/store/task-review-settings-store";
import type { User } from "@/modules/report_task/types";

/**
 * เลขบนไอคอนหน้าหลัก — เซิร์ฟเวอร์นับให้ ส่งกลับแค่ { count }
 *
 * เดิมเครื่องผู้ใช้โหลดฟีดรายงานทั้งก้อน (prod 4.3 MB) / งานทุกใบ (0.9 MB) มาเพื่อนับเลขตัวเดียว ทุกครั้งที่เข้าหน้าหลัก
 * (243 ครั้ง/วัน — 18/11/2569) มือถือในแอป LINE ต้องโหลดและแปลงเองช้ามาก · เซิร์ฟเวอร์ก็ต้องแปลงก้อนใหญ่ส่งออกทุกครั้ง
 *
 * สูตรนับตัวเดียวกับหน้าจอ (lib/home-badge-count.ts) ข้อมูลชุดเดียวกับที่เครื่องเคยโหลด (route เดิมแต่ละตัว)
 * ฟีดกับงานอ่านจากชุดที่จำไว้ตามเลขรุ่น (ไม่ต้องอ่าน/แปลงจากฐานข้อมูลใหม่ถ้าไม่มีใครแก้)
 * ถ้า route นี้พัง หน้าหลักย้อนไปนับแบบเดิมเอง (app-tile-review-badge.tsx)
 */
export const dynamic = "force-dynamic";

/**
 * จำผลนับรายคนไว้ — ข้อมูลที่ใช้นับไม่เปลี่ยน (เลขรุ่นเท่าเดิม + รายชื่อ/แผนกเท่าเดิม) ไม่ต้องนับใหม่
 * นับฟีด 4 MB ทั้งก้อนใช้ ~25 ms ในเครื่องทดสอบ (กรณีแย่สุด) ⇒ เครื่องจริงช้ากว่าราว 5 เท่า ไม่จำก็กินเวลาเท่าเดิม
 * อ่านเลขรุ่น "ก่อน" อ่านข้อมูล — มีคนแก้แทรกระหว่างนั้น รอบหน้าเลขรุ่นไม่ตรง นับใหม่เอง · โปรเซสเดียว (ดู store-delta-log.ts)
 */
const g = globalThis as unknown as { __homeBadge?: Map<string, { sig: string; count: number }> };
const memo = (g.__homeBadge ??= new Map());
const MEMO_MAX = 5000;

export async function GET(request: NextRequest) {
  const session = await requireOrg();
  const part = request.nextUrl.searchParams.get("part") === "reports" ? "reports" : "tasks";
  const { orgId, userId } = session;

  const [employees, departments] = await Promise.all([listDirectory(orgId), listDepartmentsWithOverlay(orgId)]);
  const dir = { users: employees as unknown as User[], departments, sessionOwnerId: null };

  const dirSig = JSON.stringify([employees, departments]);
  const memoKey = `${orgId}|${userId}|${part}`;
  const versions =
    part === "reports"
      ? [await readStoreVersion(orgId, "report-feed")]
      : await Promise.all([
          readTasksVersion(orgId),
          readStoreVersion(orgId, "notifications"),
          readStoreVersion(orgId, "task-review-settings"),
        ]);
  const sig = `${versions.join(",")}|${dirSig}`;
  const hit = memo.get(memoKey);
  if (hit && hit.sig === sig) return Response.json({ count: hit.count }, { headers: { "Cache-Control": "no-store" } });

  let count: number;
  if (part === "reports") {
    const { data } = await readStoreCached<{ topics?: ReportTopic[]; posts?: ReportPost[] } | null>(orgId, "report-feed");
    count = withDirectory(dir, () => countReportTileBadge(data ?? null, userId));
  } else {
    const [{ tasks: all }, notif, review] = await Promise.all([
      readTasksCached(orgId),
      readStorePayload(orgId, userId, "notifications"),
      readStorePayload(orgId, userId, "task-review-settings"),
    ]);
    // ชุดเดียวกับ GET /api/report-task/tasks: งานส่วนตัวของคนอื่นไม่นับ ยกเว้น Boss (เจ้าของบริษัท)
    const boss = employees.some((u) => u.id === userId && u.isOwner === true);
    const tasks = boss ? all : all.filter((t) => !isOthersPersonalTask(t, userId));
    count = withDirectory(dir, () =>
      countTaskTileBadge(
        tasks,
        (notif.payload as AppNotification[] | null) ?? [],
        userId,
        (review.payload as TaskReviewSettings | null) ?? null
      )
    );
  }
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(memoKey, { sig, count });
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
