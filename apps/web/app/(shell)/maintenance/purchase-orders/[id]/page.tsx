import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  ClipboardList,
  Home as HomeIcon,
  UserCog,
  AlertTriangle,
  ShoppingBag,
  FileEdit,
  ClipboardCheck,
  Truck,
  Package,
  Info,
} from "lucide-react";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  getPurchaseOrder,
  listPoComments,
} from "@/modules/maintenance/data/purchase-orders";
import { getProperty } from "@/modules/maintenance/data/properties";
import { getWorkOrder } from "@/modules/maintenance/data/work-orders";
import { listOrgUsers, userNameMap } from "@/modules/maintenance/data/users";
import { poItemsFromJson, poStatusMeta } from "@/modules/maintenance/lib/po";
import { fmtThaiDate, fmtThaiDateTime } from "@/modules/maintenance/lib/format";
import { ROLE_LABEL_TH } from "@/modules/maintenance/lib/roles";
import { SectionCard } from "@/modules/maintenance/components/ui";
import { PhotoStrip } from "@/modules/maintenance/components/photos";
import { CommentDeleteButton } from "@/modules/maintenance/components/comment-delete-button";
import {
  CommentComposer,
  DeleteButton,
} from "@/modules/maintenance/components/work-order-detail-actions";
import {
  ApproveNormalButton,
  ApproveEmergencyButton,
  ConfirmOrderButton,
  ReceiveButton,
  SelfReceiveButton,
  RejectButton,
  ReturnLinkButton,
} from "@/modules/maintenance/components/po-actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import {
  approveNormalAction,
  approveEmergencyAction,
  confirmOrderAction,
  receiveAction,
  selfReceiveAction,
  rejectAction,
  addPoCommentAction,
  deletePoCommentAction,
  deletePoAction,
} from "../actions";

function TimelineRow({
  icon,
  color,
  label,
  who,
  when,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  who: string;
  when: Date;
}) {
  return (
    <div className="flex items-start gap-2 pb-2 text-sm">
      <span style={{ color }}>{icon}</span>
      <p className="min-w-0">
        <span style={{ color, fontWeight: 600 }}>{label}: </span>
        <span className="text-(--ink)">{who}</span>
        <span className="text-(--ink-soft)"> • {fmtThaiDate(when)}</span>
      </p>
    </div>
  );
}

export default async function PoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.poView)) redirect("/");
  const orgId = session.orgId;

  const po = await getPurchaseOrder(orgId, id);
  if (!po) notFound();

  // ใบงานต้นทาง — ดึงเฉพาะคนที่มีสิทธิ์ดูใบงาน คนที่ดูได้แค่ PR/PO ไม่ควรเห็น
  // หัวข้องานของใบงานที่ตัวเองเข้าไม่ถึงอยู่ดี
  const canSeeWo = hasPermission(session, MAINT_PERMS.workorderView);
  const [property, comments, users, sourceWo] = await Promise.all([
    po.propertyId ? getProperty(orgId, po.propertyId) : Promise.resolve(null),
    listPoComments(orgId, id),
    listOrgUsers(orgId),
    po.workOrderId && canSeeWo
      ? getWorkOrder(orgId, po.workOrderId)
      : Promise.resolve(null),
  ]);
  const names = await userNameMap(orgId, [
    po.createdBy,
    po.poAssignedTo,
    po.poCreatedBy,
    po.orderedBy,
    po.receivedBy,
    ...comments.map((c) => c.userId),
  ]);

  const isCeo = hasPermission(session, MAINT_PERMS.poApprove);
  const isAdmin = isSuperAdmin(session);
  const isAssignedUser =
    po.poAssignedTo === session.userId || po.createdBy === session.userId;

  const meta = poStatusMeta(po.status);
  const items = poItemsFromJson(po.items);
  const total = Number(po.totalPrice);
  const receiptUrls =
    po.receiptImageUrls.length > 0
      ? po.receiptImageUrls
      : po.receiptImageUrl
        ? [po.receiptImageUrl]
        : [];

  return (
    <AppScaffold
      title="รายละเอียด PR/PO"
      width="max-w-3xl"
      backHref="/maintenance/purchase-orders"
    >

      {/* ─── หัวการ์ด ─── */}
      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-2">
          <h1 className="flex-1 text-xl font-bold text-(--ink)">{po.title}</h1>
          <span
            className="rounded-full px-2.5 py-1 text-xs"
            style={{
              color: meta.color,
              backgroundColor: `${meta.color}1a`,
              border: `1px solid ${meta.color}4d`,
            }}
          >
            {meta.label}
          </span>
          {po.isEmergencyPurchase && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
              style={{ color: "#DC2626", backgroundColor: "#DC26261a", border: "1px solid #DC26264d" }}
            >
              <AlertTriangle className="h-3 w-3" /> ฉุกเฉิน
            </span>
          )}
          {po.isSelfPurchase && !po.isEmergencyPurchase && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
              style={{ color: "#16A34A", backgroundColor: "#16A34A1a", border: "1px solid #16A34A4d" }}
            >
              <ShoppingBag className="h-3 w-3" /> ซื้อเอง
            </span>
          )}
        </div>

        {po.isEmergencyPurchase && po.emergencyReason && (
          <div
            className="mt-2 flex items-start gap-1.5 rounded-[8px] p-2.5 text-xs"
            style={{ backgroundColor: "#FEF2F2", border: "1px solid #FEE2E2", color: "#B91C1C" }}
          >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            เหตุผลฉุกเฉิน: {po.emergencyReason}
          </div>
        )}

        {property && (
          <p className="mt-2 inline-flex items-center gap-1 text-sm text-(--ink-soft)">
            <HomeIcon className="h-3.5 w-3.5" /> {property.name}
          </p>
        )}
        {sourceWo && (
          <p className="mt-1.5">
            <Link
              href={`/maintenance/work-orders/${sourceWo.id}`}
              className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
              style={{ color: "#0F766E" }}
            >
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              จากใบงาน {sourceWo.code} · {sourceWo.title}
            </Link>
          </p>
        )}
        {po.poAssignedTo && (
          <p
            className="mt-1.5 inline-flex items-center gap-1 text-sm"
            style={{ color: "#1D4ED8" }}
          >
            <UserCog className="h-3.5 w-3.5" /> ผู้รับ PO:{" "}
            {names[po.poAssignedTo] ?? "-"}
          </p>
        )}
        {po.description && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-(--ink)">
            {po.description}
          </p>
        )}

        <div className="my-3 border-t border-(--line)" />

        {/* ─── Timeline: เปิด PR → สร้าง PO → ดำเนินการซื้อ → รับของ ─── */}
        <TimelineRow
          icon={<FileEdit className="h-4 w-4" />}
          color="#C2410C"
          label="เปิด PR"
          who={(po.createdBy && names[po.createdBy]) || "ไม่ทราบ"}
          when={po.createdAt}
        />
        {po.poCreatedAt && (
          <TimelineRow
            icon={<ClipboardCheck className="h-4 w-4" />}
            color="#1D4ED8"
            label="สร้าง PO"
            who={(po.poCreatedBy && names[po.poCreatedBy]) || "ไม่ทราบ"}
            when={po.poCreatedAt}
          />
        )}
        {po.orderedAt && (
          <TimelineRow
            icon={<Truck className="h-4 w-4" />}
            color="#4338CA"
            label="ดำเนินการซื้อ"
            who={(po.orderedBy && names[po.orderedBy]) || "ไม่ทราบ"}
            when={po.orderedAt}
          />
        )}
        {po.receivedAt && (
          <TimelineRow
            icon={<Package className="h-4 w-4" />}
            color="#15803D"
            label="รับของ"
            who={(po.receivedBy && names[po.receivedBy]) || "ไม่ทราบ"}
            when={po.receivedAt}
          />
        )}
      </Card>

      {/* ─── รายการอุปกรณ์ ─── */}
      {items.length > 0 && (
        <>
          <h2 className="mb-2 text-base font-bold text-(--ink)">
            รายการอุปกรณ์
          </h2>
          <Card className="mb-4 p-3">
            {total === 0 ? (
              <>
                <p className="text-xs text-(--ink-soft)">
                  รอกรอกราคาตอนรับของ
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {items.map((it, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 text-sm text-(--ink)"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-(--ink-soft)" />
                      {it.name}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--line) text-xs font-bold text-(--ink)">
                      <th className="py-1.5 text-left">ชื่อ</th>
                      <th className="py-1.5 text-center">จำนวน</th>
                      <th className="py-1.5 text-right">ราคา/หน่วย</th>
                      <th className="py-1.5 text-right">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} className="text-(--ink)">
                        <td className="py-1">{it.name}</td>
                        <td className="py-1 text-center">{it.qty}</td>
                        <td className="py-1 text-right">
                          ฿{it.unitPrice.toFixed(2)}
                        </td>
                        <td className="py-1 text-right">
                          ฿{(it.qty * it.unitPrice).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p
                  className="mt-2 border-t border-(--line) pt-2 text-right text-sm font-bold"
                  style={{ color: "#0D9488" }}
                >
                  รวม: ฿{total.toFixed(2)}
                </p>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ─── รูปประกอบ PR ─── */}
      {po.prImageUrls.length > 0 && (
        <SectionCard className="mb-4" title="รูปประกอบ PR">
          <PhotoStrip urls={po.prImageUrls} />
        </SectionCard>
      )}

      {/* ─── หมายเหตุ ─── */}
      {po.notes && (
        <SectionCard className="mb-4" title="หมายเหตุ">
          <p className="whitespace-pre-wrap text-sm text-(--ink)">{po.notes}</p>
        </SectionCard>
      )}

      {/* ─── รูปใบเสร็จ ─── */}
      {receiptUrls.length > 0 && (
        <SectionCard className="mb-4" title="รูปใบเสร็จ">
          <PhotoStrip urls={receiptUrls} />
        </SectionCard>
      )}

      {/* ─── ปุ่มดำเนินการตามสถานะ ─── */}
      <div className="mb-6 flex flex-col gap-2">
        {isCeo && po.status === "pending" && !po.isEmergencyPurchase && (
          <div className="flex gap-3">
            <ApproveNormalButton
              id={id}
              action={approveNormalAction}
              users={users.map((u) => ({
                id: u.id,
                label: u.name,
                sub: ROLE_LABEL_TH(u.roleCodes),
              }))}
            />
            <RejectButton id={id} action={rejectAction} />
          </div>
        )}

        {isCeo && po.status === "pending" && po.isEmergencyPurchase && (
          <div className="flex gap-3">
            <ApproveEmergencyButton
              id={id}
              total={total}
              reason={po.emergencyReason}
              action={approveEmergencyAction}
            />
            <RejectButton id={id} action={rejectAction} />
          </div>
        )}

        {po.status === "approved" &&
          !po.isSelfPurchase &&
          (isCeo || isAssignedUser) && (
            <ConfirmOrderButton id={id} items={items} action={confirmOrderAction} />
          )}

        {po.status === "ordered" &&
          !po.isSelfPurchase &&
          (isCeo || isAssignedUser) && (
            <ReceiveButton id={id} action={receiveAction} />
          )}

        {po.isSelfPurchase && po.status === "ordered" && (
          <SelfReceiveButton id={id} items={items} action={selfReceiveAction} />
        )}

        {(po.status === "ordered" || po.status === "received") &&
          (isCeo || isAssignedUser) && <ReturnLinkButton poId={id} />}
      </div>

      {/* ─── ความเห็น ─── */}
      <SectionCard title="ความเห็น" className="mb-4">
        <div className="mb-3 flex flex-col gap-3">
          {comments.length === 0 ? (
            <p className="text-[13px] text-(--ink-soft)">ยังไม่มีความเห็น</p>
          ) : (
            comments.map((c) => {
              const author = c.userId ? (names[c.userId] ?? "ไม่ทราบ") : "ไม่ทราบ";
              return (
                <div key={c.id} className="flex items-start gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                    style={{ backgroundColor: "#0D948826", color: "#0D9488" }}
                  >
                    {author.charAt(0).toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="text-sm font-bold text-(--ink)">
                        {author}
                      </span>
                      <span className="text-[11px] text-(--ink-soft)">
                        {fmtThaiDateTime(c.createdAt)}
                      </span>
                      {/* เจ้าของความเห็นลบของตัวเองได้ ผู้อนุมัติลบของใครก็ได้
                          — ฝั่ง action เช็คซ้ำเสมอ ไม่เชื่อการซ่อนปุ่มอย่างเดียว */}
                      {(c.userId === session.userId || isCeo) && (
                        <CommentDeleteButton
                          commentId={c.id}
                          action={deletePoCommentAction.bind(null, id)}
                          hasImages={c.imageUrls.length > 0}
                        />
                      )}
                    </p>
                    <div className="mt-1 rounded-[8px] bg-(--bg-soft) px-2.5 py-2">
                      {c.content !== "📷" && (
                        <p className="whitespace-pre-wrap text-sm text-(--ink)">
                          {c.content}
                        </p>
                      )}
                      {c.imageUrls.length > 0 && (
                        <div className="mt-1.5">
                          <PhotoStrip urls={c.imageUrls} size={160} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <CommentComposer action={addPoCommentAction.bind(null, id)} />
      </SectionCard>

      {isAdmin && (
        <DeleteButton
          id={id}
          action={deletePoAction}
          title={po.title}
          label="ลบ PR/PO"
          message={`ต้องการลบ "${po.title}" ใช่หรือไม่? ไม่สามารถกู้คืนได้`}
        />
      )}
    </AppScaffold>
  );
}
