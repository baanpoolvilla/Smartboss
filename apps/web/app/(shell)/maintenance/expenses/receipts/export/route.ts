import { NextResponse } from "next/server";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { loadMonthReceipts } from "@/modules/maintenance/data/expense-receipts";
import { paymentMethodLabel } from "@/modules/maintenance/lib/receipt-read";

/** ค่าที่ขึ้นต้นด้วย = + - @ ถูก Excel รันเป็นสูตรได้ — ชื่อร้าน/เลขที่มาจาก AI และคนกรอก */
function cell(v: unknown): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** ใบเสร็จรายเดือนเป็น CSV เปิดใน Excel ได้ พร้อมลิงก์รูป */
export async function GET(req: Request) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.expenseView)) return new NextResponse("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getFullYear();
  const month = Number(url.searchParams.get("month")) || now.getMonth() + 1;
  const house = url.searchParams.get("house") || null;
  const data = await loadMonthReceipts(session.orgId, year, month, house);
  const head = ["วันที่", "ยอด", "จำนวนบ้าน", "บ้าน", "รายการ", "ค่าอะไร", "จ่ายให้", "บุคคล/บริษัท", "VAT", "หัก ณ ที่จ่าย %", "หัก ณ ที่จ่าย", "ภ.ง.ด.", "โอนจริง", "ผู้จ่าย", "วิธีจ่าย", "เลขที่ใบเสร็จ", "ใบงาน", "ไม่มีใบเสร็จ", "ลิงก์รูป"];
  const KIND = { goods: "ค่าของ", service: "ค่าแรง/ค่าบริการ" } as Record<string, string>;
  const lines = data.items.map((i) =>
    [
      i.date.toISOString().slice(0, 10),
      i.amount,
      i.houses,
      i.houseNames.join(", "),
      i.description,
      i.costKind ? (KIND[i.costKind] ?? "") : "",
      i.payee,
      i.payeeKind === "company" ? "บริษัท" : i.payeeKind === "person" ? "บุคคล" : "",
      i.vat ? i.vat.toFixed(2) : "",
      i.wht ? i.whtPercent : "",
      i.wht ? i.wht.toFixed(2) : "",
      i.wht ? (i.payeeKind === "company" ? "ภ.ง.ด.53" : "ภ.ง.ด.3") : "",
      i.wht ? (i.amount - i.wht).toFixed(2) : "",
      i.payer,
      paymentMethodLabel(i.paymentMethod),
      i.receiptNo,
      i.workOrder?.code,
      i.noReceipt ? "ใช่" : "",
      i.receiptUrl ? `${url.origin}${i.receiptUrl}` : "",
    ]
      .map(cell)
      .join(","),
  );
  const foot = [
    ...(data.tax.vat ? [["VAT ซื้อ (ใบกำกับเต็มรูป)", data.tax.vat.toFixed(2)]] : []),
    ...(data.tax.wht3 ? [["หัก ณ ที่จ่ายนำส่ง ภ.ง.ด.3", data.tax.wht3.toFixed(2)]] : []),
    ...(data.tax.wht53 ? [["หัก ณ ที่จ่ายนำส่ง ภ.ง.ด.53", data.tax.wht53.toFixed(2)]] : []),
  ].map((r) => r.map(cell).join(","));
  return new NextResponse(`﻿${[head.map(cell).join(","), ...lines, ...(foot.length ? ["", ...foot] : [])].join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="receipts-${year}-${String(month).padStart(2, "0")}.csv"`,
    },
  });
}
