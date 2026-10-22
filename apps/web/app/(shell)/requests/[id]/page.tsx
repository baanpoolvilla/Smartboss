import Link from "next/link";
import { canSeePay, hideBaht, maskRequest, payPrivacy, HIDDEN_PAY_LABEL } from "@/modules/requests/lib/pay-privacy";
import { notFound } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { loadScorePeriodConfig } from "@/lib/score-period-config";
import { scorePeriodOf } from "@/lib/score-period";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { canDecide, canSee } from "@/modules/requests/lib/data";
import { loadRequests, pettyBalances, readSettings, withRequestsTenant, type RequestView } from "@/modules/requests/lib/db";
import { beneficiaryLabel, requestsPage, statusOf } from "@/modules/requests/lib/page";
import {
  KIND_META,
  METHOD_LABEL,
  amountMismatch,
  bangkokToday,
  baht,
  contractorBreakdown,
  hoursText,
  receiptFlags,
  round2,
  thaiDate,
  thaiDateTime,
  timesOverlap,
  type Attachment,
  type PaymentMethod,
} from "@/modules/requests/lib/types";
import { KindChip, MoneyRow, Notice, StatusChip, Steps } from "@/modules/requests/components/ui";
import {
  CancelButton,
  ClearingConfirm,
  ClearingSubmit,
  ConfirmReceivedButton,
  DecidePanel,
  PayPanel,
  VoidPaymentButton,
  type PettyHolder,
} from "@/modules/requests/components/request-actions";

export const dynamic = "force-dynamic";

async function scansOn(orgId: string, employmentId: string, date: string) {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ in_hm: string | null; out_hm: string | null }[]>(
      `SELECT to_char(actual_in_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS in_hm,
              to_char(actual_out_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS out_hm
         FROM workforce.attendance_results
        WHERE employment_id = $1::uuid AND work_date = $2::date AND is_current
        LIMIT 1`,
      employmentId,
      date,
    ),
  ).catch(() => []);
  return rows[0] ?? null;
}

function Files({ files, title, flagsFor }: { files: Attachment[]; title: string; flagsFor?: (a: Attachment) => { level: "block" | "warn"; text: string }[] }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold text-(--ink)">{title}</div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {files.map((f, i) => {
          const flags = flagsFor?.(f) ?? [];
          return (
            <li key={f.sha256 + i} className="flex gap-3 rounded-(--radius) border border-(--line) p-2">
              <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0">
                {f.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.name} className="h-20 w-20 rounded-md object-cover" />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-md bg-(--bg-soft)">
                    <FileText className="h-7 w-7 text-(--ink-soft)" aria-hidden="true" />
                  </span>
                )}
              </a>
              <div className="min-w-0 text-xs">
                <a href={f.url} target="_blank" rel="noreferrer" className="block truncate font-medium text-(--ink) hover:underline">{f.name}</a>
                <div className="text-(--ink-soft)">{f.by} · {thaiDateTime(f.at)}</div>
                {f.ai && (f.ai.amount || f.ai.date) && (
                  <div className="mt-0.5 text-(--ink-soft)">ระบบอ่านได้: {[f.ai.amount ? baht(f.ai.amount) : null, f.ai.date ? thaiDate(f.ai.date) : null, f.ai.vendor, f.ai.receiptNo ? `เลขที่ ${f.ai.receiptNo}` : null].filter(Boolean).join(" · ")}</div>
                )}
                {flags.map((fl, k) => (
                  <div key={k} className={`mt-0.5 font-medium ${fl.level === "block" ? "text-red-700" : "text-amber-700"}`}>! {fl.text}</div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function RequestDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; edited?: string }> }) {
  const { session, viewer } = await requestsPage();
  const { id } = await params;
  const sp = await searchParams;
  const orgId = session.orgId;
  const loaded = await withRequestsTenant(orgId, async (tx) => {
    const [r] = await loadRequests(tx, orgId, { id }, 1);
    if (!r) return null;
    const events = await tx.moneyRequestEvent.findMany({ where: { orgId, requestId: id }, orderBy: { at: "asc" } });
    const settings = await readSettings(tx, orgId);
    const balances = await pettyBalances(tx, orgId);
    // ไฟล์ซ้ำกับใบอื่น (ไม่นับใบนี้เอง)
    const hashes = r.attachments.map((a) => a.sha256);
    const dupRows = hashes.length
      ? await tx.$queryRawUnsafe<{ code: string; sha: string }[]>(
          `SELECT r.code, a->>'sha256' AS sha FROM requests.requests r, jsonb_array_elements(r.attachments) a
            WHERE r.org_id = $1 AND r.id <> $2 AND r.status NOT IN ('rejected','cancelled') AND a->>'sha256' = ANY($3::text[])`,
          orgId,
          id,
          hashes,
        )
      : [];
    return { r, events, settings, balances, dups: new Map(dupRows.map((d) => [d.sha, d.code])) };
  });
  if (!loaded || !canSee(loaded.r, viewer)) notFound();
  const { r, events, settings, balances, dups } = loaded;
  // ยอด OT พนักงานประจำ: คนที่ไม่ใช่เจ้าตัว/CEO/ผู้ดูแลเงินเดือนเห็นแค่ชั่วโมง (lib/pay-privacy.ts)
  // ตัวเลขที่ส่งลงหน้าเว็บมาจาก `shown` (ถูกตัดแล้ว) — `r` ใช้คิดขั้นตอนฝั่งเซิร์ฟเวอร์เท่านั้น
  const privacy = await payPrivacy(session);
  const payHidden = !canSeePay(privacy, r);
  const shown = maskRequest(privacy, r);
  const today = bangkokToday();
  const st = statusOf(r);
  const meta = KIND_META[r.kind];

  const scans = r.kind === "ot" && r.employmentId ? await scansOn(orgId, r.employmentId, r.workDate) : null;
  const scanNote = (() => {
    if (r.kind !== "ot" || !r.otStart || !r.otEnd || !r.employmentId) return null;
    const noEvidence = r.attachments.length === 0 ? " · ไม่ได้แนบหลักฐาน — ถามผู้ลงหรือคนสั่งงานก่อนอนุมัติ" : "";
    if (!scans || (!scans.in_hm && !scans.out_hm)) return { tone: "warn" as const, text: `ไม่มีสแกนเข้า-ออกวันนั้นในระบบ${noEvidence || " — ตรวจจากหลักฐานแทน"}` };
    const covered = scans.in_hm && scans.out_hm && timesOverlap(scans.in_hm, scans.out_hm, r.otStart, r.otEnd) && scans.out_hm >= r.otEnd;
    return covered
      ? { tone: "ok" as const, text: `สแกนวันนั้น เข้า ${scans.in_hm} · ออก ${scans.out_hm} — ครอบช่วง OT` }
      : { tone: "warn" as const, text: `สแกนวันนั้น เข้า ${scans.in_hm ?? "—"} · ออก ${scans.out_hm ?? "—"} — ไม่มีสแกนครอบช่วง OT ${r.otStart}–${r.otEnd}${noEvidence}` };
  })();

  // ผู้ถือเงินสดย่อย (สำหรับจ่ายจากเงินสดย่อย / รับเงินทอน)
  const holderUsers = await prisma.user.findMany({
    where: { orgId, isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: REQ_PERMS.pettyCash } } } } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const holders: PettyHolder[] = holderUsers.map((u) => ({ userId: u.id, name: u.name, balance: balances.get(u.id) ?? 0 }));
  const period = scorePeriodOf(await loadScorePeriodConfig(orgId), new Date());

  const isBeneficiary = r.beneficiaryUserId === session.userId;
  const outstanding = round2(r.netAmount - r.paidTotal);
  const workerOt = r.kind === "ot" && r.beneficiaryKind === "worker";
  // ยอดซ่อน = จ่ายผ่านรอบเงินเดือน (ผู้ดูแลเงินเดือนทำ) ไม่ใช่ที่หน้านี้ — จ่ายเงินโดยไม่รู้ยอดไม่ได้
  const canPayHere = r.status === "approved" && !workerOt && !isBeneficiary && !payHidden && (viewer.canPay || viewer.isPettyHolder) && outstanding > 0.005;
  const methods: PaymentMethod[] = viewer.canPay
    ? (["transfer", "cash", ...(holders.length ? (["petty_cash"] as PaymentMethod[]) : []), ...(r.beneficiaryKind === "staff" && r.kind !== "advance" ? (["payroll"] as PaymentMethod[]) : [])] as PaymentMethod[])
    : ["petty_cash"];
  const payHolders = viewer.canPay ? holders : holders.filter((h) => h.userId === session.userId);
  const manager = viewer.canApprove || viewer.canApproveCeo || viewer.canPay;
  const canCancel =
    (r.status === "pending" && (r.createdBy === session.userId || manager)) ||
    ((r.status === "approved" || (r.status === "paid" && workerOt)) && manager && !r.payments.some((p) => !p.voided && p.method !== "worker_ledger"));

  const receipts = r.attachments.filter((a) => a.role === "receipt");
  const flagsFor = (a: Attachment) => receiptFlags(a, { claimDate: r.workDate, today, maxAgeDays: settings.receiptMaxAgeDays, duplicateOf: dups.get(a.sha256) ?? null });
  const mismatch = r.kind === "expense" ? amountMismatch(receipts, r.amount) : null;

  const steps: { title: string; sub?: string; state: "done" | "now" | "todo" | "stop" }[] = [
    { title: `${r.createdByName} ยื่น`, sub: thaiDateTime(r.createdAt), state: "done" },
    r.status === "rejected"
      ? { title: `${r.decidedByName} ไม่อนุมัติ`, sub: r.decisionNote ?? "", state: "stop" }
      : r.status === "cancelled" && !r.decidedAt
        ? { title: "ยกเลิก", sub: `${r.cancelledByName} · ${r.cancelReason}`, state: "stop" }
        : r.decidedAt
          ? { title: `${r.decidedByName} อนุมัติ`, sub: `${thaiDateTime(r.decidedAt)}${r.decisionNote ? ` · ${r.decisionNote}` : ""}`, state: "done" }
          : r.needCeo && !r.firstDecidedAt
            ? { title: "HR อนุมัติ", sub: "รออยู่ · ยอดเกินเกณฑ์ ต่อ CEO", state: "now" }
            : { title: `${r.approverLevel === "ceo" ? "CEO" : "HR"} อนุมัติ`, sub: "รออยู่", state: "now" },
  ];
  // อนุมัติสองขั้น (ยอดเกินเกณฑ์): แทรกขั้น HR ที่ผ่านแล้ว / ขั้น CEO ที่ยังไม่ถึง
  if (r.firstDecidedAt) steps.splice(1, 0, { title: `${r.firstDecidedByName} (HR) อนุมัติขั้นแรก`, sub: `${thaiDateTime(r.firstDecidedAt)}${r.firstDecisionNote ? ` · ${r.firstDecisionNote}` : ""}`, state: "done" });
  else if (r.needCeo && r.status === "pending") steps.push({ title: "CEO อนุมัติ", sub: "ยอดเกินเกณฑ์", state: "todo" });
  if (r.status !== "rejected" && !(r.status === "cancelled" && !r.decidedAt)) {
    if (workerOt) steps.push({ title: "เข้าบัญชีค่าแรงคนงาน", sub: r.status === "paid" ? "จ่ายพร้อมค่าแรงที่หน้าจ่ายเงินคนงาน" : undefined, state: r.status === "paid" ? "done" : "todo" });
    else {
      steps.push({ title: "HR จ่ายเงิน + หลักฐาน", sub: payHidden ? (r.kind === "ot" ? "รวมกับเงินเดือน (ผู้ดูแลเงินเดือนทำ)" : undefined) : r.paidTotal > 0 ? `จ่ายแล้ว ${baht(r.paidTotal)}${outstanding > 0.005 ? ` · เหลือ ${baht(outstanding)}` : ""}` : undefined, state: r.status === "paid" ? "done" : r.status === "approved" ? "now" : "todo" });
      if (r.kind === "cash_advance") steps.push({ title: "คนเบิกส่งใบเสร็จ + เงินทอน → HR ตรวจ", sub: r.clearedAt ? `ตรวจแล้ว · ${r.clearedByName}` : r.clearStatus === "submitted" ? "ส่งแล้ว รอ HR ตรวจ" : r.clearDueDate ? `ภายใน ${thaiDate(r.clearDueDate)}` : undefined, state: r.clearedAt ? "done" : r.status === "paid" ? "now" : "todo" });
      if (r.beneficiaryKind !== "vendor") steps.push({ title: "ผู้รับยืนยันได้รับเงิน", sub: r.receivedAt ? thaiDateTime(r.receivedAt) : undefined, state: r.receivedAt ? "done" : r.paidTotal > 0 && !r.payments.every((p) => p.method === "payroll") ? "now" : "todo" });
      if (r.kind === "advance" && r.beneficiaryKind === "worker") steps.push({ title: "หักคืนจากค่าแรงอัตโนมัติ", sub: "ลงเป็น \"เบิกล่วงหน้า\" ในบัญชีค่าแรงแล้ว", state: r.status === "paid" ? "done" : "todo" });
      else if (r.deductAmount > 0) steps.push({ title: r.beneficiaryKind === "worker" ? "หักคืนจากค่าแรงอัตโนมัติ" : "หักคืนในงวดเงินเดือน", sub: r.deductedAt ? `หักแล้ว งวด ${r.deductedPeriod}` : baht(r.deductAmount), state: r.deductedAt || r.beneficiaryKind === "worker" ? "done" : "now" });
    }
  }
  if (r.status === "cancelled" && r.decidedAt) steps.push({ title: "ยกเลิก", sub: `${r.cancelledByName} · ${r.cancelReason}`, state: "stop" });

  const breakdown = r.kind === "contractor" ? contractorBreakdown(r.amount, r.vatPercent, r.whtPercent) : null;
  const vendor = r.vendorId ? await withRequestsTenant(orgId, (tx) => tx.moneyVendor.findFirst({ where: { orgId, id: r.vendorId! } })) : null;

  return (
    <AppScaffold title={r.code} backHref="/requests" width="max-w-6xl">
      <div className="flex flex-col gap-4">
        {sp.created && <Notice tone="ok">ส่งแล้ว — {st.next}</Notice>}
        {sp.edited && <Notice tone="ok">บันทึกการแก้ไขแล้ว — ผู้อนุมัติได้แจ้งเตือนยอดใหม่</Notice>}
        {/* มือถือ: หัวเรื่อง → แผงอนุมัติ/จ่าย → รายละเอียด (ไม่ต้องเลื่อนผ่านประวัติก่อนถึงปุ่ม)
            จอ ≥1024: รายละเอียดคอลัมน์ซ้าย · ขั้นตอน + ปุ่มคอลัมน์ขวา */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ───────── ซ้าย: ข้อมูล ───────── */}
          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
            <section className="order-1 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <KindChip kind={r.kind} />
                    <StatusChip info={st} />
                  </div>
                  <h1 className="mt-1.5 text-lg font-bold text-(--ink)">{r.title}</h1>
                  <div className="text-xs text-(--ink-soft)">{r.code} · {meta.label}</div>
                </div>
                <div className="sm:text-right">
                  <div className="text-xs text-(--ink-soft)">{r.kind === "contractor" ? "จ่ายร้านจริง" : "ยอด"}</div>
                  {payHidden ? (
                    <div className="max-w-[14rem] text-sm font-medium text-(--ink-soft)">ซ่อนยอด · {HIDDEN_PAY_LABEL}</div>
                  ) : (
                    <div className="text-2xl font-bold tabular-nums text-(--ink)">{baht(r.netAmount)}</div>
                  )}
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-(--ink-soft)">ของใคร</dt><dd className="font-medium text-(--ink)">{r.beneficiaryName} <span className="font-normal text-(--ink-soft)">({beneficiaryLabel(r)})</span></dd></div>
                <div><dt className="text-xs text-(--ink-soft)">ผู้ยื่น</dt><dd className="text-(--ink)">{r.createdByName} · {thaiDateTime(r.createdAt)}</dd></div>
                <div><dt className="text-xs text-(--ink-soft)">{r.kind === "ot" ? "วันที่ทำ" : r.kind === "advance" ? "วันที่ขอ" : "วันที่"}</dt><dd className="text-(--ink)">{thaiDate(r.workDate)}{r.kind === "ot" && r.otMinutes ? ` · ${r.otStart}–${r.otEnd} (${hoursText(r.otMinutes)})` : ""}</dd></div>
                {(r.propertyName || r.workOrderCode) && (
                  <div>
                    <dt className="text-xs text-(--ink-soft)">บ้าน / ใบงาน</dt>
                    <dd className="text-(--ink)">
                      {r.propertyName ?? "—"}
                      {r.workOrderId && (
                        <>
                          {" · "}
                          <Link href={`/maintenance/work-orders/${r.workOrderId}`} className="font-medium text-(--app-strong) hover:underline">{r.workOrderCode}</Link>
                        </>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
              {shown.detail && <p className="mt-3 whitespace-pre-line rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink)">{shown.detail}</p>}
            </section>

            {/* ตัวเลข */}
            <section className="order-3 flex flex-col gap-2 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:p-5">
              <h2 className="text-sm font-bold text-(--ink)">ที่มาของยอดเงิน</h2>
              {r.kind === "ot" && payHidden && (
                <>
                  <div className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink)">
                    {hoursText(r.otMinutes ?? 0)} × {r.otPercent}% ({r.otRateLabel})
                    <div className="text-xs text-(--ink-soft)">ระบบคิดเงินให้จากเงินเดือน · ยอดเงิน{HIDDEN_PAY_LABEL} (ยอด OT บอกเงินเดือนได้)</div>
                  </div>
                  {scanNote && <Notice tone={scanNote.tone}>{scanNote.text}</Notice>}
                </>
              )}
              {r.kind === "ot" && !payHidden && (
                <>
                  {r.otBaseKind === "manual" ? (
                    <div className="text-sm text-(--ink-soft)">ไม่มีเงินเดือนในระบบตอนยื่น — แอดมินกรอกค่า OT เอง</div>
                  ) : r.otBase ? (
                    <div className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink)">
                      {r.otBaseKind === "monthly" ? `เงินเดือน ${baht(r.otBase)} ÷ 30 ÷ 8` : `ค่าแรง ${baht(r.otBase)}/วัน ÷ 8`} = {baht(round2(r.otBaseKind === "monthly" ? r.otBase / 240 : r.otBase / 8))}/ชม. × {r.otPercent}% × {hoursText(r.otMinutes ?? 0)}
                      <div className="text-xs text-(--ink-soft)">{r.otRateLabel} · ตัวเลขตอนยื่น ไม่เปลี่ยนตามการปรับเงินเดือนทีหลัง</div>
                    </div>
                  ) : (
                    <div className="text-sm text-amber-700">ยังไม่ได้ตั้งค่าแรงของคนงาน — ชั่วโมงเข้าบัญชีแล้ว ค่าเงินคิดเมื่อ HR ตั้งค่าแรง</div>
                  )}
                  <MoneyRow strong label="ค่า OT" value={r.netAmount} />
                  {scanNote && <Notice tone={scanNote.tone}>{scanNote.text}</Notice>}
                </>
              )}
              {r.kind === "expense" && (
                <>
                  {r.lines.length > 0 ? r.lines.map((l, i) => <MoneyRow key={i} label={l.item} value={l.amount} />) : <MoneyRow label={r.title} value={r.amount} />}
                  <MoneyRow strong label="ขอเบิก" value={r.amount} />
                  {mismatch && <Notice tone="warn">{mismatch}</Notice>}
                </>
              )}
              {r.kind === "advance" && (
                <>
                  <MoneyRow strong label="เบิกล่วงหน้า" value={r.amount} />
                  <div className="text-xs text-(--ink-soft)">{r.beneficiaryKind === "worker" ? "จ่ายแล้วลงเป็น \"เบิกล่วงหน้า\" ในบัญชีค่าแรง — หักจากค่าแรงวันถัดไปอัตโนมัติ" : "จ่ายแล้วเข้ารายการ \"รอหักเงินเดือน\" ที่หน้าส่งเข้าเงินเดือน"}</div>
                </>
              )}
              {r.kind === "cash_advance" && (
                <>
                  <MoneyRow label="ขอเงินไปซื้อของ" value={r.amount} />
                  {r.paidTotal > 0 && <MoneyRow label="ได้รับไปแล้ว" value={r.paidTotal} />}
                  {r.clearSpent !== null && <MoneyRow label="ใช้จริงตามใบเสร็จ" value={r.clearSpent} minus />}
                  {r.clearReturned !== null && r.clearReturned > 0 && <MoneyRow label="คืนเงินทอน" value={r.clearReturned} minus />}
                  {r.clearSpent !== null && (() => {
                    const diff = round2(r.paidTotal - (r.clearSpent ?? 0) - (r.clearReturned ?? 0));
                    return <MoneyRow strong label={diff > 0.005 ? "ขาดคืน" : diff < -0.005 ? "บริษัทจ่ายเพิ่ม" : "พอดี"} value={Math.abs(diff)} />;
                  })()}
                  {r.clearNote && <div className="text-xs text-(--ink-soft)">หมายเหตุผู้เบิก: {r.clearNote}</div>}
                </>
              )}
              {breakdown && (
                <>
                  <MoneyRow label="ค่าจ้าง (ก่อน VAT)" value={breakdown.base} />
                  {breakdown.vat > 0 && <MoneyRow label={`VAT ${breakdown.vatPercent}%`} value={breakdown.vat} />}
                  <MoneyRow label="ยอดตามบิลร้าน" value={breakdown.gross} />
                  {breakdown.wht > 0 && <MoneyRow label={`หัก ณ ที่จ่าย ${breakdown.whtPercent}%`} hint="คิดจากยอดก่อน VAT · บริษัทต้องนำส่งสรรพากรและออกหนังสือรับรองให้ร้าน" value={breakdown.wht} minus />}
                  <MoneyRow strong label="จ่ายให้ร้านจริง" value={breakdown.net} />
                  {vendor && (
                    <div className="mt-1 rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-xs text-(--ink-soft)">
                      {vendor.name}{vendor.taxId ? ` · เลขผู้เสียภาษี ${vendor.taxId}` : " · ยังไม่มีเลขผู้เสียภาษี"}
                      {vendor.bankAccount ? ` · ${vendor.bankName} ${vendor.bankAccount} (${vendor.accountName || vendor.name})` : ""}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* หลักฐาน */}
            {r.attachments.length > 0 && (
              <section className="order-3 flex flex-col gap-4 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:p-5">
                <Files title="ใบเสร็จจากผู้ยื่น" files={receipts} flagsFor={flagsFor} />
                <Files title="หลักฐาน / ไฟล์ประกอบ" files={r.attachments.filter((a) => a.role === "evidence")} flagsFor={(a) => (dups.get(a.sha256) ? [{ level: "warn", text: `ไฟล์เดียวกับใน ${dups.get(a.sha256)}` }] : [])} />
                <Files title="ใบเสร็จของที่ซื้อ (ตอนส่งคืนเงินทอน)" files={r.attachments.filter((a) => a.role === "clearing")} flagsFor={(a) => receiptFlags(a, { claimDate: r.workDate, today, maxAgeDays: settings.receiptMaxAgeDays, duplicateOf: dups.get(a.sha256) ?? null }).filter((f) => !f.text.startsWith("วันที่บนใบเสร็จ") || f.level === "block")} />
              </section>
            )}

            {/* การจ่าย */}
            {r.payments.length > 0 && (
              <section className="order-3 flex flex-col gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:p-5">
                <h2 className="text-sm font-bold text-(--ink)">การจ่ายเงิน</h2>
                {shown.payments.map((p) => (
                  <div key={p.id} className={`rounded-(--radius) border border-(--line) p-3 ${p.voided ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm">
                        <span className={`font-bold tabular-nums ${p.voided ? "line-through" : ""}`}>{payHidden ? "฿•••" : baht(p.amount)}</span> · {METHOD_LABEL[p.method]}
                        {p.payrollPeriod ? ` งวด ${p.payrollPeriod}` : ""}
                        {p.pettyHolderId ? ` (${holders.find((h) => h.userId === p.pettyHolderId)?.name ?? ""})` : ""}
                      </div>
                      <div className="text-xs text-(--ink-soft)">{thaiDate(p.paidOn)} · บันทึกโดย {p.byName}</div>
                    </div>
                    {p.note && <div className="mt-1 text-xs text-(--ink-soft)">{p.note}</div>}
                    {p.voided && <div className="mt-1 text-xs font-medium text-red-700">ยกเลิกแล้ว · {p.voided.byName} · {p.voided.reason}</div>}
                    {p.slips.length > 0 && <div className="mt-2"><Files title="หลักฐานการจ่าย" files={p.slips} /></div>}
                    {!p.voided && p.method !== "worker_ledger" && (viewer.canPay || p.byUserId === session.userId) && <div className="mt-2"><VoidPaymentButton paymentId={p.id} /></div>}
                  </div>
                ))}
              </section>
            )}

            {/* ประวัติ */}
            <section className="order-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:p-5">
              <h2 className="text-sm font-bold text-(--ink)">ประวัติ</h2>
              <ol className="mt-2 flex flex-col gap-2">
                {events.map((e) => (
                  <li key={e.id} className="text-xs">
                    <span className="text-(--ink-soft)">{thaiDateTime(e.at.toISOString())} · {e.byName}</span>
                    <div className="text-sm text-(--ink)">{payHidden ? hideBaht(e.summary) : e.summary}</div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {/* ───────── ขวา: ขั้นตอน + ปุ่ม ───────── */}
          <aside className="order-2 flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1">
            {canDecide(r, viewer) && (
              <DecidePanel id={r.id} version={r.updatedAt} level={r.approverLevel} isOt={r.kind === "ot"} forwardsToCeo={r.approverLevel === "hr" && r.needCeo && !viewer.canApproveCeo} firstBy={r.firstDecidedByName} />
            )}
            {canPayHere && (
              <PayPanel id={r.id} outstanding={outstanding} methods={methods} holders={payHolders} myUserId={session.userId} today={today} payrollPeriod={period} title={r.kind === "cash_advance" && r.clearedAt ? "จ่ายส่วนต่างที่ใช้เกิน" : "บันทึกการจ่ายเงิน"} />
            )}
            {r.kind === "cash_advance" && r.status === "paid" && !r.clearStatus && (isBeneficiary || r.createdBy === session.userId) && (
              <ClearingSubmit id={r.id} paid={r.paidTotal} dueDate={r.clearDueDate ? thaiDate(r.clearDueDate) : null} today={today} maxAgeDays={settings.receiptMaxAgeDays} />
            )}
            {r.kind === "cash_advance" && r.clearStatus === "submitted" && viewer.canPay && !isBeneficiary && (
              <ClearingConfirm id={r.id} paid={r.paidTotal} spent={r.clearSpent ?? 0} returned={r.clearReturned ?? 0} holders={holders} worker={r.beneficiaryKind === "worker"} />
            )}
            {isBeneficiary && r.paidTotal > 0 && !r.receivedAt && r.payments.some((p) => !p.voided && p.method !== "payroll" && p.method !== "worker_ledger") && (
              <ConfirmReceivedButton id={r.id} amount={r.paidTotal} />
            )}
            <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
              <h2 className="mb-3 text-sm font-bold text-(--ink)">ขั้นตอน</h2>
              <Steps steps={steps} />
              <p className="mt-3 border-t border-(--line) pt-2 text-xs text-(--ink-soft)">ต่อไป: {steps.find((x) => x.state === "now")?.title ?? st.next}</p>
            </section>
            {r.status === "pending" && !r.firstDecidedAt && r.createdBy === session.userId && (
              <Link href={`/requests/${r.id}/edit`} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) border border-(--line) bg-(--bg) text-sm font-semibold text-(--ink) hover:bg-(--bg-soft)">
                <Pencil className="h-4 w-4" aria-hidden="true" /> แก้ไขใบ
              </Link>
            )}
            {canCancel && <CancelButton id={r.id} label={r.status === "pending" ? "ยกเลิกคำขอ" : "ยกเลิกใบนี้"} />}
          </aside>
        </div>
      </div>
    </AppScaffold>
  );
}

