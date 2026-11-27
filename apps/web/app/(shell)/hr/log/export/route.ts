import { NextResponse } from "next/server";
import { audit, requireOrg } from "@smartboss/auth";
import { filterChangeLog, loadChangeLog } from "@/modules/hr/lib/change-log";
import { CHANGE_CATEGORIES } from "@/modules/hr/lib/change-log-text";
import { canSeeHrLog, parseHrLogParams } from "@/modules/hr/lib/change-log-params";

/** Log การบันทึกระบบบุคคล → CSV (เปิดใน Excel ได้ภาษาไทยไม่เพี้ยน — ใส่ BOM) ตามตัวกรองเดียวกับหน้าจอ ไม่จำกัดจำนวน */
export async function GET(req: Request) {
  const session = await requireOrg();
  if (!canSeeHrLog(session)) return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const p = parseHrLogParams(sp);
  const { entries } = await loadChangeLog(session.orgId, { from: p.from, to: p.to, includeCheckins: p.includeCheckins });
  const rows = filterChangeLog(entries, { category: p.category, actor: p.actor, target: p.target, q: p.q });

  const cell = (v: string | null | undefined) => {
    const s = (v ?? "").replace(/\r?\n/g, " ");
    // กันสูตร Excel ที่ขึ้นต้นด้วย = + - @
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [
    ["วันเวลา", "คนที่ทำ", "หมวด", "ทำอะไร", "พนักงาน", "รหัส", "รายละเอียด (เดิม → ใหม่)", "เหตุผล", "จากเครื่อง"].map(cell).join(","),
    ...rows.map((e) =>
      [
        new Date(e.at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }),
        e.actor,
        CHANGE_CATEGORIES[e.category],
        e.text,
        e.target?.name ?? "",
        e.target?.code ?? "",
        e.details.map((d) => `${d.label}: ${d.before ?? "—"} → ${d.after ?? "—"}`).join(" | "),
        e.reason ?? "",
        e.device ?? "",
      ]
        .map(cell)
        .join(","),
    ),
  ];
  await audit({ userId: session.userId, action: "HR_LOG_EXPORTED", detail: { from: p.fromYmd, to: p.toYmd, rows: rows.length } });
  return new NextResponse(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hr-log-${p.fromYmd}-${p.toYmd}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
