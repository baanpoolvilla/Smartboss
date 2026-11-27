import { NextResponse } from "next/server";
import { audit, requireOrg } from "@smartboss/auth";

import { salaryAccess } from "@/modules/salary/lib/access";
import { insertEvent, readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { actorOf } from "@/modules/salary/lib/page";
import { exactText, reportRow } from "@/modules/salary/lib/report";
import { loadPayCompanies, loadRun } from "@/modules/salary/lib/views";
import { companyKey } from "@/modules/salary/lib/companies";

import { ceoTitle } from "@/lib/ceo-title";
/**
 * ไฟล์ของรอบเงินเดือน (CSV เปิดใน Excel ได้ ภาษาไทยไม่เพี้ยน — มี BOM)
 *   bank    ไฟล์โอนกลาง: ชื่อบัญชี ธนาคาร เลขบัญชี ยอด (เฉพาะคนรับโอนที่มีเลขบัญชี) — ผู้ใช้เลือก "Excel กลางไปก่อน" 22/10/2569
 *   sso     สรุปประกันสังคม (ค่าจ้างที่ใช้คิด · ลูกจ้าง · บริษัท) — ยังไม่ใช่ไฟล์ยื่นออนไลน์ สปส.1-10
 *   pnd1    สรุปภาษีหัก ณ ที่จ่าย (เงินได้ · ภาษี) — ยังไม่ใช่ไฟล์ RD Prep
 *   summary ทุกคน ทุกรายการ ให้ฝ่ายบัญชี
 *   ?company=<id> (27/11/2569) เฉพาะคนที่ออกเงินเดือนในนามบริษัทนั้น + เลขภาษี/เลขนายจ้าง/บัญชีของบริษัทนั้น · ไม่ส่ง = ทั้งรอบเหมือนเดิม
 *   report  รายงานเงินเดือนตามสูตร HR (ฐาน · ค่าคอม Grade/Tier · เบี้ยขยัน · OT วัน · รายเพิ่ม/หัก · ประกันสังคม · สุทธิ) — โหลดได้ตั้งแต่ร่าง (ใช้ตรวจ)
 * ดาวน์โหลดได้เฉพาะ CEO + คนที่ CEO เลือก · บันทึกว่าใครดาวน์โหลดเมื่อไหร่ · ห้ามแคช
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ceo = await ceoTitle();
  const session = await requireOrg();
  if (!(await salaryAccess(session)).canEdit) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  const type = new URL(req.url).searchParams.get("type") ?? "summary";
  if (!["bank", "sso", "pnd1", "summary", "report"].includes(type)) return new NextResponse("Bad request", { status: 400 });
  const orgId = session.orgId;
  const run = await loadRun(orgId, id);
  if (!run) return new NextResponse("Not found", { status: 404 });
  // ไฟล์โอน/ยื่นใช้ตัวเลขที่ CEO อนุมัติแล้วเท่านั้น — ร่างยังเปลี่ยนได้ ห้ามเอาไปโอน
  if (type !== "report" && run.status !== "approved" && run.status !== "paid") {
    return new NextResponse(`รอบนี้ยังไม่ได้อนุมัติ — ดาวน์โหลดไฟล์ได้หลัง ${ceo} อนุมัติ`, { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const settings = await withSalaryTenant(orgId, (tx) => readSettings(tx, orgId));
  const companyParam = new URL(req.url).searchParams.get("company");
  const companies = companyParam ? await loadPayCompanies(orgId) : [];
  const company = companyParam ? companies.find((c) => c.id === companyParam) : undefined;
  if (companyParam && !company) return new NextResponse("Not found", { status: 404 });
  // ไม่เลือกบริษัท = ค่าเดิมจากตั้งค่า (บริษัทหลัก) ทุกตัว
  const co = company ?? { taxId: settings.companyTaxId, ssoEmployerNo: settings.ssoEmployerNo, branch: settings.ssoBranch, payBankName: settings.payBankName, payBankAccount: settings.payBankAccount };

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
  const lines = company ? run.lines.filter((l) => companyKey(l.companyId) === company.id) : run.lines;

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
    rows.push([], [`${company ? `${company.name} · ` : ""}บัญชีบริษัทที่ใช้จ่าย: ${co.payBankName} ${co.payBankAccount}`.trim()]);
  } else if (type === "sso") {
    head = ["ลำดับ", "รหัสพนักงาน", "ชื่อ", "ค่าจ้างที่ใช้คิด", "เงินสมทบลูกจ้าง", "เงินสมทบนายจ้าง", "รวม"];
    const insured = lines.filter((l) => l.ssoEmployee > 0 || l.ssoEmployer > 0);
    rows = insured.map((l, i) => [i + 1, l.employeeCode, l.name, n(l.info?.ssoWage ?? 0), n(l.ssoEmployee), n(l.ssoEmployer), n(l.ssoEmployee + l.ssoEmployer)]);
    const se = insured.reduce((s, l) => s + l.ssoEmployee, 0);
    const sr = insured.reduce((s, l) => s + l.ssoEmployer, 0);
    rows.push([], ["", "", "รวม", "", n(se), n(sr), n(se + sr)]);
    rows.push([], [`${company ? `${company.name} · ` : ""}เลขบัญชีนายจ้าง ${co.ssoEmployerNo || "(ยังไม่ได้ตั้ง)"} สาขา ${co.branch}`], ["หมายเหตุ: ไฟล์สรุป ไม่ใช่ไฟล์ยื่นออนไลน์ สปส.1-10 — กรอกในระบบ e-service ประกันสังคมจากไฟล์นี้"]);
  } else if (type === "pnd1") {
    head = ["ลำดับ", "รหัสพนักงาน", "ชื่อ", "เงินได้ที่จ่าย (คิดภาษี)", "ภาษีที่หัก"];
    const taxed = lines.filter((l) => l.taxable > 0);
    rows = taxed.map((l, i) => [i + 1, l.employeeCode, l.name, n(l.taxable), n(l.tax)]);
    rows.push([], ["", "", "รวม", n(taxed.reduce((s, l) => s + l.taxable, 0)), n(taxed.reduce((s, l) => s + l.tax, 0))]);
    rows.push([], [`${company ? `${company.name} · ` : ""}เลขผู้เสียภาษีบริษัท ${co.taxId || "(ยังไม่ได้ตั้ง)"}`], ["หมายเหตุ: ไฟล์สรุป ไม่ใช่ไฟล์ยื่น RD Prep — ใช้กรอก ภ.ง.ด.1 ของเดือนที่จ่าย"]);
  } else if (type === "report") {
    const rs = lines.map((l) => reportRow(l));
    head = [
      "ลำดับ", "รหัสพนักงาน", "ชื่อ", "แผนก", "ฐานเงินเดือน", "Grade", "คะแนน Grade", "คะแนน Tier", "ค่าคอม Grade (ไม่ปัด)", "ค่าคอม Tier (ไม่ปัด)", "ค่าคอมรวม (จ่ายจริง)",
      "เบี้ยขยัน", "ขั้นเบี้ยขยัน", "OT (วัน)", "อัตรา OT/วัน", "ยอด OT", "รายเพิ่ม", "รายละเอียดรายเพิ่ม", "รายหัก", "รายละเอียดรายหัก", "ประกันสังคม",
      ...(settings.taxEnabled ? ["ภาษี"] : []), "เงินสุทธิ",
    ];
    rows = rs.map((r, i) => [
      i + 1, r.employeeCode, r.name, r.department, n(r.base), r.grade ?? "", r.gradeScore ?? "", r.tier ?? "",
      r.commGradeExact !== null ? exactText(r.commGradeExact).replace(/,/g, "") : "", r.commTierExact !== null ? exactText(r.commTierExact).replace(/,/g, "") : "", n(r.commission),
      n(r.diligence), r.diligenceStep, r.otDays ?? "", r.otRate !== null ? n(r.otRate) : "", n(r.ot),
      n(r.addTotal), r.adds.map((x) => `${x.label} ${n(x.amount)} (${x.detail})`).join(" | "),
      n(r.deductTotal), r.deducts.map((x) => `${x.label} ${n(x.amount)} (${x.detail})`).join(" | "),
      n(r.sso), ...(settings.taxEnabled ? [n(r.tax)] : []), n(r.net),
    ]);
    const tot = (k: "base" | "commission" | "diligence" | "ot" | "addTotal" | "deductTotal" | "sso" | "tax" | "net") => n(rs.reduce((m, r) => m + Math.round(r[k] * 100), 0) / 100);
    rows.push([], ["", "", "รวม", "", tot("base"), "", "", "", "", "", tot("commission"), tot("diligence"), "", "", "", tot("ot"), tot("addTotal"), "", tot("deductTotal"), "", tot("sso"), ...(settings.taxEnabled ? [tot("tax")] : []), tot("net")]);
    rows.push([], [`สถานะรอบ: ${run.status === "draft" ? "ร่าง (ตัวเลขยังเปลี่ยนได้)" : run.status}`]);
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
    // เลือกบริษัท = รวมเฉพาะคนในบริษัทนั้น · ทั้งรอบ = ยอดรวมของรอบเหมือนเดิม
    const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((m, l) => m + Math.round(f(l) * 100), 0) / 100;
    const t = company
      ? { gross: sum((l) => l.gross), ssoEmployee: sum((l) => l.ssoEmployee), tax: sum((l) => l.tax), deductions: sum((l) => l.deductions), net: sum((l) => l.net), ssoEmployer: sum((l) => l.ssoEmployer) }
      : run.totals;
    rows.push([], ["", "", "รวม", "", "", "", "", "", n(t.gross), n(t.ssoEmployee), n(t.tax), "", n(t.deductions), n(t.net), n(t.ssoEmployer)]);
    if (company) rows.push([], [`บริษัท: ${company.name}${company.taxId ? ` · เลขผู้เสียภาษี ${company.taxId}` : ""}`]);
  }

  const actor = await actorOf(session.userId);
  await withSalaryTenant(orgId, (tx) => insertEvent(tx, orgId, { runId: id, byUserId: actor.userId, byName: actor.name, action: "export", summary: `ดาวน์โหลดไฟล์ ${type}${company ? ` (${company.name})` : ""}` }));
  // ลงประวัติกลางของบริษัทด้วย (หลังบ้าน › ประวัติการใช้งาน) — เดิมเห็นเฉพาะในประวัติของรอบเงินเดือน
  await audit({ userId: session.userId, action: "SALARY_EXPORTED", targetId: id, detail: { type, period: run.period, ...(company ? { company: company.id } : {}) } });
  const csv = "﻿" + [head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="salary-${run.period}-${type}${company ? `-${company.main ? "main" : company.id.slice(0, 8)}` : ""}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
