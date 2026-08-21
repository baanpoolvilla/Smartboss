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
  UserCircle2,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  getWorkOrder,
  listWorkOrderComments,
} from "@/modules/maintenance/data/work-orders";
import { listProperties } from "@/modules/maintenance/data/properties";
import { getAsset } from "@/modules/maintenance/data/assets";
import { userNameMap } from "@/modules/maintenance/data/users";
import { listExpenses } from "@/modules/maintenance/data/expenses";
import { listPurchaseOrdersForWorkOrder } from "@/modules/maintenance/data/purchase-orders";
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
import {
  updateStatusAction,
  completeWorkOrderAction,
  addCommentAction,
  deleteWorkOrderAction,
  generateUploadLinkAction,
} from "../actions";

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

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.workorderView)) redirect("/");
  const orgId = session.orgId;

  const wo = await getWorkOrder(orgId, id);
  if (!wo) notFound();

  // row-level: ช่างเห็นเฉพาะงานตัวเอง
  const canManage = hasPermission(session, MAINT_PERMS.workorderManage);
  const isOwnJob =
    wo.assignedTo === session.userId || wo.createdBy === session.userId;
  if (!canManage && !isOwnJob) redirect("/maintenance/work-orders");

  const canChangeStatus =
    canManage ||
    (hasPermission(session, MAINT_PERMS.workorderComplete) && isOwnJob);
  const canExpense = hasPermission(session, MAINT_PERMS.expenseManage);
  const canSeePo = hasPermission(session, MAINT_PERMS.poView);
  const canCreatePo = hasPermission(session, MAINT_PERMS.poCreate);
  // ใบงานที่ยกเลิกไปแล้วไม่ควรเปิดใบสั่งซื้อเพิ่ม
  const canOpenPoHere = canCreatePo && wo.status !== "cancelled";
  const isSuperAdmin = hasPermission(session, MAINT_PERMS.admin);
  const isTechnicianOnly = !canManage;

  const [properties, asset, comments, expenses, externalPhotos, linkedPos] =
    await Promise.all([
      listProperties(orgId),
      wo.assetId ? getAsset(orgId, wo.assetId) : Promise.resolve(null),
      listWorkOrderComments(orgId, id),
      listExpenses(orgId, { workOrderId: id }),
      listExternalPhotos(orgId, id),
      canSeePo
        ? listPurchaseOrdersForWorkOrder(orgId, id)
        : Promise.resolve([]),
    ]);

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  const names = await userNameMap(orgId, [
    wo.assignedTo,
    wo.createdBy,
    ...wo.ccUserIds,
    ...comments.map((c) => c.userId),
  ]);

  const uploadLink = canManage ? await getActiveUploadLink(orgId, id) : null;
  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const uploadUrl = uploadLink ? `${proto}://${host}/u/${uploadLink.token}` : null;

  const hasExpense = expenses.length > 0;
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
  // ช่างนอกส่งข้อความเปล่าได้ (ไม่มีรูป) แถวแบบนั้น storagePath เป็นค่าว่าง
  const externalUrls = externalPhotos
    .map((p) => p.storagePath)
    .filter((u) => u !== "");
  const externalNotes = externalPhotos.filter((p) => p.note);

  return (
    <AppScaffold
      title="รายละเอียดใบงาน"
      width="max-w-3xl"
      backHref="/maintenance/work-orders"
    >

      {/* ─── หัวข้อ + ข้อมูลใบงาน ─── */}
      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {/* เลขที่ใบงาน — ให้อ่านให้ช่างฟังทางโทรศัพท์ได้ ต่างจาก id ที่เป็น uuid */}
            <p className="font-mono text-xs text-(--ink-soft)">{wo.code}</p>
            <h1 className="text-xl font-bold text-(--ink)">{wo.title}</h1>
          </div>
          {/* งานอัตโนมัติไม่แสดงความเร่งด่วน — ดูเหตุผลใน components/work-order-board.tsx */}
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-bold"
            style={
              wo.autoCreated
                ? {
                    color: "#0D9488",
                    backgroundColor: "#0D94881a",
                    border: "1px solid #0D94884d",
                  }
                : {
                    color: pr.color,
                    backgroundColor: `${pr.color}1a`,
                    border: `1px solid ${pr.color}4d`,
                  }
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
        </div>

        <div className="my-4 border-t border-(--line)" />

        <InfoRow
          icon={<Info className="h-5 w-5" />}
          label="สถานะ"
          value={STATUS_LABEL[wo.status] ?? wo.status}
          valueColor={STATUS_COLOR[wo.status]}
        />
        <InfoRow
          icon={<HomeIcon className="h-5 w-5" />}
          label="บ้าน"
          value={[wo.propertyId, ...wo.additionalPropertyIds]
            .map((pid) => propNames[pid] ?? "")
            .filter(Boolean)
            .join(", ")}
        />
        {asset && (
          <InfoRow
            icon={<Info className="h-5 w-5" />}
            label="อุปกรณ์"
            value={asset.name}
          />
        )}
        {wo.createdBy && (
          <InfoRow
            icon={<UserPlus className="h-5 w-5" />}
            label="สร้างโดย"
            value={names[wo.createdBy] ?? "-"}
          />
        )}
        {wo.assignedTo && (
          <InfoRow
            icon={<HardHat className="h-5 w-5" />}
            label="รับผิดชอบโดย"
            value={names[wo.assignedTo] ?? "-"}
          />
        )}
        {wo.ccUserIds.length > 0 && (
          <InfoRow
            icon={<Users className="h-5 w-5" />}
            label="CC"
            value={wo.ccUserIds.map((u) => names[u] ?? "-").join(", ")}
          />
        )}
        {!wo.autoCreated && (
          <InfoRow
            icon={<Flag className="h-5 w-5" />}
            label="ความเร่งด่วน"
            value={pr.label}
            valueColor={pr.color}
          />
        )}
        <InfoRow
          icon={<CalendarDays className="h-5 w-5" />}
          label="สร้างเมื่อ"
          value={fmtThaiDateTime(wo.createdAt)}
        />
        {wo.dueDate && (
          <InfoRow
            icon={<CalendarClock className="h-5 w-5" />}
            label="กำหนดส่ง"
            value={fmtThaiDate(wo.dueDate)}
            valueColor={overdue ? "#DC2626" : undefined}
          />
        )}
        {wo.completedAt && (
          <InfoRow
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="เสร็จเมื่อ"
            value={fmtThaiDate(wo.completedAt)}
            valueColor="#16A34A"
          />
        )}
        {wo.completionNotes && (
          <InfoRow
            icon={<StickyNote className="h-5 w-5" />}
            label="รายละเอียดจบงาน"
            value={
              <span className="whitespace-pre-wrap">{wo.completionNotes}</span>
            }
          />
        )}
        {wo.autoCreated && (
          <InfoRow
            icon={<Info className="h-5 w-5" />}
            label="ที่มา"
            value="สร้างอัตโนมัติจาก PM"
            valueColor="#0D9488"
          />
        )}
        {!wo.requiresExpense && (
          <InfoRow
            icon={<Info className="h-5 w-5" />}
            label="ค่าใช้จ่าย"
            value="งานนี้ไม่มีค่าใช้จ่าย — ปิดงานได้โดยไม่ต้องกรอก"
            valueColor="#0D9488"
          />
        )}
      </Card>

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

      {/* ─── รายละเอียด ─── */}
      {wo.description && (
        <SectionCard className="mb-4" title="รายละเอียด">
          <p className="whitespace-pre-wrap text-sm text-(--ink)">
            {wo.description}
          </p>
        </SectionCard>
      )}

      {/* ─── สั่งซื้ออุปกรณ์สำหรับงานนี้ ─── */}
      {/* บทบาทแก้ได้รายบริษัท จึงมีสิทธิ์เปิด PR แต่ไม่มีสิทธิ์ดูรายการ PR ได้จริง
          — แยกสองเงื่อนไขไว้ ไม่ผูกปุ่ม "เปิด PR/PO" ไว้กับสิทธิ์ดู */}
      {(canOpenPoHere || (canSeePo && linkedPos.length > 0)) && (
        <SectionCard
          className="mb-4"
          icon={<ShoppingCart className="h-4 w-4 text-[#0F766E]" />}
          title={
            canSeePo
              ? `สั่งซื้ออุปกรณ์สำหรับงานนี้ (${linkedPos.length})`
              : "สั่งซื้ออุปกรณ์สำหรับงานนี้"
          }
          action={
            canOpenPoHere ? (
              <Link
                href={`/maintenance/purchase-orders/new?workOrderId=${id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-[#0F766E] hover:underline"
              >
                <ShoppingCart className="h-3.5 w-3.5" /> เปิด PR / PO
              </Link>
            ) : null
          }
        >
          {!canSeePo ? (
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
                      href={`/maintenance/purchase-orders/${po.id}`}
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
        </SectionCard>
      )}

      {/* ─── ความคิดเห็น ─── */}
      <SectionCard
        className="mb-4"
        icon={<MessageSquare className="h-4 w-4 text-[#607D8B]" />}
        title={`ความคิดเห็น (${comments.length})`}
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
                <div className="flex items-center gap-1.5">
                  <UserCircle2 className="h-4 w-4 text-(--ink-soft)" />
                  <span className="text-[13px] font-bold text-(--ink)">
                    {c.userId ? (names[c.userId] ?? "ผู้ใช้") : "ผู้ใช้"}
                  </span>
                  <span className="text-[11px] text-(--ink-soft)">
                    {fmtThaiDateTime(c.createdAt)}
                  </span>
                </div>
                <div className="mt-1 pl-[22px]">
                  {c.content !== "📷" && (
                    <p className="whitespace-pre-wrap text-sm text-(--ink)">
                      {c.content}
                    </p>
                  )}
                  {c.imageUrl && (
                    <div className="mt-1.5">
                      <PhotoStrip urls={[c.imageUrl]} size={160} />
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-(--line) pt-3">
          <CommentComposer action={addCommentAction.bind(null, id)} />
        </div>
      </SectionCard>

      {/* ─── ปุ่มดำเนินการ ─── */}
      <div className="flex flex-col gap-2">
        {wo.status === "completed" && !hasExpense && canExpense && (
          <Link
            href={`/maintenance/expenses/new?workOrderId=${id}${
              pmForExpense ? `&pmScheduleId=${pmForExpense}` : ""
            }`}
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
            {canChangeStatus && wo.status === "in_progress" && (
              <CompleteJobButton
                id={id}
                action={completeWorkOrderAction}
                externalPhotoCount={externalUrls.length}
                requiresExpense={wo.requiresExpense}
              />
            )}
          </>
        )}

        {isSuperAdmin && (
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
    </AppScaffold>
  );
}
