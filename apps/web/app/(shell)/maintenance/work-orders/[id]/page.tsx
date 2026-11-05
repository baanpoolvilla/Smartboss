import { loadPerformanceSettings } from "@/lib/performance";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import {
  Info,
  Home as HomeIcon,
  UserPlus,
  HardHat,
  Users,
  Flag,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  StickyNote,
  Images,
  CloudUpload,
  MessageSquare,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  CornerUpLeft,
} from "lucide-react";
import { requireOrg, hasPermission, canViewAll, hasRole, isSuperAdmin as isTopAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { prisma } from "@smartboss/database";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  getWorkOrder,
  listWorkOrderComments,
  commentImages,
  workOrderOwnerId,
} from "@/modules/maintenance/data/work-orders";
import { WorkOrderComment } from "@/modules/maintenance/components/work-order-comment";
import { listProperties } from "@/modules/maintenance/data/properties";
import {
  workOrderAccess,
  canSeeWorkOrder,
} from "@/modules/maintenance/data/work-order-access";
import { getAsset } from "@/modules/maintenance/data/assets";
import { userNameMap } from "@/modules/maintenance/data/users";
import { workOrderMentionPeople } from "@/modules/maintenance/data/wo-mentions";
import { listExpenses } from "@/modules/maintenance/data/expenses";
import { listPurchaseOrdersForWorkOrder } from "@/modules/maintenance/data/purchase-orders";
import { returnStatusMeta } from "@/modules/maintenance/data/equipment-returns";
import { poItemsFromJson, poStatusMeta } from "@/modules/maintenance/lib/po";
import { getPmScheduleIdForAsset } from "@/modules/maintenance/data/pm";
import {
  getActiveUploadLink,
  listExternalPhotos,
} from "@/modules/maintenance/data/external-upload";
import { fmtThaiDate, fmtThaiDateTime } from "@/modules/maintenance/lib/format";
import { priorityLabel } from "@/modules/maintenance/lib/priority";
import { InfoRow, SectionCard } from "@/modules/maintenance/components/ui";
import { PhotoStrip } from "@/modules/maintenance/components/photos";
import {
  StartJobButton,
  CompleteJobButton,
  ChangeStatusButton,
  DeleteButton,
  ExternalUploadCard,
  CommentComposer,
} from "@/modules/maintenance/components/work-order-detail-actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { MarkReadOnView } from "@/modules/notifications/mark-read-on-view";
import {
  updateStatusAction,
  completeWorkOrderAction,
  toggleMyGroupPartAction,
  addCommentAction,
  editCommentAction,
  deleteCommentAction,
  deleteWorkOrderAction,
  generateUploadLinkAction,
  updateWorkOrderPropertiesAction,
} from "../actions";
import { EditWorkOrderProperties } from "@/modules/maintenance/components/edit-work-order-properties";
import { WoChecklist, WoTeamEditButton, type ChecklistView } from "@/modules/maintenance/components/work-order-team";
import { canTickItem, checklistAllowsClose, itemsOf, readChecklist, remainingCount } from "@/modules/maintenance/lib/work-order-checklist";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import { roleLabel } from "@/modules/maintenance/lib/role-label";
import { WorkOrderDueRequest, type DueRequestView } from "@/modules/maintenance/components/work-order-due-request";
import { buildScoreQueue } from "@/lib/score-request-views";
import { ScoreRequestCard } from "@/app/(shell)/hr/penalty-requests/score-requests-queue";
import { listDueRequests } from "@/modules/maintenance/data/work-order-due-requests";
import { expenseHasSource, expenseLinks, listExpenseDueRequests, loadExpenseTracking, requestsOfExpenses } from "@/modules/maintenance/data/expense-tracking";
import { groupExpenseBatches, realExpenseTotal } from "@/modules/maintenance/lib/expense-batches";
import type { ReceiptData } from "@/modules/maintenance/lib/receipt-read";
import { expenseDaysLeft, expenseDueAt, isExpenseBacklog, trackingActive } from "@/modules/maintenance/lib/expense-deadline";
import { paymentMethodLabel } from "@/modules/maintenance/lib/receipt-read";
import { ExpenseDeadlineBox, type ExpenseRequestView } from "@/modules/maintenance/components/expense-deadline-box";
import { canDecideDueRequest, canEditDueDate } from "@/modules/maintenance/lib/due-request-access";
import { canDeleteWorkOrderWithPerm } from "@/modules/maintenance/lib/work-order-delete";
import { COMPLETION_RULE_LABEL, earliestPendingDue, isWorkOrderMember, memberDueAt, waitingOnMembers, workOrderMemberIds } from "@/modules/maintenance/lib/work-order-members";

const STATUS_COLOR: Record<string, string> = {
  open: "#2563EB",
  in_progress: "#EA580C",
  completed: "#16A34A",
  cancelled: "#6B7280",
};
const STATUS_LABEL: Record<string, string> = {
  open: "เปิด",
  in_progress: "กำลังดำเนินการ",
  completed: "เสร็จแล้ว",
  cancelled: "ยกเลิก",
};
/** สีของแต่ละความเร่งด่วนบนหน้านี้ — label มาจาก lib/priority.ts ให้ตรงกับบอร์ด */
const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#DC2626",
  high: "#EA580C",
  medium: "#2563EB",
  low: "#6B7280",
};

/** Date → YYYY-MM-DD ตามเวลาไทย (กำหนดส่งเก็บเป็นสิ้นวันเวลาไทย) */
const ymdBkk = (d: Date) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  // เปิดมาจากการ์ดบนบอร์ดงาน (?from=tasks — maintenance-card.tsx) = ปุ่มย้อนกลับพากลับบอร์ดงาน
  const fromTasks = (await searchParams).from === "tasks";
  const session = await requireOrg();
  const pmMissedPoints = Math.abs((await loadPerformanceSettings(session.orgId)).rulePoints.pm_missed);
  if (!hasPermission(session, MAINT_PERMS.workorderView)) redirect("/");
  const orgId = session.orgId;

  const wo = await getWorkOrder(orgId, id);
  if (!wo) notFound();

  // row-level: เห็นเฉพาะใบที่ตัวเองเกี่ยวข้อง (คนเปิด/ผู้รับมอบหมาย/CC/
  // ผู้ดูแลบ้านหลังนั้น) — กติกาเดียวกับที่หน้ารายการใช้กรอง ไม่งั้นจะเกิด
  // "ไม่เห็นในลิสต์ แต่เปิดลิงก์ตรงเข้ามาดูได้"
  const access = await workOrderAccess(session);
  if (!canSeeWorkOrder(access, wo)) redirect("/maintenance/work-orders");

  const canManage = hasPermission(session, MAINT_PERMS.workorderManage);
  const isOwnJob =
    isWorkOrderMember(wo, session.userId) || wo.createdBy === session.userId;

  const waitingOnGroup = waitingOnMembers(wo, session.userId);
  const groupAll = wo.groupMemberIds.length > 0 && (wo.completionRule ?? "all") === "all";
  // ใบกลุ่ม: สมาชิกเห็นและขอเลื่อนวันของตัวเอง · คนอื่นเห็นวันใกล้สุดของคนที่ยังไม่เสร็จ
  const viewerDue = isWorkOrderMember(wo, session.userId) ? (memberDueAt(wo, session.userId) ?? earliestPendingDue(wo)) : earliestPendingDue(wo);
  const canChangeStatus =
    canManage ||
    (hasPermission(session, MAINT_PERMS.workorderComplete) && isOwnJob);
  const canExpense = hasPermission(session, MAINT_PERMS.expenseManage);
  const canSeePo = hasPermission(session, MAINT_PERMS.poView);
  // ผู้รับผิดชอบใบงานที่ไม่มีสิทธิ์ดู PR/PO ยังเห็น "PR ของใบงานตัวเองถึงไหนแล้ว" (ชื่อ + สถานะ ไม่มีราคา ไม่มีลิงก์)
  // ผู้ใช้ 2/11/2569 — เดิมไม่เห็นอะไรเลย ต้องรอแจ้งเตือนอย่างเดียว
  const seeOwnPoStatus = !canSeePo && isWorkOrderMember(wo, session.userId);
  const canCreatePo = hasPermission(session, MAINT_PERMS.poCreate);
  // ใบงานที่ยกเลิกไปแล้ว / ใบส่วนตัว (กันลืม ไม่นับเป็นงานบริษัท — ค่าใช้จ่ายจาก PR จะไปนับ) ไม่เปิดใบสั่งซื้อ
  const canOpenPoHere = canCreatePo && wo.status !== "cancelled" && !wo.isPrivate;
  const isSuperAdmin = hasPermission(session, MAINT_PERMS.admin);
  const isTechnicianOnly = !canManage;

  const [properties, asset, comments, expenses, externalPhotos, linkedPos, dueRequests] =
    await Promise.all([
      listProperties(orgId),
      wo.assetId ? getAsset(orgId, wo.assetId) : Promise.resolve(null),
      listWorkOrderComments(orgId, id),
      listExpenses(orgId, { workOrderId: id }),
      listExternalPhotos(orgId, id),
      canSeePo || seeOwnPoStatus
        ? listPurchaseOrdersForWorkOrder(orgId, id)
        : Promise.resolve([]),
      listDueRequests(orgId, id),
    ]);

  // เรื่องคืนของที่ยังไม่จบของ PR ใบงานนี้ — บอกไว้ใต้ PR ให้รู้ว่าของยังไม่ครบ/รอเปลี่ยน
  const openReturns = new Map<string, string>(
    linkedPos.length === 0
      ? []
      : (
          await prisma.equipmentReturn.findMany({
            where: { orgId, purchaseOrderId: { in: linkedPos.map((p) => p.id) }, status: { in: ["pending", "processing"] } },
            select: { purchaseOrderId: true, status: true },
            orderBy: { createdAt: "asc" },
          })
        ).map((r) => [r.purchaseOrderId, r.status])
  );

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  const names = await userNameMap(orgId, [
    wo.assignedTo,
    ...wo.groupMemberIds,
    wo.createdBy,
    ...wo.ccUserIds,
    ...comments.map((c) => c.userId),
    ...dueRequests.flatMap((r) => [r.requestedBy, r.decidedBy]),
    ...readChecklist(wo.checklist).flatMap((c) => [c.ownerId, c.doneBy]),
  ]);

  const uploadLink = canManage ? await getActiveUploadLink(orgId, id) : null;
  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const uploadUrl = uploadLink ? `${proto}://${host}/u/${uploadLink.token}` : null;

  const hasExpense = expenses.length > 0;
  // แก้บ้าน (เลือกผิดตอนเปิดใบ) — เงื่อนไขเดียวกับ updateWorkOrderPropertiesAction
  const canEditProperties =
    (canManage || wo.createdBy === session.userId) &&
    !wo.autoCreated &&
    !wo.pmScheduleId &&
    wo.pmScheduleIds.length === 0 &&
    !hasExpense;
  const pmForExpense =
    wo.status === "completed" && !hasExpense && wo.assetId
      ? await getPmScheduleIdForAsset(orgId, wo.assetId)
      : null;

  const pr = {
    label: priorityLabel(wo.priority),
    color: PRIORITY_COLOR[wo.priority] ?? "#2563EB",
  };
  const overdue =
    wo.dueDate != null && wo.dueDate < new Date() && wo.status !== "completed";
  const isOpenOrRunning = wo.status !== "completed" && wo.status !== "cancelled";
  // การเปลี่ยนกำหนดส่งครั้งล่าสุด (แก้ตรง ๆ / อนุมัติคำขอเลื่อน) — โชว์ใต้วันที่ ไม่ต้องเลื่อนไปหาในความคิดเห็น
  // ("แก้แล้วไม่เห็นมีบอกเลยใครแก้" 19/10/2569) · อ่านจากแถว log ที่ due-request-actions.ts เขียนไว้
  const lastDueChange = [...comments]
    .reverse()
    .find((c) => c.kind === "log" && /^(แก้กำหนดส่ง|อนุมัติเลื่อนกำหนดส่ง) /.test(c.content ?? ""));
  const viewAll = canViewAll(session);
  // คนเปิดใบ — ใบ PM อัตโนมัติ = คนสร้างแผน PM (อนุมัติ/แก้กำหนดส่งได้แทน CEO)
  const ownerId = await workOrderOwnerId(orgId, wo);

  // แก้ผู้รับผิดชอบ + เช็กลิสต์ (team-actions.ts) — คนแก้ทีม = คนแก้กำหนดส่งได้
  const isOpenNow = wo.status === "open" || wo.status === "in_progress";
  const canEditTeam = isOpenNow && !wo.isPrivate && canEditDueDate({ userId: session.userId, viewAll }, { createdBy: ownerId });
  const teamUsers = canEditTeam
    ? (await listOrgUsers(orgId))
        .filter((u) => hasPermission(session, MAINT_PERMS.propertyManage) || u.roleCodes.includes("TECHNICIAN") || u.roleCodes.includes("CARETAKER") || workOrderMemberIds(wo).includes(u.id))
        .map((u) => ({ id: u.id, label: u.name, sub: roleLabel(u.roleCodes) }))
    : [];
  const checkItems = readChecklist(wo.checklist);
  const isGroupWo = wo.groupMemberIds.length > 0;
  const sharedWo = isGroupWo && (wo.completionRule ?? "all") === "shared";
  const myItems = itemsOf(checkItems, session.userId, wo);
  const checklistReady = checklistAllowsClose(wo, checkItems);
  const checklistViews: ChecklistView[] = checkItems.map((c) => ({
    id: c.id,
    text: c.text,
    done: c.done,
    ownerName: isGroupWo && !sharedWo && c.ownerId ? (names[c.ownerId] ?? "-") : null,
    doneByName: c.done && c.doneBy && (isGroupWo || c.doneBy !== c.ownerId) ? (names[c.doneBy] ?? "-") : null,
    mine: c.ownerId === session.userId && isGroupWo && !sharedWo,
    canTick: canTickItem(c, session.userId, wo, viewAll),
    canRemove: canEditTeam || (c.ownerId === session.userId && !c.done),
  }));
  const checklistHint =
    checkItems.length === 0
      ? "ไม่บังคับ · ใส่ขั้นตอนที่ต้องทำ ติ๊กครบแล้วถึงปิดงานได้"
      : checklistReady
        ? "ติ๊กครบแล้ว ปิดงานได้"
        : !isGroupWo
          ? `เหลือ ${remainingCount(checkItems)} ข้อ · ติ๊กครบถึงปิดงานได้`
          : sharedWo
            ? `ช่วยกันทำ: ใครในกลุ่มติ๊กข้อไหนก็ได้ · เหลือ ${remainingCount(checkItems)} ข้อ`
            : myItems.length > 0
              ? `ข้อของคุณเหลือ ${myItems.filter((c) => !c.done).length} ข้อ · ติ๊กครบ = ส่วนของคุณเสร็จ`
              : (wo.completionRule ?? "all") === "any"
                ? "ใครติ๊กข้อของตัวเองครบก่อน ปิดงานได้"
                : "แต่ละคนติ๊กข้อของตัวเองให้ครบ";
  const dueRequestViews: DueRequestView[] = dueRequests.map((r) => ({
    id: r.id,
    requestedBy: r.requestedBy,
    requestedByName: names[r.requestedBy] ?? "-",
    previousDate: r.previousDate ? ymdBkk(r.previousDate) : null,
    newDate: ymdBkk(r.newDate),
    reason: r.reason,
    status: r.status as DueRequestView["status"],
    decidedByName: r.decidedBy ? (names[r.decidedBy] ?? "-") : null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
    canDecide: r.status === "pending" && isOpenOrRunning && canDecideDueRequest({ userId: session.userId, viewAll }, { createdBy: ownerId }, r.requestedBy),
  }));
  // รอบันทึกค่าใช้จ่าย + เปิดใช้กำหนดบันทึกแล้ว — กล่องบอกเหลือกี่วัน ปุ่มบันทึก ขอเลื่อน/อนุมัติ
  const tracking = await loadExpenseTracking(orgId);
  const expenseOn = trackingActive(tracking);
  const noExpenseYet = expenseOn && wo.status === "completed" && wo.requiresExpense && !wo.isPrivate && !hasExpense;
  const expenseLink = noExpenseYet ? (await expenseLinks(orgId, [id])).get(id) : undefined;
  // ยังมี PR/PO หรือใบเบิกไม่จบ: ต้นทางจะลงยอดให้เอง ถ้าลงที่นี่ด้วยยอดจะเบิ้ล
  const expenseHeld = !!expenseLink?.hold;
  const expenseWaiting = noExpenseYet && !expenseHeld;
  const expenseDue = expenseWaiting ? expenseDueAt({ ...wo, clockFrom: expenseLink?.clockFrom }, tracking) : null;
  const expenseRequests = expenseWaiting ? await listExpenseDueRequests(orgId, id) : [];
  const expenseNames = expenseRequests.length ? await userNameMap(orgId, expenseRequests.flatMap((r) => [r.requestedBy, r.decidedBy])) : {};
  const expenseRequestViews: ExpenseRequestView[] = expenseRequests.map((r) => ({
    id: r.id,
    requestedBy: r.requestedBy,
    requestedByName: expenseNames[r.requestedBy] ?? "-",
    newDate: ymdBkk(r.newDate),
    reason: r.reason,
    status: r.status as ExpenseRequestView["status"],
    decidedByName: r.decidedBy ? (expenseNames[r.decidedBy] ?? "-") : null,
    decisionNote: r.decisionNote,
  }));
  const canSeeExpense = hasPermission(session, MAINT_PERMS.expenseView) || canExpense;
  const expenseTotal = realExpenseTotal(expenses);
  const closerDraft = wo.expenseDraft as { name?: string; price?: string } | null;
  const expenseBatches = groupExpenseBatches(expenses);
  const expenseRequestLinks = hasExpense && canSeeExpense ? await requestsOfExpenses(orgId, expenses.map((e) => e.id)) : new Map<string, { id: string; code: string }>();
  const expenseRecorderNames = hasExpense && canSeeExpense ? await userNameMap(orgId, expenses.map((e) => e.createdBy)) : {};
  const recordExpenseHref = `/maintenance/expenses/new?workOrderId=${id}${pmForExpense ? `&pmScheduleId=${pmForExpense}` : ""}${fromTasks ? "&from=tasks" : ""}`;
  // ช่างนอกส่งข้อความเปล่าได้ (ไม่มีรูป) แถวแบบนั้น storagePath เป็นค่าว่าง
  const externalUrls = externalPhotos
    .map((p) => p.storagePath)
    .filter((u) => u !== "");
  const externalNotes = externalPhotos.filter((p) => p.note);

  const scoreQueue = await buildScoreQueue(session, (r) => r.target.kind === "work_order" && r.target.id === wo.id);

  return (
    <AppScaffold
      title="รายละเอียดใบงาน"
      width="max-w-none"
      backHref={fromTasks ? "/report-task/tasks" : "/maintenance/work-orders"}
    >
      <MarkReadOnView referenceId={wo.id} />

      {/* ─── คำขอแก้คะแนนของใบนี้ที่รอคุณ (คนเปิดใบงาน / CEO) — เหตุผลและผลบันทึกลงประวัติใบงานด้วย ─── */}
      {scoreQueue.pending.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          <p className="text-sm font-semibold text-(--ink)">🛡️ ขอแก้คะแนน รออนุมัติ</p>
          {scoreQueue.pending.map((item) => (
            <ScoreRequestCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* แบบหน้ารายละเอียดงาน: ซ้าย = ข้อมูลใบงาน · ขวา = ความคิดเห็น (จอเล็กเรียงต่อกัน ความคิดเห็นอยู่ล่าง) */}
      {expenseHeld && (
        <div className="mb-4 rounded-xl border border-(--line) bg-(--bg-soft) p-4 text-sm text-(--ink)" data-testid="expense-held">
          <b>รอ PR/PO หรือใบเบิกจบ</b> · ระบบจะลงค่าใช้จ่ายให้เองเมื่อต้นทางจบ ยังไม่ต้องบันทึกที่นี่ และยังไม่นับวัน
        </div>
      )}
      {expenseDue && (
        <ExpenseDeadlineBox
          workOrderId={wo.id}
          dueDate={ymdBkk(expenseDue)}
          daysLeft={expenseDaysLeft(expenseDue)}
          closedLabel={wo.completedAt ? fmtThaiDate(wo.completedAt) : "-"}
          recordHref={canExpense ? recordExpenseHref : null}
          canRequest={tracking.recorderIds.includes(session.userId)}
          canDecide={hasRole(session, "CEO") || isTopAdmin(session)}
          myId={session.userId}
          noDock={isExpenseBacklog(wo, tracking)}
          requests={expenseRequestViews}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:items-start">
      <div className="min-w-0">
      {/* ─── หัวข้อ + ข้อมูลใบงาน ─── */}
      <Card className="mb-4 p-4 sm:p-5">
        {/* หัวใบแบบหน้ารายละเอียดงาน (ผู้ใช้ 2/11/2569 "แปลงเป็นแบบ task"): ป้าย · เลขที่ → หัวข้อ → รายละเอียด → ข้อมูล 2 คอลัมน์ */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {/* งานอัตโนมัติไม่แสดงความเร่งด่วน — ดูเหตุผลใน components/work-order-board.tsx */}
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-semibold"
            style={
              wo.autoCreated
                ? { color: "#0D9488", backgroundColor: "#0D94881a", border: "1px solid #0D94884d" }
                : { color: pr.color, backgroundColor: `${pr.color}1a`, border: `1px solid ${pr.color}4d` }
            }
          >
            {wo.autoCreated ? (
              <>
                <RefreshCw className="h-3 w-3" /> อัตโนมัติจาก PM
              </>
            ) : (
              pr.label
            )}
          </span>
          {(wo.pmScheduleId || wo.pmScheduleIds.length > 0) && (
            <span className="rounded px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: "#7c3aed" }}>PM</span>
          )}
          {wo.isPrivate && (
            <span className="rounded bg-(--brand-navy) px-1.5 py-0.5 text-[11px] font-bold text-white">🔒 ส่วนตัว</span>
          )}
          {/* เลขที่ใบงาน — ให้อ่านให้ช่างฟังทางโทรศัพท์ได้ ต่างจาก id ที่เป็น uuid */}
          <span className="font-mono text-(--ink-soft)">{wo.code}</span>
        </div>
        <h1 className="mt-2 border-b border-(--line) pb-2 text-xl font-bold text-(--ink)">{wo.title}</h1>

        <div className="mt-3">
          <p className="mb-1 text-xs text-(--ink-soft)">รายละเอียด</p>
          <div className="min-h-12 whitespace-pre-wrap rounded-(--radius) border border-(--line) px-3 py-2 text-sm text-(--ink)">
            {wo.description || <span className="text-(--ink-soft)">ไม่มีรายละเอียด</span>}
          </div>
        </div>

        <div className="mt-3 grid gap-x-6 sm:grid-cols-2">

        <InfoRow
            stacked
          icon={<Info className="h-5 w-5" />}
          label="สถานะ"
          value={STATUS_LABEL[wo.status] ?? wo.status}
          valueColor={STATUS_COLOR[wo.status]}
        />
        <InfoRow
            stacked
          icon={<HomeIcon className="h-5 w-5" />}
          label="บ้าน"
          value={
            <>
              {[wo.propertyId, ...wo.additionalPropertyIds]
                .map((pid) => propNames[pid] ?? "")
                .filter(Boolean)
                .join(", ")}
              {canEditProperties && (
                <EditWorkOrderProperties
                  // บ้านที่เลิกใช้ไม่ให้เลือกเพิ่ม แต่บ้านที่อยู่ในใบงานนี้แล้วยังโชว์ (เอาออกได้)
                  options={properties
                    .filter((p) => !p.archivedAt || p.id === wo.propertyId || wo.additionalPropertyIds.includes(p.id))
                    .map((p) => ({ id: p.id, label: p.name }))}
                  selected={[wo.propertyId, ...wo.additionalPropertyIds]}
                  action={updateWorkOrderPropertiesAction.bind(null, wo.id)}
                />
              )}
            </>
          }
        />
        {asset && (
          <InfoRow
            stacked
            icon={<Info className="h-5 w-5" />}
            label="อุปกรณ์"
            value={asset.name}
          />
        )}
        {wo.createdBy && (
          <InfoRow
            stacked
            icon={<UserPlus className="h-5 w-5" />}
            label="สร้างโดย"
            value={names[wo.createdBy] ?? "-"}
          />
        )}
        {wo.assignedTo && (
          <InfoRow
            stacked
            icon={<HardHat className="h-5 w-5" />}
            label={wo.groupMemberIds.length > 0 ? `รับผิดชอบโดย (กลุ่ม · ปิดงานเมื่อ${COMPLETION_RULE_LABEL[wo.completionRule ?? "all"]})` : "รับผิดชอบโดย"}
            value={
              <span data-testid="team-names">
                {workOrderMemberIds(wo)
                  .map((id) => {
                    const own = (wo.memberDueDates as Record<string, string> | null)?.[id];
                    return `${names[id] ?? "-"}${own ? ` (ครบ ${fmtThaiDate(memberDueAt(wo, id))})` : ""}${wo.completedMemberIds.includes(id) ? " ✓" : ""}`;
                  })
                  .join(", ")}
                {canEditTeam && (
                  <>
                    {" "}
                    <WoTeamEditButton
                      id={id}
                      users={teamUsers}
                      assignedTo={wo.assignedTo}
                      members={wo.groupMemberIds}
                      rule={wo.completionRule ?? "all"}
                      memberDue={(wo.memberDueDates ?? {}) as Record<string, string>}
                      lockMode={wo.completedMemberIds.length > 0}
                    />
                  </>
                )}
              </span>
            }
          />
        )}
        {/* ใบกลุ่มแบบครบทุกคน: ปุ่มอยู่ใต้ชื่อผู้รับผิดชอบ เห็นโดยไม่ต้องเลื่อน (ผู้ใช้ 5/11/2569) */}
        {groupAll && (wo.status === "open" || wo.status === "in_progress") && (
          <div className="rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-sm sm:col-span-2" data-testid="group-progress">
            <p className="font-semibold text-(--ink)">เสร็จแล้ว {wo.completedMemberIds.length}/{workOrderMemberIds(wo).length} คน</p>
            <p className="mt-0.5 text-xs text-(--ink-soft)">
              {waitingOnGroup.length > 0
                ? `รอ ${waitingOnGroup.map((u) => names[u] ?? "-").join(", ")}`
                : isWorkOrderMember(wo, session.userId)
                  ? "ทุกคนเสร็จแล้ว เหลือคุณ ทำเสร็จแล้วกดปิดงานด้านล่าง"
                  : "ทุกคนเสร็จแล้ว รอปิดงาน"}
            </p>
            {canChangeStatus && isWorkOrderMember(wo, session.userId) && waitingOnGroup.length > 0 && myItems.length > 0 && (
              <p className="mt-2 text-xs font-medium text-(--brand-navy)">ติ๊กเช็กลิสต์ของคุณด้านล่างให้ครบ = ส่วนของคุณเสร็จ</p>
            )}
            {canChangeStatus && isWorkOrderMember(wo, session.userId) && waitingOnGroup.length > 0 && myItems.length === 0 && (
              <form action={toggleMyGroupPartAction} className="mt-2">
                <input type="hidden" name="id" value={id} />
                <button
                  type="submit"
                  data-testid="group-part-toggle"
                  className={
                    wo.completedMemberIds.includes(session.userId)
                      ? "h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) text-sm font-medium text-(--ink-soft) sm:w-auto sm:px-4"
                      : "h-10 w-full rounded-(--radius) bg-(--app-strong) text-sm font-semibold text-white sm:w-auto sm:px-4"
                  }
                >
                  {wo.completedMemberIds.includes(session.userId) ? "ยกเลิก เสร็จส่วนของฉัน" : "เสร็จส่วนของฉันแล้ว"}
                </button>
              </form>
            )}
          </div>
        )}
        <WoChecklist
          workOrderId={id}
          items={checklistViews}
          hint={checklistHint}
          canAdd={!wo.isPrivate || wo.createdBy === session.userId ? canEditTeam || isWorkOrderMember(wo, session.userId) : false}
          ownerOptions={canEditTeam && isGroupWo && !sharedWo ? workOrderMemberIds(wo).map((u) => ({ id: u, label: names[u] ?? "-" })) : []}
          defaultOwner={canEditTeam && isGroupWo && !sharedWo ? wo.assignedTo : null}
          open={isOpenNow}
        />
        {wo.ccUserIds.length > 0 && (
          <InfoRow
            stacked
            icon={<Users className="h-5 w-5" />}
            label="CC"
            value={wo.ccUserIds.map((u) => names[u] ?? "-").join(", ")}
          />
        )}
        {!wo.autoCreated && (
          <InfoRow
            stacked
            icon={<Flag className="h-5 w-5" />}
            label="ความเร่งด่วน"
            value={pr.label}
            valueColor={pr.color}
          />
        )}
        <InfoRow
            stacked
          icon={<CalendarDays className="h-5 w-5" />}
          label="สร้างเมื่อ"
          value={fmtThaiDateTime(wo.createdAt)}
        />
        {wo.isPrivate && (
          <InfoRow
            stacked
            icon={<Info className="h-5 w-5" />}
            label="ส่วนตัว"
            className="sm:col-span-2"
            value="🔒 ใบกันลืมของคนเปิด · เห็นเฉพาะคนเปิดกับ CEO · ไม่หักคะแนน ไม่นับสถิติ"
            valueColor="#1b2537"
          />
        )}
        {wo.pmRoundDate && (
          <InfoRow
            stacked
            icon={<CalendarDays className="h-5 w-5" />}
            label="รอบ PM"
            className="sm:col-span-2"
            value={
              <span className="grid gap-0.5">
                <span>ครบกำหนด {fmtThaiDate(wo.pmRoundDate)}</span>
                {isOpenOrRunning && (
                  <span className="text-[12.5px] font-normal text-(--ink-soft)">
                    {`ถ้ามีใบชื่อเดียวกันหลายใบ คือคนละรอบ ต้องปิดทุกใบ · เลยกำหนดส่งแล้วหัก ${pmMissedPoints} คะแนนทันที · ทำไม่ทันให้กด "ขอเลื่อนกำหนดส่ง" พร้อมเหตุผลก่อนถึงกำหนด`}
                  </span>
                )}
              </span>
            }
          />
        )}
        {wo.mergedIntoId && (
          <InfoRow
            stacked
            icon={<Info className="h-5 w-5" />}
            label="รวมเข้าใบ"
            className="sm:col-span-2"
            value={
              <Link href={`/maintenance/work-orders/${wo.mergedIntoId}`} className="text-(--brand-navy) hover:underline">
                ดูใบรวมที่ CEO รวบไว้ →
              </Link>
            }
          />
        )}
        {earliestPendingDue(wo) && (
          <InfoRow
            stacked
            icon={<CalendarClock className="h-5 w-5" />}
            label="กำหนดส่ง"
            className="sm:col-span-2"
            value={
              <div className="grid gap-2">
                <span style={overdue ? { color: "#DC2626" } : undefined}>{fmtThaiDate(viewerDue)}{viewerDue?.getTime() !== wo.dueDate?.getTime() ? " (กำหนดส่งของคุณ)" : ""}</span>
                {lastDueChange && (
                  <span className="text-[12.5px] font-normal leading-snug text-(--ink-soft)">
                    {lastDueChange.content}
                    <br />
                    โดย <b className="font-semibold text-(--ink)">{lastDueChange.userId ? (names[lastDueChange.userId] ?? "ผู้ใช้") : "ผู้ใช้"}</b> · {fmtThaiDateTime(lastDueChange.createdAt)}
                  </span>
                )}
                {/* ขอเลื่อนกำหนดส่ง (ผู้รับผิดชอบ) · อนุมัติ/ไม่อนุมัติ + แก้ตรง ๆ (CEO / คนเปิดใบงาน) */}
                <WorkOrderDueRequest
                  workOrderId={wo.id}
                  dueDate={ymdBkk(viewerDue!)}
                  // คนที่แก้กำหนดส่งเองได้ (คนเปิดใบ / CEO) ไม่ต้องขอเลื่อน — กดแก้ได้เลย (ผู้ใช้ 2/11/2569
                  // "เราเป็นคนสั่ง") · เดิมมอบงานให้ตัวเองแล้วกดขอเลื่อน คำขอวิ่งไปหา CEO โดยไม่จำเป็น
                  canRequest={isOpenOrRunning && isWorkOrderMember(wo, session.userId) && !canEditDueDate({ userId: session.userId, viewAll }, { createdBy: ownerId })}
                  canEdit={isOpenOrRunning && canEditDueDate({ userId: session.userId, viewAll }, { createdBy: ownerId })}
                  myId={session.userId}
                  requests={dueRequestViews}
                />
              </div>
            }
          />
        )}
        {wo.completedAt && (
          <InfoRow
            stacked
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="เสร็จเมื่อ"
            value={fmtThaiDate(wo.completedAt)}
            valueColor="#16A34A"
          />
        )}
        {wo.completionNotes && (
          <InfoRow
            stacked
            icon={<StickyNote className="h-5 w-5" />}
            label="รายละเอียดจบงาน"
            className="sm:col-span-2"
            value={
              <span className="whitespace-pre-wrap">{wo.completionNotes}</span>
            }
          />
        )}
        {wo.autoCreated && (
          <InfoRow
            stacked
            icon={<Info className="h-5 w-5" />}
            label="ที่มา"
            className="sm:col-span-2"
            value="สร้างอัตโนมัติจาก PM"
            valueColor="#0D9488"
          />
        )}
        {!wo.requiresExpense && (
          <InfoRow
            stacked
            icon={<Info className="h-5 w-5" />}
            label="ค่าใช้จ่าย"
            className="sm:col-span-2"
            value="งานนี้ไม่มีค่าใช้จ่าย — ปิดงานได้โดยไม่ต้องกรอก"
            valueColor="#0D9488"
          />
        )}
        </div>
      </Card>

      {/* ─── ค่าใช้จ่ายที่บันทึกแล้ว: บอกว่าเสร็จแล้ว + กลับมาแก้ได้ ─── */}
      {hasExpense && canSeeExpense && (
        <Card className="mb-4 p-4 sm:p-5" data-testid="expense-recorded">
          {closerDraft && (closerDraft.price || closerDraft.name) && (
            <p className="mb-2 rounded-(--radius) bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="draft-left">
              ช่างแจ้งไว้ตอนปิดงาน: {closerDraft.name || "-"}{closerDraft.price ? ` ฿${Number(closerDraft.price).toLocaleString()}` : ""} · ตรวจว่ารวมในรายการด้านล่างแล้วหรือยัง ถ้าเป็นคนละยอดกด เพิ่มรายการ
            </p>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-emerald-800">✅ บันทึกค่าใช้จ่ายแล้ว ฿{expenseTotal.toLocaleString()}</h2>
            {canExpense && wo.status === "completed" && (
              <Link href={recordExpenseHref} className="text-sm text-[#0F766E] hover:underline">
                + เพิ่มรายการ
              </Link>
            )}
          </div>
          <div className="flex flex-col divide-y divide-(--line)">
            {expenseBatches.map(({ first: e, houses }) => {
              const req = expenseRequestLinks.get(e.id);
              const read = e.receiptAi as ReceiptData | null;
              return (
              <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-(--ink)">
                    {e.isNoExpense ? "ไม่มีค่าใช้จ่าย" : `฿${Number(e.amount).toLocaleString()}`}
                    {houses > 1 ? <span className="font-normal text-(--ink-soft)"> × ลงให้ {houses} บ้าน</span> : null}
                    {e.description ? <span className="font-normal"> · {e.description}</span> : null}
                  </p>
                  {read?.amount != null && read.amount !== Number(e.amount) && (
                    <p className="text-xs text-amber-700">ระบบอ่านใบเสร็จได้ ฿{read.amount.toLocaleString()} · คนแก้เป็น ฿{Number(e.amount).toLocaleString()}</p>
                  )}
                  <p className="text-xs text-(--ink-soft)">
                    {[
                      e.payee ? `จ่ายให้ ${e.payee}` : null,
                      e.payer ? `โดย ${e.payer}` : null,
                      paymentMethodLabel(e.paymentMethod),
                      e.paidAt ? fmtThaiDateTime(e.paidAt) : null,
                      e.receiptNo ? `เลขที่ ${e.receiptNo}` : null,
                      e.noReceipt ? "ไม่มีใบเสร็จ" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-(--ink-soft)">
                    บันทึกโดย {e.createdBy ? (expenseRecorderNames[e.createdBy] ?? "ผู้ใช้") : "-"} · {fmtThaiDateTime(e.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  {e.receiptUrl && (
                    <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="text-[#0F766E] hover:underline">
                      ดูใบเสร็จ
                    </a>
                  )}
                  {/* มาจาก PR/PO หรือใบเบิก แก้ที่ต้นทาง — แก้ที่นี่ยอดจะไม่ตรงต้นทาง */}
                  {e.purchaseOrderId ? (
                    <Link href={`/maintenance/purchase-orders/${e.purchaseOrderId}`} className="text-[#0F766E] hover:underline">
                      มาจาก PR/PO
                    </Link>
                  ) : req ? (
                    <Link href={`/requests/${req.id}`} className="text-[#0F766E] hover:underline">
                      มาจากใบเบิก {req.code}
                    </Link>
                  ) : expenseHasSource(e) ? (
                    <span className="text-(--ink-soft)">มาจากใบเบิก</span>
                  ) : (
                    canExpense && (
                      <Link href={`/maintenance/expenses/${e.id}/edit`} className="font-medium text-[#0F766E] hover:underline">
                        แก้ไข
                      </Link>
                    )
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ─── ลิงก์ส่งรูปสำหรับช่างภายนอก ─── */}
      {!isTechnicianOnly && isOpenOrRunning && (
        <div className="mb-4">
          <ExternalUploadCard
            id={id}
            action={generateUploadLinkAction}
            currentUrl={uploadUrl}
          />
        </div>
      )}

      {/* ─── ภาพก่อนแก้ไข ─── */}
      {wo.photoUrls.length > 0 && (
        <SectionCard
          className="mb-4"
          icon={<Images className="h-4 w-4 text-[#607D8B]" />}
          title={`ภาพก่อนแก้ไข (${wo.photoUrls.length})`}
        >
          <PhotoStrip urls={wo.photoUrls} />
        </SectionCard>
      )}

      {/* ─── รูปและข้อความจากช่างภายนอก ─── */}
      {(externalUrls.length > 0 || externalNotes.length > 0) && (
        <SectionCard
          className="mb-4"
          icon={<CloudUpload className="h-4 w-4" style={{ color: "#0D9488" }} />}
          title={`จากช่างภายนอก (${externalUrls.length} รูป${
            externalNotes.length > 0 ? ` · ${externalNotes.length} ข้อความ` : ""
          })`}
        >
          {externalUrls.length > 0 && <PhotoStrip urls={externalUrls} />}
          {externalNotes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {externalNotes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-(--radius) bg-(--bg-soft) p-2.5 text-sm whitespace-pre-wrap text-(--ink)"
                >
                  {n.note}
                  <span className="mt-1 block text-xs text-(--ink-soft)">
                    {fmtThaiDateTime(n.uploadedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* ─── ภาพหลังแก้ไข ─── */}
      {wo.afterPhotoUrls.length > 0 && (
        <SectionCard
          className="mb-4"
          icon={<CheckCircle2 className="h-4 w-4 text-[#16A34A]" />}
          titleColor="#15803D"
          title={`ภาพหลังแก้ไข (${wo.afterPhotoUrls.length})`}
        >
          <PhotoStrip urls={wo.afterPhotoUrls} />
        </SectionCard>
      )}

      {/* เปิดจากรีพอต — กดกลับไปดูข้อความต้นทาง */}
      {wo.sourceLink && (
        <Link
          href={wo.sourceLink}
          className="mb-4 flex items-center gap-2 rounded-(--radius) border border-[#d5dbe6] bg-[#eaeef5] px-3 py-2 text-xs text-(--brand-navy) hover:bg-[#dfe5ef]"
        >
          <CornerUpLeft className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">สร้างจาก {wo.sourceLabel}</span>
          <span className="shrink-0 font-semibold">ไปดูต้นทาง</span>
        </Link>
      )}

      {/* รายละเอียดอยู่ในหัวใบแล้ว (แบบหน้ารายละเอียดงาน) */}

      {/* ─── สั่งซื้ออุปกรณ์สำหรับงานนี้ ─── */}
      {/* บทบาทแก้ได้รายบริษัท จึงมีสิทธิ์เปิด PR แต่ไม่มีสิทธิ์ดูรายการ PR ได้จริง
          — แยกสองเงื่อนไขไว้ ไม่ผูกปุ่ม "เปิด PR/PO" ไว้กับสิทธิ์ดู */}
      {(canOpenPoHere || ((canSeePo || seeOwnPoStatus) && linkedPos.length > 0)) && (
        <SectionCard
          className="mb-4"
          icon={<ShoppingCart className="h-4 w-4 text-[#0F766E]" />}
          title={
            canSeePo || (seeOwnPoStatus && linkedPos.length > 0)
              ? `สั่งซื้ออุปกรณ์สำหรับงานนี้ (${linkedPos.length})`
              : "สั่งซื้ออุปกรณ์สำหรับงานนี้"
          }
        >
          {seeOwnPoStatus && linkedPos.length > 0 ? (
            <ul className="flex flex-col">
              {linkedPos.map((po, i) => {
                const m = poStatusMeta(po.status);
                const ret = openReturns.get(po.id);
                return (
                  <li
                    key={po.id}
                    className={`flex items-start gap-2 py-2.5${i < linkedPos.length - 1 ? " border-b border-(--line)" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] text-(--ink-soft)">{po.code}</p>
                      <p className="truncate text-sm font-medium text-(--ink)">{po.title}</p>
                      <p className="text-xs text-(--ink-soft)">
                        เปิดเมื่อ {fmtThaiDate(po.createdAt)}
                        {ret && <span className="ml-1 text-[#EA580C]">· ↩️ คืนของ: {returnStatusMeta(ret).label}</span>}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                      style={{ color: m.color, backgroundColor: `${m.color}1a`, border: `1px solid ${m.color}4d` }}
                    >
                      {m.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : !canSeePo ? (
            <p className="text-sm text-(--ink-soft)">
              เปิด PR/PO จากตรงนี้แล้วระบบจะผูกกลับมาที่ใบงานนี้ให้เอง
            </p>
          ) : linkedPos.length === 0 ? (
            <p className="text-sm text-(--ink-soft)">
              ยังไม่มีใบสั่งซื้อของงานนี้ — เปิด PR/PO จากตรงนี้แล้วระบบจะผูกกลับมาที่
              ใบงานนี้ให้เอง และค่าใช้จ่ายจะถูกบันทึกเข้างานนี้ตอนซื้อจริง
            </p>
          ) : (
            <ul className="flex flex-col">
              {linkedPos.map((po, i) => {
                const m = poStatusMeta(po.status);
                const count = poItemsFromJson(po.items).length;
                return (
                  <li
                    key={po.id}
                    className={
                      i < linkedPos.length - 1
                        ? "border-b border-(--line)"
                        : undefined
                    }
                  >
                    <Link
                      href={`/maintenance/purchase-orders/${po.id}?wo=${id}${fromTasks ? "&from=tasks" : ""}`}
                      className="-mx-2 flex items-start gap-2 rounded-(--radius) px-2 py-2.5 hover:bg-(--bg-soft)"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[11px] text-(--ink-soft)">
                          {po.code}
                        </p>
                        <p className="truncate text-sm font-medium text-(--ink)">
                          {po.title}
                        </p>
                        <p className="text-xs text-(--ink-soft)">
                          {count} รายการ
                          {Number(po.totalPrice) > 0
                            ? ` • ฿${Number(po.totalPrice).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : ""}
                          {" • "}
                          {fmtThaiDate(po.createdAt)}
                          {openReturns.get(po.id) && (
                            <span className="text-[#EA580C]"> · ↩️ คืนของ: {returnStatusMeta(openReturns.get(po.id)!).label}</span>
                          )}
                        </p>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                        style={{
                          color: m.color,
                          backgroundColor: `${m.color}1a`,
                          border: `1px solid ${m.color}4d`,
                        }}
                      >
                        {m.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* ปุ่มเต็มความกว้าง ใช้ภาษาเดียวกับปุ่มดำเนินการอื่นบนหน้านี้
              (h-11 พื้นทึบ) — ลิงก์ตัวเล็กบนหัวการ์ด คนมองไม่เห็นว่ากดได้ */}
          {canOpenPoHere && (
            <Link
              href={`/maintenance/purchase-orders/new?workOrderId=${id}${fromTasks ? "&from=tasks" : ""}`}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) text-sm font-medium text-white hover:brightness-95"
              style={{ backgroundColor: "#0F766E" }}
            >
              <ShoppingCart className="h-4 w-4" />
              {linkedPos.length > 0
                ? "เปิด PR / PO เพิ่มสำหรับงานนี้"
                : "เปิด PR / PO สำหรับงานนี้"}
            </Link>
          )}
        </SectionCard>
      )}


      </div>
      <aside className="min-w-0 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
      {/* ─── ความคิดเห็น ─── */}
      <SectionCard
        className="mb-4 lg:mb-0"
        icon={<MessageSquare className="h-4 w-4 text-[#607D8B]" />}
        title={`ความคิดเห็น (${comments.filter((c) => c.kind !== "log").length})`}
      >
        <div className="mb-3 flex flex-col">
          {comments.length === 0 ? (
            <p className="py-2 text-sm text-(--ink-soft)">
              ยังไม่มีความคิดเห็น
            </p>
          ) : (
            comments.map((c, i) => (
              <div
                key={c.id}
                className={
                  i < comments.length - 1
                    ? "border-b border-(--line) py-2"
                    : "py-2"
                }
              >
                <WorkOrderComment
                  commentId={c.id}
                  authorName={c.userId ? (names[c.userId] ?? "ผู้ใช้") : "ผู้ใช้"}
                  timeLabel={fmtThaiDateTime(c.createdAt)}
                  content={c.content}
                  imageUrls={commentImages(c)}
                  kind={c.kind}
                  canSeeRemoved={canManage}
                  // แก้ได้เฉพาะคำพูดของตัวเอง · ลบได้ทั้งของตัวเองและ (ถ้าคุม
                  // ใบงานได้) ของคนอื่น — กติกาเดียวกับที่ action บังคับฝั่งเซิร์ฟเวอร์
                  canEdit={c.userId === session.userId}
                  canDelete={c.userId === session.userId || canManage}
                  editAction={editCommentAction.bind(null, id)}
                  deleteAction={deleteCommentAction.bind(null, id)}
                />
              </div>
            ))
          )}
        </div>
        <div className="border-t border-(--line) pt-3">
          <CommentComposer action={addCommentAction.bind(null, id)} mentionPeople={(await workOrderMentionPeople(orgId, wo)).filter((p) => p.id !== session.userId)} />
        </div>
      </SectionCard>
      </aside>
      {/* ─── ปุ่มดำเนินการ ─── */}
      {/* จอเล็ก: ข้อมูล → ความคิดเห็น → ปุ่ม (ลำดับเดิม) · จอใหญ่: ปุ่มอยู่ใต้ข้อมูลฝั่งซ้าย */}
      <div className="flex min-w-0 flex-col gap-2 lg:col-start-1">
        {wo.status === "completed" && !hasExpense && canExpense && !expenseDue && !expenseHeld && (
          <Link
            href={`/maintenance/expenses/new?workOrderId=${id}${
              pmForExpense ? `&pmScheduleId=${pmForExpense}` : ""
            }${fromTasks ? "&from=tasks" : ""}`}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) bg-[#2E7D32] text-sm font-medium text-white hover:brightness-95"
          >
            <ReceiptText className="h-4 w-4" /> เพิ่มค่าใช้จ่าย
          </Link>
        )}

        {isOpenOrRunning && (
          <>
            {isSuperAdmin && (
              <ChangeStatusButton
                id={id}
                current={wo.status}
                action={updateStatusAction}
              />
            )}
            {canChangeStatus && wo.status === "open" && (
              <StartJobButton id={id} action={updateStatusAction} />
            )}
            {canChangeStatus && wo.status === "in_progress" && !canManage && waitingOnGroup.length === 0 && !checklistReady && (
              <p className="rounded-(--radius) border border-dashed border-(--line) px-3 py-2.5 text-center text-sm text-(--ink-soft)" data-testid="close-blocked">
                ติ๊กเช็กลิสต์ให้ครบก่อนถึงปิดงานได้ (เหลือ {remainingCount(checkItems)} ข้อ)
              </p>
            )}
            {canChangeStatus && wo.status === "in_progress" && (canManage || (waitingOnGroup.length === 0 && checklistReady)) && (
              <CompleteJobButton
                id={id}
                action={completeWorkOrderAction}
                externalPhotoCount={externalUrls.length}
                requiresExpense={wo.requiresExpense}
                quickExpense={expenseOn}
              />
            )}
          </>
        )}

        {(isSuperAdmin || (hasPermission(session, MAINT_PERMS.workorderDelete) && canDeleteWorkOrderWithPerm(wo))) && (
          <div className="mt-4 border-t border-(--line) pt-4">
            <DeleteButton
              id={id}
              action={deleteWorkOrderAction}
              title={wo.title}
              label="ลบใบงาน"
              message={`ต้องการลบใบงาน "${wo.title}" หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้`}
            />
          </div>
        )}
      </div>
      </div>
    </AppScaffold>
  );
}
