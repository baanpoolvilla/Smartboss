import Link from "next/link";
import { ClipboardList, Download, FileText, Printer } from "lucide-react";

import { companyKey, type PayCompany } from "../lib/companies";
import type { LineView } from "../lib/views";
import { fmtBaht } from "../lib/types";
import { card, hint, outline } from "./ui";

const sat = (v: number) => Math.round(v * 100);

/**
 * รอบเดียว แยกบริษัท (ผู้ใช้ 27/11/2569) — แถบเลือกดูทีละบริษัท + ยอดสรุป + ไฟล์ของบริษัทนั้น
 * ไฟล์โอน/ประกันสังคม/ภ.ง.ด.1 ใช้เลขภาษี เลขนายจ้าง และบัญชีของบริษัทนั้น (export?company=)
 * ทำ คำนวณ ส่ง อนุมัติ บันทึกจ่าย ครั้งเดียวทั้งรอบเหมือนเดิม
 */
export function CompanyBreakdown({
  runId,
  selected,
  companies,
  lines,
  filesReady,
  paid,
  taxEnabled,
}: {
  runId: string;
  selected: string | null;
  companies: PayCompany[];
  lines: LineView[];
  filesReady: boolean;
  paid: boolean;
  taxEnabled: boolean;
}) {
  const groups = companies
    .map((c) => ({ c, ls: lines.filter((l) => companyKey(l.companyId) === c.id) }))
    .filter((g) => g.ls.length > 0);
  const chip = (on: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${on ? "border-transparent bg-(--brand-navy,#1b2537) font-semibold text-white" : "border-(--line) bg-(--bg) text-(--ink) hover:bg-(--bg-soft)"}`;
  const sel = selected ? groups.find((g) => g.c.id === selected) : null;
  const sum = (ls: LineView[], f: (l: LineView) => number) => ls.reduce((s, l) => s + sat(f(l)), 0) / 100;
  const q = (type: string) => `/salary/runs/${runId}/export?type=${type}&company=${encodeURIComponent(sel!.c.id)}`;
  return (
    <section className={`${card} flex flex-col gap-3 p-4`} aria-label="แยกตามบริษัทที่ออกเงินเดือน">
      <nav className="flex flex-wrap gap-2" aria-label="เลือกบริษัท">
        <Link href={`/salary/runs/${runId}`} className={chip(!sel)} aria-current={!sel ? "page" : undefined} scroll={false}>
          ทุกบริษัท · {lines.length} คน
        </Link>
        {groups.map((g) => (
          <Link key={g.c.id} href={`/salary/runs/${runId}?co=${encodeURIComponent(g.c.id)}`} className={chip(sel?.c.id === g.c.id)} aria-current={sel?.c.id === g.c.id ? "page" : undefined} scroll={false}>
            {g.c.name} · {g.ls.length} คน
          </Link>
        ))}
      </nav>
      {!sel ? (
        <p className={hint}>เลือกบริษัทเพื่อดูยอดของบริษัทนั้น และดาวน์โหลดไฟล์โอน / ประกันสังคม / ภ.ง.ด.1 / สลิป แยกบริษัท</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              ["รวมเงินได้", sum(sel.ls, (l) => l.gross)],
              ["ประกันสังคม (ลูกจ้าง + บริษัท)", sum(sel.ls, (l) => l.ssoEmployee + l.ssoEmployer)],
              ...(taxEnabled ? [["ภาษีหัก ณ ที่จ่าย", sum(sel.ls, (l) => l.tax)] as const] : []),
              ["จ่ายสุทธิ", sum(sel.ls, (l) => l.net)],
            ].map(([k, v]) => (
              <div key={k as string} className="min-w-0 rounded-(--radius) border border-(--line) px-3 py-2">
                <div className="text-xs text-(--ink-soft)">{k}</div>
                <div className="font-bold tabular-nums text-(--ink)">{fmtBaht(v as number)}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-(--ink-soft)">ไฟล์ของ {sel.c.name}:</span>
            {filesReady ? (
              <>
                <a href={q("bank")} className={outline}><Download className="h-4 w-4" aria-hidden="true" /> ไฟล์โอน</a>
                <a href={q("sso")} className={outline}><Download className="h-4 w-4" aria-hidden="true" /> ประกันสังคม</a>
                {taxEnabled && <a href={q("pnd1")} className={outline}><Download className="h-4 w-4" aria-hidden="true" /> ภ.ง.ด.1</a>}
                <a href={q("summary")} className={outline}><FileText className="h-4 w-4" aria-hidden="true" /> Excel สรุป</a>
              </>
            ) : (
              <span className="text-sm text-(--ink-soft)">ไฟล์โอน/ยื่นดาวน์โหลดได้หลังอนุมัติ ·</span>
            )}
            <a href={q("report")} className={outline}><ClipboardList className="h-4 w-4" aria-hidden="true" /> รายงานเงินเดือน</a>
            {paid && (
              <Link href={`/salary/slips/${runId}?company=${encodeURIComponent(sel.c.id)}`} className={outline} target="_blank">
                <Printer className="h-4 w-4" aria-hidden="true" /> สลิปทั้งหมด
              </Link>
            )}
          </div>
          {(!sel.c.taxId || !sel.c.ssoEmployerNo) && (
            <p className="text-xs text-amber-800">
              {sel.c.name} ยังไม่ได้ใส่{[!sel.c.taxId && "เลขผู้เสียภาษี", !sel.c.ssoEmployerNo && "เลขนายจ้างประกันสังคม"].filter(Boolean).join(" และ ")} — ใส่ที่ตั้งค่า › บริษัทที่ออกเงินเดือน
            </p>
          )}
        </>
      )}
    </section>
  );
}
