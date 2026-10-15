import { requireOrg, hasPermission } from "@smartboss/auth";

import { DW_PERMS } from "@/modules/daily_worker/permissions";
import { bangkokToday, loadMonth, summarize } from "@/modules/daily_worker/lib/data";
import { minutesToHm } from "@/modules/daily_worker/lib/types";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { m: "มา", x: "ขาด", n: "ไม่มา", o: "หยุด", l: "ลา", r: "หยุดตามกะ", "": "" };

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

/** ดาวน์โหลดเป็นไฟล์ที่ Excel เปิดได้ (CSV + BOM) — สรุปรายคน แล้วตามด้วยรายวัน */
export async function GET(request: Request) {
  const session = await requireOrg();
  if (![DW_PERMS.view, DW_PERMS.manage, DW_PERMS.override].some((p) => hasPermission(session, p))) {
    return new Response("ไม่มีสิทธิ์", { status: 403 });
  }
  const raw = new URL(request.url).searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : bangkokToday().slice(0, 7);
  const data = await loadMonth(session.orgId, month);

  const rows: (string | number)[][] = [["สรุป", month], ["ชื่อ", "รหัส", "กะ", "มา", "ขาด", "กลับก่อน", "ไม่มา", "หยุด", "ลา", "OT (ชม.)"]];
  for (const w of data.workers) {
    const s = summarize(w);
    rows.push([w.name, w.employeeCode ?? "", w.shiftId ? `${minutesToHm(w.shiftStart)}-${minutesToHm(w.shiftEnd)}` : "ยังไม่ผูกกะ", s.present, s.absent, s.early, s.noShow, s.off, s.leave, +(s.otMinutes / 60).toFixed(2)]);
  }
  rows.push([], ["รายวัน"], ["ชื่อ", "วันที่", "สถานะ", "เข้า", "ออก", "กลับก่อน", "OT เริ่ม", "OT จบ", "OT (ชม.)", "หมายเหตุ"]);
  for (const w of data.workers) {
    for (let d = 1; d <= data.days; d++) {
      const c = w.cells[d];
      if (!c) continue;
      const note = [c.override ? `แก้เป็นมา: ${c.override.reason} (${c.override.byName})` : "", c.leave ? c.leave.name : "", c.ot?.note ?? ""].filter(Boolean).join(" · ");
      rows.push([w.name, `${month}-${String(d).padStart(2, "0")}`, STATUS[c.s] ?? "", c.inAt ?? "", c.outAt ?? "", c.early ? "ใช่" : "", c.ot?.start ?? "", c.ot?.end ?? "", c.ot ? +(c.ot.minutes / 60).toFixed(2) : "", note]);
    }
  }
  return new Response("﻿" + csv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="daily-workers-${month}.csv"`,
    },
  });
}
