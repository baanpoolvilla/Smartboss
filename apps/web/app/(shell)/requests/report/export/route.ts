import { NextResponse } from "next/server";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { REQ_PERMS } from "@/modules/requests/permissions";
import { isPettyHolder } from "@/modules/requests/lib/holders";
import { monthRequests } from "@/modules/requests/lib/report";
import { beneficiaryLabel, statusOf } from "@/modules/requests/lib/page";
import { KIND_META, METHOD_LABEL, bangkokToday, costOf } from "@/modules/requests/lib/types";
import { maskRequest, payPrivacy } from "@/modules/requests/lib/pay-privacy";

/** ส่งออกทุกใบของเดือนเป็น CSV (เปิดใน Excel ได้ภาษาไทยไม่เพี้ยน — มี BOM) ให้ฝ่ายบัญชี */
export async function GET(req: Request) {
  const session = await requireOrg();
  if (!hasPermission(session, REQ_PERMS.viewAll)) return new NextResponse("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const m = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : bangkokToday().slice(0, 7);
  const viewer = {
    userId: session.userId,
    canApprove: hasPermission(session, REQ_PERMS.approve),
    canApproveCeo: hasPermission(session, REQ_PERMS.approveCeo),
    canPay: hasPermission(session, REQ_PERMS.pay),
    isPettyHolder: await isPettyHolder(session.orgId, session.userId),
    canViewAll: true,
    canFileOthers: hasPermission(session, REQ_PERMS.fileOthers),
  };
  // ยอด OT พนักงานประจำ: ไฟล์ของคนที่ไม่ใช่ CEO/ผู้ดูแลเงินเดือนไม่มีตัวเลข (lib/pay-privacy.ts)
  const privacy = await payPrivacy(session);
  const rows = (await monthRequests(session.orgId, viewer, month)).map((r) => maskRequest(privacy, r));
  const head = [
    "วันที่", "เลขที่", "ประเภท", "ของใคร", "ประเภทผู้รับ", "รายการ", "บ้าน", "ใบงาน", "เวลา OT", "ชั่วโมง OT",
    "ยอดก่อนภาษี", "VAT", "หัก ณ ที่จ่าย", "ยอดสุทธิ", "ค่าใช้จ่ายจริง", "จ่ายแล้ว", "วิธีจ่าย", "รอหักคืน", "สถานะ", "ผู้ยื่น", "ผู้อนุมัติ",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.workDate,
      r.code,
      KIND_META[r.kind].label,
      r.beneficiaryName,
      beneficiaryLabel(r),
      r.title,
      r.propertyName ?? "",
      r.workOrderCode ?? "",
      r.otStart ? `${r.otStart}-${r.otEnd}` : "",
      r.otMinutes ? (r.otMinutes / 60).toFixed(2) : "",
      r.payHidden ? "ซ่อนยอด" : r.amount.toFixed(2),
      r.vatAmount.toFixed(2),
      r.whtAmount.toFixed(2),
      r.payHidden ? "ซ่อนยอด" : r.netAmount.toFixed(2),
      r.payHidden ? "" : costOf(r).toFixed(2),
      r.payHidden ? "" : r.paidTotal.toFixed(2),
      [...new Set(r.payments.filter((p) => !p.voided).map((p) => METHOD_LABEL[p.method]))].join(" + "),
      r.deductAmount > 0 && !r.deductedAt ? r.deductAmount.toFixed(2) : "",
      statusOf(r).label,
      r.createdByName,
      r.decidedByName ?? "",
    ]
      .map(esc)
      .join(","),
  );
  const csv = "﻿" + [head.map(esc).join(","), ...lines].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="requests-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
