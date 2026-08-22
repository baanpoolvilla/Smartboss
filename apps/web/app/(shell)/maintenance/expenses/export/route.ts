import { NextResponse, type NextRequest } from "next/server";
import { getSession, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listExpensesForMonth } from "@/modules/maintenance/data/expenses";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listWorkOrders } from "@/modules/maintenance/data/work-orders";
import { listActivePmSchedules } from "@/modules/maintenance/data/pm";
import {
  costTypeLabel,
  paidByLabel,
  categoryLabel,
  THAI_MONTHS,
} from "@/modules/maintenance/lib/expense";

export const runtime = "nodejs";

function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** CSV รายงานค่าใช้จ่ายรายเดือน — โครงเดียวกับ _exportReport ของ ChangYai */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.orgId || !hasPermission(session, MAINT_PERMS.expenseView)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const orgId = session.orgId;

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = Number(searchParams.get("year")) || now.getFullYear();
  const month = Number(searchParams.get("month")) || now.getMonth() + 1;
  const cat = searchParams.get("cat");

  const [expenses, properties, workOrders, pms] = await Promise.all([
    listExpensesForMonth(orgId, year, month),
    listProperties(orgId),
    listWorkOrders(orgId),
    listActivePmSchedules(orgId),
  ]);

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  const woTitles: Record<string, string> = Object.fromEntries(
    workOrders.map((w) => [w.id, w.title])
  );
  const pmTitles: Record<string, string> = Object.fromEntries(
    pms.map((p) => [p.id, p.title])
  );

  /*
   * cat = id ของหมวด (เดิมเป็น prefix ของชื่อบ้าน)
   *
   * ต้องกรองด้วยเกณฑ์เดียวกับหน้าค่าใช้จ่ายเป๊ะ ๆ ไม่งั้นตัวเลขในไฟล์ที่ export
   * ออกไปจะไม่ตรงกับที่เห็นบนจอ ซึ่งเป็นข้อมูลที่เอาไปทำบัญชีต่อ
   */
  const propCat: Record<string, string | null> = Object.fromEntries(
    properties.map((p) => [p.id, p.categoryId])
  );
  const filtered = cat
    ? expenses.filter((e) =>
        e.propertyId ? propCat[e.propertyId] === cat : false
      )
    : expenses;

  const propName = (pid: string) =>
    pid === "unknown" ? "ไม่ระบุบ้าน" : (propNames[pid] ?? "ไม่ทราบชื่อ");

  // จัดกลุ่มตามบ้าน (ลำดับตามที่พบครั้งแรก เหมือนของเดิม)
  const byProp = new Map<string, typeof filtered>();
  for (const e of filtered) {
    const pid = e.propertyId ?? "unknown";
    if (!byProp.has(pid)) byProp.set(pid, []);
    byProp.get(pid)!.push(e);
  }

  const monthLabel = `${THAI_MONTHS[month]} ${year}`;
  const lines: string[] = [];
  lines.push(`รายงานค่าใช้จ่ายรายเดือน - ${monthLabel}`);
  lines.push("");
  lines.push(
    "บ้าน,รายการ,ประเภท,ประเภทค่าใช้จ่าย,รับผิดชอบโดย,อ้างอิง,วันที่,จำนวนเงิน (บาท)"
  );

  let grand = 0;
  for (const [pid, items] of byProp) {
    for (const e of items) {
      const amount = Number(e.amount);
      grand += amount;
      const desc = e.isNoExpense
        ? "ไม่มีค่าใช้จ่าย"
        : (e.description ?? categoryLabel(e.category));
      const catLabel = e.isNoExpense
        ? "ไม่มีค่าใช้จ่าย"
        : categoryLabel(e.category);
      const ref = e.workOrderId
        ? (woTitles[e.workOrderId] ?? e.workOrderId)
        : e.pmScheduleId
          ? (pmTitles[e.pmScheduleId] ?? e.pmScheduleId)
          : "";
      const d = new Date(e.expenseDate);
      const date = `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
      lines.push(
        [
          csvCell(propName(pid)),
          csvCell(desc),
          csvCell(catLabel),
          csvCell(costTypeLabel(e.costType)),
          csvCell(paidByLabel(e.paidBy)),
          csvCell(ref),
          csvCell(date),
          amount.toFixed(2),
        ].join(",")
      );
    }
  }

  lines.push("");
  lines.push(
    [csvCell("รวมทั้งเดือน"), "", "", "", "", "", "", grand.toFixed(2)].join(",")
  );

  // สรุปตามบ้าน
  lines.push("");
  lines.push("สรุปตามบ้าน");
  lines.push("บ้าน,จำนวนรายการ,รวมเงิน (บาท)");
  for (const [pid, items] of byProp) {
    const total = items.reduce((s, e) => s + Number(e.amount), 0);
    lines.push(
      [csvCell(propName(pid)), String(items.length), total.toFixed(2)].join(",")
    );
  }

  // สรุปตามผู้รับผิดชอบ
  lines.push("");
  lines.push("สรุปตามผู้รับผิดชอบ");
  lines.push("รับผิดชอบโดย,จำนวนรายการ,รวมเงิน (บาท)");
  const byPaidBy = new Map<string, typeof filtered>();
  for (const e of filtered) {
    const k = paidByLabel(e.paidBy);
    if (!byPaidBy.has(k)) byPaidBy.set(k, []);
    byPaidBy.get(k)!.push(e);
  }
  for (const [k, items] of byPaidBy) {
    const total = items.reduce((s, e) => s + Number(e.amount), 0);
    lines.push([csvCell(k), String(items.length), total.toFixed(2)].join(","));
  }

  // BOM ให้ Excel อ่านภาษาไทยถูก
  const csv = "﻿" + lines.join("\r\n");
  const fileName = `รายงานค่าใช้จ่าย_${THAI_MONTHS[month]}_${year}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
