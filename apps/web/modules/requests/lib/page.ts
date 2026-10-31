import "server-only";
import { redirect } from "next/navigation";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { REQ_PERMS } from "../permissions";
import type { Viewer } from "./data";
import type { RequestView } from "./db";
import { statusInfo } from "./types";

/** เปิดหน้าของโมดูล — ไม่มีสิทธิ์ (หรือเป็นคนงาน) กลับหน้าแรก */
export async function requestsPage(extra?: string) {
  const session = await requireOrg();
  if (!hasPermission(session, REQ_PERMS.access)) redirect("/");
  if (extra && !hasPermission(session, extra)) redirect("/requests");
  const viewer: Viewer = {
    userId: session.userId,
    canApprove: hasPermission(session, REQ_PERMS.approve),
    canApproveCeo: hasPermission(session, REQ_PERMS.approveCeo),
    canPay: hasPermission(session, REQ_PERMS.pay),
    isPettyHolder: hasPermission(session, REQ_PERMS.pettyCash),
    canViewAll: hasPermission(session, REQ_PERMS.viewAll),
    canFileOthers: hasPermission(session, REQ_PERMS.fileOthers),
  };
  return { session, viewer };
}

/** สิทธิ์เงินสดย่อยรายข้อ — ไม่อยู่ใน Viewer เพราะไม่เกี่ยวกับการเห็นใบเบิก */
export function pettyAccess(session: Parameters<typeof hasPermission>[0]) {
  return {
    view: hasPermission(session, REQ_PERMS.pettyView),
    topUp: hasPermission(session, REQ_PERMS.pettyTopup),
    adjust: hasPermission(session, REQ_PERMS.pettyAdjust),
  };
}

export const statusOf = (r: RequestView) =>
  statusInfo({
    kind: r.kind,
    status: r.status,
    approverLevel: r.approverLevel,
    needCeo: r.needCeo,
    firstDecidedAt: r.firstDecidedAt,
    beneficiaryKind: r.beneficiaryKind,
    paidTotal: r.paidTotal,
    netAmount: r.netAmount,
    clearStatus: r.clearStatus,
    deductAmount: r.deductAmount,
    deductedAt: r.deductedAt,
  });

export const beneficiaryLabel = (r: Pick<RequestView, "beneficiaryKind">) =>
  r.beneficiaryKind === "worker" ? "คนงาน" : r.beneficiaryKind === "vendor" ? "ภายนอก" : "พนักงาน";

/** ใบนี้ยังมีอะไรต้องทำต่อไหม */
export function isOpen(r: RequestView): boolean {
  if (r.status === "pending" || r.status === "approved") return true;
  if (r.status === "paid" && r.kind === "cash_advance" && r.clearStatus !== "cleared") return true;
  if (r.status === "paid" && r.deductAmount > 0 && !r.deductedAt && r.beneficiaryKind === "staff") return true;
  return false;
}
