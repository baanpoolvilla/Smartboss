import { redirect, notFound } from "next/navigation";
import { Package, AlertTriangle, User, CheckCircle2 } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  getEquipmentReturn,
  returnStatusMeta,
  RETURN_PROBLEM,
} from "@/modules/maintenance/data/equipment-returns";
import { userNameMap } from "@/modules/maintenance/data/users";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { SectionCard } from "@/modules/maintenance/components/ui";
import { PhotoStrip } from "@/modules/maintenance/components/photos";
import { DeleteButton } from "@/modules/maintenance/components/work-order-detail-actions";
import {
  ResolveReturnButton,
  ReturnStatusButton,
} from "@/modules/maintenance/components/po-actions";
import { setReturnStatusAction, deleteReturnAction } from "../../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

function Row({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1 text-sm">
      <span style={{ color: color ?? "var(--ink-soft)" }}>{icon}</span>
      <p className="min-w-0">
        <span style={{ color: color ?? "var(--ink-soft)", fontWeight: 600 }}>
          {label}:{" "}
        </span>
        <span className="text-(--ink)">{value}</span>
      </p>
    </div>
  );
}

export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.poView)) redirect("/");
  const orgId = session.orgId;

  const r = await getEquipmentReturn(orgId, id);
  if (!r) notFound();

  const names = await userNameMap(orgId, [r.createdBy, r.resolvedBy]);
  const meta = returnStatusMeta(r.status);

  // ผู้จัดการขึ้นไป หรือผู้แจ้งเอง จัดการได้ (เหมือน canManage เดิม)
  const isManagerUp = hasPermission(session, MAINT_PERMS.contractorManage);
  const canManage = isManagerUp || r.createdBy === session.userId;

  return (
    <AppScaffold
      title="คืนของ / ของมีปัญหา"
      width="max-w-2xl"
      backHref="/maintenance/purchase-orders"
    >

      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <h1 className="flex-1 text-xl font-bold text-(--ink)">
            {r.purchaseOrder?.title ?? "PO"}
          </h1>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-xs"
            style={{
              color: meta.color,
              backgroundColor: `${meta.color}1a`,
              border: `1px solid ${meta.color}4d`,
            }}
          >
            {meta.label}
          </span>
        </div>

        <div className="mt-3">
          <Row
            icon={<Package className="h-4 w-4" />}
            label="อุปกรณ์"
            value={`${r.itemName || "ทั้งรายการ"}  ×${r.qty}`}
          />
          <Row
            icon={<AlertTriangle className="h-4 w-4" />}
            label="ชนิดปัญหา"
            value={RETURN_PROBLEM[r.problemType] ?? r.problemType}
          />
          <Row
            icon={<User className="h-4 w-4" />}
            label="แจ้งโดย"
            value={`${(r.createdBy && names[r.createdBy]) || "ไม่ทราบ"}  •  ${fmtThaiDate(r.createdAt)}`}
          />
          {r.resolvedAt && (
            <Row
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="จบเรื่องโดย"
              value={`${(r.resolvedBy && names[r.resolvedBy]) || "ไม่ทราบ"}  •  ${fmtThaiDate(r.resolvedAt)}`}
              color="#15803D"
            />
          )}
        </div>
      </Card>

      <h2 className="mb-2 text-base font-bold text-(--ink)">
        รายละเอียดปัญหา
      </h2>
      <Card className="mb-4 p-3">
        <p className="whitespace-pre-wrap text-sm text-(--ink)">{r.reason}</p>
      </Card>

      {r.resolutionNote && (
        <>
          <h2 className="mb-2 text-base font-bold text-(--ink)">
            ผลการดำเนินการ
          </h2>
          <Card className="mb-4 bg-[#F0FDF4] p-3">
            <p className="whitespace-pre-wrap text-sm text-(--ink)">
              {r.resolutionNote}
            </p>
          </Card>
        </>
      )}

      {r.imageUrls.length > 0 && (
        <SectionCard className="mb-4" title="รูปประกอบ">
          <PhotoStrip urls={r.imageUrls} />
        </SectionCard>
      )}

      {canManage && (
        <div className="mb-6 flex flex-col gap-2">
          {r.status === "pending" && (
            <div className="flex gap-3">
              <ReturnStatusButton
                id={id}
                status="processing"
                label="รับเรื่อง"
                action={setReturnStatusAction}
              />
              <ReturnStatusButton
                id={id}
                status="cancelled"
                label="ยกเลิก"
                tone="danger"
                action={setReturnStatusAction}
              />
            </div>
          )}
          {r.status === "processing" && (
            <div className="flex gap-3">
              <ResolveReturnButton id={id} action={setReturnStatusAction} />
              <ReturnStatusButton
                id={id}
                status="cancelled"
                label="ยกเลิก"
                tone="danger"
                action={setReturnStatusAction}
              />
            </div>
          )}
        </div>
      )}

      {isManagerUp && (
        <DeleteButton
          id={id}
          action={deleteReturnAction}
          title="รายการแจ้งคืน"
          label="ลบรายการแจ้งคืน"
          message="ต้องการลบรายการนี้ใช่หรือไม่? ไม่สามารถกู้คืนได้"
        />
      )}
    </AppScaffold>
  );
}
