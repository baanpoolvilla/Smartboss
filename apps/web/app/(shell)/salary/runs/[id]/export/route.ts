import { NextResponse } from "next/server";
import { requireOrg } from "@smartboss/auth";

import { salaryAccess } from "@/modules/salary/lib/access";
import { insertEvent, readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { actorOf } from "@/modules/salary/lib/page";
import { loadRun } from "@/modules/salary/lib/views";

/**
 * ไฟล์ของรอบเงินเดือน (CSV เปิดใน Excel ได้ ภาษาไทยไม่เพี้ยน — มี BOM)
 *   bank    ไฟล์โอนกลาง: ชื่อบัญชี ธนาคาร เลขบัญชี ยอด (เฉพาะคนรับโอนที่มีเลขบัญชี) — ผู้ใช้เลือก "Excel กลางไปก่อน" 22/10/2569
 *   sso     สรุปประกันสังคม (ค่าจ้างที่ใช้คิด · ลูกจ้าง · บริษัท) — ยังไม่ใช่ไฟล์ยื่นออนไลน์ สปส.1-10
 *   pnd1    สรุปภาษีหัก ณ ที่จ่าย (เงินได้ · ภาษี) — ยังไม่ใช่ไฟล์ RD Prep
 *   summary ทุกคน ทุกรายการ ให้ฝ่ายบัญชี
 * ดาวน์โหลดได้เฉพาะ CEO + คนที่ CEO เลือก · บันทึกว่าใครดาวน์โหลดเมื่อไหร่ · ห้ามแคช
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  if (!(await salaryAccess(session)).canEdit) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  const type = new URL(req.url).searchParams.get("type") ?? "summary";
  if (!["bank", "sso", "pnd1", "summary"].includes(type)) return new NextResponse("Bad request", { status: 400 });
  const orgId = session.orgId;
  const run = await loadRun(orgId, id);
  if (!run) return new NextResponse("Not found", { status: 404 });
  // ไฟล์โอน/ยื่นใช้ตัวเลขที่ CEO อนุมัติแล้วเท่านั้น — ร่างยังเปลี่ยนได้ ห้ามเอาไปโอน
  if (run.status !== "approved" && run.status !== "paid") {
    return new NextResponse("รอบนี้ยังไม่ได้อนุมัติ — ดาวน์โหลดไฟล์ได้หลัง CEO อนุมัติ", { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const settings = await withSalaryTenant(orgId, (tx) => readSettings(tx, orgId));

  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // กันสูตร Excel แฝง (=, +, -, @ ขึ้นต้น) จากชื่อ/หมายเหตุที่คนพิมพ์
    // ยกเว้น ="0123…" ที่เราใส่เองให้เลขบัญชีไม่เสีย 0 นำหน้าใน Excel
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) && !/^="\d+"$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const n = (v: number) => v.toFixed(2);
  let head: string[] = [];
  let rows: unknown[][] = [];
  const lines = run.lines;

  if (type === "bank") {
    head = ["ลำดับ", "ชื่อบัญชี", "ธนาคาร", "เลขที่บัญชี", "จำนวนเงิน", "ชื่อพนักงาน", "รหัสพนักงาน"];
    const ok = lines.filter((l) => l.payChannel === "transfer" && l.bankAccount && l.net > 0);
    rows = ok.map((l, i) => [i + 1, l.accountName || l.name, l.bankName, `="${l.bankAccount}"`, n(l.net), l.name, l.employeeCode]);
    rows.push([], ["", "", "", "รวมโอน", n(ok.reduce((s, l) => s + l.net, 0))]);
    const left = lines.filter((l) => !ok.includes(l));
    if (left.length) {
      rows.push([], ["ไม่อยู่ในไฟล์โอน (จ่ายเงินสด / ไม่มีเลขบัญชี / ยอด 0)"]);
      for (const l of left) rows.push(["", l.name, l.payChannel === "cash" ? "เงินสด" : "ไม่มีเลขบัญชี", "", n(l.net)]);
    }
    rows.push([], [`บัญชีบริษัทที่ใช้จ่าย: ${settings.payBankName} ${settings.payBankAccount}`.trim()]);
  } else if (type === "sso") {
    head = ["ลำดับ", "รหัสพนักงาน", "ชื่อ", "ค่าจ้างที่ใช้คิด", "เงินสมทบลูกจ้าง", "เงินสมทบนายจ้าง", "รวม"];
    const insured = lines.filter((l) => l.ssoEmployee > 0 || l.ssoEmployer > 0);
    rows = insured.map((l, i) => [i + 1, l.employeeCode, l.name, n(l.info?.ssoWage ?? 0), n(l.ssoEmployee), n(l.ssoEmployer), n(l.ssoEmployee + l.ssoEmployer)]);
    const se = insured.reduce((s, l) => s + l.ssoEmployee, 0);
    const sr = insured.reduce((s, l) => s + l.ssoEmployer, 0);
    rows.push([], ["", "", "รวม", "", n(se), n(sr), n(se + sr)]);
    rows.push([], [`เลขบัญชีนายจ้าง ${settings.ssoEmployerNo || "(ยังไม่ได้ตั้ง)"} สาขา ${settings.ssoBranch}`], ["หมายเหตุ: ไฟล์สรุป ไม่ใช่ไฟล์ยื่นออนไลน์ สปส.1-10 — กรอกในระบบ e-service ประกันสังคมจากไฟล์นี้"]);
  } else if (type === "pnd1") {
    head = ["ลำดับ", "รหัสพนักงาน", "ชื่อ", "เงินได้ที่จ่าย (คิดภาษี)", "ภาษีที่หัก"];
    const taxed = lines.filter((l) => l.taxable > 0);
    rows = taxed.map((l, i) => [i + 1, l.employeeCode, l.name, n(l.taxable), n(l.tax)]);
    rows.push([], ["", "", "รวม", n(taxed.reduce((s, l) => s + l.taxable, 0)), n(taxed.reduce((s, l) => s + l.tax, 0))]);
    rows.push([], [`เลขผู้เสียภาษีบริษัท ${settings.companyTaxId || "(ยังไม่ได้ตั้ง)"}`], ["หมายเหตุ: ไฟล์สรุป ไม่ใช่ไฟล์ยื่น RD Prep — ใช้กรอก ภ.ง.ด.1 ของเดือนที่จ่าย"]);
  } else {
    head = ["ลำดับ", "รหัสพนักงาน", "ชื่อ", "แผนก", "ช่องทาง", "เงินเดือน", "OT", "เงินได้อื่น", "รวมเงินได้", "ประกันสังคม", "ภาษี", "หักอื่น", "รวมหัก", "สุทธิ", "บริษัทสมทบ ปกส.", "รายละเอียดเงินได้", "รายละเอียดหัก"];
    rows = lines.map((l, i) => {
      const sal = l.lines.find((x) => x.source === "salary")?.amount ?? 0;
      const ot = l.lines.filter((x) => x.source === "ot").reduce((s, x) => s + x.amount, 0);
      const other = l.gross - sal - ot;
      const dedOther = l.deductions - l.ssoEmployee - l.tax;
      return [
        i + 1, l.employeeCode, l.name, l.department, l.payChannel === "cash" ? "เงินสด" : `${l.bankName} ${l.bankAccount}`,
        n(sal), n(ot), n(other), n(l.gross), n(l.ssoEmployee), n(l.tax), n(dedOther), n(l.deductions), n(l.net), n(l.ssoEmployer),
        l.lines.filter((x) => x.kind === "earning").map((x) => `${x.label} ${n(x.amount)}`).join(" | "),
        l.lines.filter((x) => x.kind === "deduction" && x.amount > 0).map((x) => `${x.label} ${n(x.amount)}`).join(" | "),
      ];
    });
    const t = run.totals;
    rows.push([], ["", "", "รวม", "", "", "", "", "", n(t.gross), n(t.ssoEmployee), n(t.tax), "", n(t.deductions), n(t.net), n(t.ssoEmployer)]);
  }

  const actor = await actorOf(session.userId);
  await withSalaryTenant(orgId, (tx) => insertEvent(tx, orgId, { runId: id, byUserId: actor.userId, byName: actor.name, action: "export", summary: `ดาวน์โหลดไฟล์ ${type}` }));
  const csv = "﻿" + [head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="salary-${run.period}-${type}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
