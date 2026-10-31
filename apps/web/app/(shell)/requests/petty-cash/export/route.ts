import { NextResponse } from "next/server";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { REQ_PERMS } from "@/modules/requests/permissions";
import { isPettyHolder, listPettyHolders } from "@/modules/requests/lib/holders";
import { pettyAccess } from "@/modules/requests/lib/page";
import { pettyMonth } from "@/modules/requests/lib/petty-report";
import { bangkokToday } from "@/modules/requests/lib/types";

const KIND_LABEL = { top_up: "รับเงินเติม", spend: "จ่ายเงิน", return: "รับเงินทอนคืน", adjust: "ปรับยอด (นับเงินจริง)" } as const;

/**
 * เงินสดย่อยของเดือนเป็น CSV (เปิดใน Excel ได้ภาษาไทยไม่เพี้ยน — มี BOM) — สรุปรายคนด้านบน แล้วทุกรายการ
 * เห็นเท่าหน้าเงินสดย่อย: HR/CEO/คนที่ติ๊ก "เห็นของทุกคน" ได้ทุกคน · คนถือเงินได้แค่ของตัวเอง
 */
export async function GET(req: Request) {
  const session = await requireOrg();
  if (!hasPermission(session, REQ_PERMS.access)) return new NextResponse("Forbidden", { status: 403 });
  const petty = pettyAccess(session);
  const seesAll = petty.view || petty.topUp || petty.adjust;
  const mine = await isPettyHolder(session.orgId, session.userId);
  if (!seesAll && !mine) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const m = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : bangkokToday().slice(0, 7);
  const holder = seesAll ? url.searchParams.get("holder") || undefined : session.userId;
  const holders = (await listPettyHolders(session.orgId)).filter((h) => seesAll || h.id === session.userId).map((h) => ({ userId: h.id, name: h.name }));
  const { rows, entries } = await pettyMonth(session.orgId, month, holders, holder);

  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const line = (cells: unknown[]) => cells.map(esc).join(",");
  const money = (n: number) => n.toFixed(2);
  const out: string[] = [
    line([`สรุปเงินสดย่อย ${month}`]),
    line(["คนถือเงิน", "ยกมา", "เติม", "จ่ายตามใบเบิก", "ซื้อของเอง", "คืน/ปรับ", "คงเหลือ"]),
    ...rows.filter((r) => !holder || r.userId === holder).map((r) => line([r.name, money(r.opening), money(r.topUp), money(r.paidRequests), money(r.selfSpend), money(r.other), money(r.closing)])),
    "",
    line(["วันเวลา", "คนถือเงิน", "รายการ", "หมวด", "เลขใบเบิก", "จ่ายให้", "รายละเอียด", "เงินเข้า", "เงินออก", "ผู้บันทึก", "หลักฐาน", "ยกเลิก"]),
    ...entries.map((e) =>
      line([
        new Date(e.at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
        e.holderName,
        KIND_LABEL[e.kind],
        e.category ?? "",
        e.requestCode ?? "",
        e.paidTo ?? "",
        e.note,
        e.delta > 0 ? money(e.delta) : "",
        e.delta < 0 ? money(-e.delta) : "",
        e.byName,
        e.attachments.map((a) => new URL(a.url, url.origin).toString()).join(" "),
        e.voided ? `ยกเลิกโดย ${e.voided.byName}: ${e.voided.reason}` : "",
      ]),
    ),
  ];
  return new NextResponse("﻿" + out.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="petty-cash-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
