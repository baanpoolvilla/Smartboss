import "server-only";
import type { OrgSession } from "@smartboss/auth";
import { salaryAccess } from "@/modules/salary/lib/access";
import { readSettings as readSalarySettings, withSalaryTenant } from "@/modules/salary/lib/db";
import type { RequestView } from "./db";

/**
 * แก้ยอดเงินในใบ OT พนักงานได้ไหม และทำไม — ผู้ใช้ 16/11/2569:
 * "คนอนุมัติส่งเป็นชั่วโมงพอ ให้ HR/คนทำเงินเดือนไปจัดการเงิน" + "บอกให้ชัดว่าอันไหนแก้ได้ไม่ได้"
 *
 * แก้ได้ = คนดูแลเงินเดือน (salaryAccess.canEdit) · ใบ OT พนักงาน (ผูกชื่อแล้ว) · รออนุมัติ/อนุมัติแล้ว · ยังไม่จ่ายสักบาท ·
 * ไม่อยู่ในงวดเงินเดือนที่ส่งอนุมัติแล้ว · ไม่ใช่ใบของตัวเอง · บริษัทไม่ได้ตั้ง OT แบบนับเป็นวัน (แบบนั้นงวดไม่ใช้ยอดในใบ)
 * ทุกข้อที่ไม่ผ่านมีเหตุผลเป็นภาษาคนให้ขึ้นบนจอ
 */
export interface OtEditState {
  /** แสดงกล่องนี้ไหม (ใบไม่ใช่ OT พนักงาน / ยกเลิก / ไม่อนุมัติ = ไม่แสดง) */
  show: boolean;
  canEdit: boolean;
  /** เหตุผลที่แก้ไม่ได้ หรือข้อควรรู้ตอนแก้ได้ */
  reason: string;
  /** อยู่ในงวดร่าง → แก้แล้วต้องกดคำนวณงวดใหม่ */
  draftPeriod: string | null;
}

const HIDE: OtEditState = { show: false, canEdit: false, reason: "", draftPeriod: null };

export async function staffOtEditState(
  session: OrgSession,
  r: Pick<RequestView, "id" | "kind" | "status" | "beneficiaryKind" | "beneficiaryUserId" | "employmentId" | "paidTotal">,
): Promise<OtEditState> {
  if (r.kind !== "ot" || r.beneficiaryKind !== "staff" || !r.beneficiaryUserId) return HIDE;
  if (r.status === "rejected" || r.status === "cancelled") return HIDE;
  const access = await salaryAccess(session);
  if (!access.canEdit) return { show: true, canEdit: false, reason: "แก้ยอดได้เฉพาะคนดูแลเงินเดือน (CEO และคนที่ CEO เลือก)", draftPeriod: null };
  if (r.status === "paid" || r.paidTotal > 0) {
    return { show: true, canEdit: false, reason: "จ่ายแล้ว — แก้ยอดในใบไม่ได้ ถ้าต้องแก้ ให้ใส่ปรับเพิ่ม/ปรับลดในงวดเงินเดือนถัดไป", draftPeriod: null };
  }
  if (r.beneficiaryUserId === session.userId) return { show: true, canEdit: false, reason: "ใบ OT ของตัวเอง แก้ยอดเองไม่ได้ — ให้คนดูแลเงินเดือนคนอื่นแก้", draftPeriod: null };

  const orgId = session.orgId;
  const { otMode, runs } = await withSalaryTenant(orgId, async (tx) => {
    const s = await readSalarySettings(tx, orgId);
    const open = await tx.salaryRun.findMany({ where: { orgId, status: { in: ["draft", "submitted", "approved"] } }, select: { id: true, period: true, status: true } });
    const lines = r.employmentId && open.length
      ? await tx.salaryRunLine.findMany({ where: { orgId, employmentId: r.employmentId, runId: { in: open.map((x) => x.id) } }, select: { runId: true, info: true } })
      : [];
    const inRuns = lines
      .filter((l) => ((l.info as { refs?: { ot?: { id: string }[] } } | null)?.refs?.ot ?? []).some((o) => o.id === r.id))
      .map((l) => open.find((x) => x.id === l.runId)!)
      .filter(Boolean);
    return { otMode: s.otMode, runs: inRuns };
  });
  if (otMode === "days") {
    return { show: true, canEdit: false, reason: "บริษัทตั้งให้คิด OT เป็นวัน (เงินเดือน › ตั้งค่า) — งวดเงินเดือนไม่ใช้ยอดในใบนี้ ถ้าต้องปรับ ให้ใส่ปรับเพิ่ม/ปรับลดในงวด", draftPeriod: null };
  }
  const locked = runs.find((x) => x.status !== "draft");
  if (locked) {
    return { show: true, canEdit: false, reason: `อยู่ในงวดเงินเดือน ${locked.period} ที่ส่งอนุมัติแล้ว — ให้ผู้อนุมัติกด "ส่งกลับ" งวดก่อน แล้วค่อยแก้`, draftPeriod: null };
  }
  const draft = runs.find((x) => x.status === "draft");
  return {
    show: true,
    canEdit: true,
    reason: draft ? `อยู่ในงวด ${draft.period} (ร่าง) — แก้แล้วกด "คำนวณใหม่" ที่งวดนั้นด้วย` : "แก้ได้จนกว่าจะจ่าย · ระบบบันทึกว่าใครแก้ และยอดเดิมเท่าไหร่",
    draftPeriod: draft?.period ?? null,
  };
}
