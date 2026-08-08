import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listPmSchedules } from "@/modules/maintenance/data/pm";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listAssets } from "@/modules/maintenance/data/assets";
import { userNameMap } from "@/modules/maintenance/data/users";
import { fmtThaiDate, fmtThaiDateTime, toDateInput } from "@/modules/maintenance/lib/format";
import {
  freqLabel,
  pmMode,
  PM_FREQUENCIES,
} from "@/modules/maintenance/lib/pm-schedule";
import { PmBoard, type PmRow } from "@/modules/maintenance/components/pm-board";
import {
  AppScaffold,
  AppBarLink,
  Fab,
} from "@/modules/maintenance/components/app-scaffold";
import {
  deletePmAction,
  scheduleNextAction,
  updatePmAction,
} from "./actions";

function daysUntil(due: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export default async function PmListPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.pmView)) redirect("/");
  const orgId = session.orgId;
  const canManage = hasPermission(session, MAINT_PERMS.pmManage);
  const { propertyId } = await searchParams;

  const [schedules, properties, assets] = await Promise.all([
    listPmSchedules(orgId, { propertyId }),
    listProperties(orgId),
    listAssets(orgId),
  ]);

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  const assetNames: Record<string, string> = Object.fromEntries(
    assets.map((a) => [a.id, a.name])
  );
  const names = await userNameMap(orgId, [
    ...schedules.map((s) => s.assignedTo),
    ...schedules.map((s) => s.createdBy),
  ]);

  // PM ที่มีใบงานค้างอยู่ (open/in_progress) — ใช้แยกสถานะ "เปิดใบงานแล้ว"
  const pendingWos = await prisma.workOrder.findMany({
    where: { orgId, status: { in: ["open", "in_progress"] } },
    select: { pmScheduleId: true, pmScheduleIds: true },
  });
  const pending = new Set<string>();
  for (const w of pendingWos) {
    if (w.pmScheduleId) pending.add(w.pmScheduleId);
    for (const id of w.pmScheduleIds) pending.add(id);
  }

  const rows: PmRow[] = schedules.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    propertyId: s.propertyId,
    propertyName: propNames[s.propertyId] ?? "",
    assetId: s.assetId,
    assetName: s.assetId ? (assetNames[s.assetId] ?? null) : null,
    frequencyLabel: freqLabel(s.frequency),
    mode: pmMode(s),
    roundsDone: s.roundsDone,
    totalRounds: s.totalRounds,
    roundsPerYear: s.roundsPerYear,
    awaitingSchedule: s.awaitingSchedule,
    daysUntilDue: daysUntil(s.nextDueDate),
    nextDueLabel: fmtThaiDate(s.nextDueDate),
    nextDueInput: toDateInput(s.nextDueDate),
    createdAtLabel: fmtThaiDateTime(s.createdAt),
    createdByName: s.createdBy ? (names[s.createdBy] ?? null) : null,
    assignedTo: s.assignedTo,
    assignedToName: s.assignedTo ? (names[s.assignedTo] ?? null) : null,
    hasPendingWorkOrder: pending.has(s.id),
  }));

  // ผู้ดูแลบ้าน (จัดการ PM ได้แต่แก้ข้อมูลบ้านไม่ได้) มอบงานให้ตัวเองอัตโนมัติ
  const isCaretaker =
    canManage && !hasPermission(session, MAINT_PERMS.propertyManage);

  return (
    <AppScaffold
      title="PM Dashboard"
      width="max-w-[1100px]"
      actions={
        <AppBarLink
          href="/maintenance/equipment-overview"
          label="สรุปอุปกรณ์ทุกหลัง"
        >
          <ListChecks className="h-5 w-5" />
        </AppBarLink>
      }
      fab={canManage ? <Fab href="/maintenance/pm/new" label="เพิ่ม PM" /> : null}
    >
      <PmBoard
        schedules={rows}
        canManage={canManage}
        selfIdForAssign={isCaretaker ? session.userId : null}
        scheduleNextAction={scheduleNextAction}
        deleteAction={deletePmAction}
        updateAction={updatePmAction}
        frequencyOptions={PM_FREQUENCIES.map((f) => ({
          value: f.value,
          label: f.label,
        }))}
      />
    </AppScaffold>
  );
}
