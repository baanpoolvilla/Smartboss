import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { fileUrlWithName } from "@/lib/doc-thumb";
import { DocThumbMini } from "@/modules/report_task/components/report-feed/doc-attachment-card";
import { redirect } from "next/navigation";
import { prisma } from "@smartboss/database";
import { hasPermission } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { InfoTip } from "@/modules/salary/components/help";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";
import { loadRequests, pettyBalances, readSettings, toPetty, toPettyTopup, withRequestsTenant } from "@/modules/requests/lib/db";
import { usersWithPermission } from "@/modules/maintenance/data/notify";
import { listPettyHolders } from "@/modules/requests/lib/holders";
import { pettyMonth } from "@/modules/requests/lib/petty-report";
import { payableByHolder, pettyAccess, requestsPage } from "@/modules/requests/lib/page";
import { maskRequest, payPrivacy } from "@/modules/requests/lib/pay-privacy";
import { MoneyBackButton, PendingTopupRow, PettyHolderCard, PettyHoldersButton, ReviewSpendButtons, VoidPettyButton, WriteOffButton } from "@/modules/requests/components/petty-forms";
import { bangkokToday, baht, monthTitle, shiftMonthOf, thaiDateTime } from "@/modules/requests/lib/types";

import { ceoTitle } from "@/lib/ceo-title";
export const dynamic = "force-dynamic";

/** ภาษีของ "ซื้อของเอง" — บิลเต็ม · VAT · หัก ณ ที่จ่าย · จ่ายจริง (ผู้ใช้ 8/11/2569) */
function TaxLine({ tax, paid }: { tax: { bill: number; vat: number; whtPercent: number; wht: number; payeeName: string | null; payeeKind: "person" | "company" | null }; paid: number }) {
  return (
    <div className="text-xs tabular-nums text-(--ink-soft)">
      บิล {baht(tax.bill)}
      {tax.vat > 0 && <> · VAT {baht(tax.vat)}</>}
      {tax.wht > 0 && <> · หัก ณ ที่จ่าย {tax.whtPercent}% {baht(tax.wht)}{tax.payeeName ? ` (${tax.payeeName} · ${tax.payeeKind === "company" ? "ภ.ง.ด.53" : "ภ.ง.ด.3"})` : ""}</>}
      {" "}· จ่ายจริง <b className="text-(--ink)">{baht(paid)}</b>
    </div>
  );
}

const KIND_LABEL = { top_up: "รับเงินเติม", spend: "จ่ายเงิน", return: "รับเงินทอนคืน", adjust: "ปรับยอด (นับเงินจริง)" } as const;

/**
 * เงินสดย่อย — แอดมิน/HR แต่ละคนถือเงินก้อนของตัวเอง ยอดคงเหลือ = เติม + รับคืน − จ่าย ± ปรับ
 * จ่ายออกเกิดตอนบันทึกจ่ายคำขอแบบ "เงินสดย่อย" หรือผู้ถือกด "จ่ายค่าของ" เอง · รับคืนเกิดตอน HR ตรวจเคลียร์ที่มีเงินทอน
 *
 * ผู้ใช้ 30/10/2569: ปุ่มอยู่บนการ์ดของแต่ละคน + ⓘ อธิบาย · ผู้ถือขอเติมเอง → HR/CEO อนุมัติ (ไม่อนุมัติของตัวเอง,
 * HR ขอเอง = CEO) · บัญชีผู้ดูแลระบบสูงสุด (SUPER_ADMIN) ไม่ใช่คนถือเงินจริง ไม่ขึ้นการ์ด
 * 31/10/2569: ใครเห็น/เติม/ปรับยอด ใช้สิทธิ์เงินสดย่อยแยก (REQ_PERMS.petty*) ไม่ผูกกับสิทธิ์ใบเบิกแล้ว
 *             ใครถือเงิน = HR/CEO ติ๊กรายคนที่ปุ่ม "ตั้งคนถือเงิน" บนหน้านี้ (lib/holders.ts)
 */
export default async function PettyCashPage({ searchParams }: { searchParams: Promise<{ holder?: string; month?: string }> }) {
  const ceo = await ceoTitle();
  const { session, viewer } = await requestsPage();
  // HR/CEO ที่ไม่ได้ถือเงินเองก็ต้องเข้ามาอนุมัติคำขอเติม/เติมเงินให้คนอื่นได้
  const petty = pettyAccess(session);
  const canTopUp = petty.topUp;
  if (!viewer.isPettyHolder && !petty.view && !petty.topUp && !petty.adjust) redirect("/requests");
  const orgId = session.orgId;
  const sp = await searchParams;
  const holderUsers = await listPettyHolders(orgId);
  const { balances, pending, toReview, reqSettings } = await withRequestsTenant(orgId, async (tx) => ({
    reqSettings: await readSettings(tx, orgId),
    balances: await pettyBalances(tx, orgId),
    pending: (await tx.moneyPettyTopup.findMany({ where: { orgId, status: "pending" }, orderBy: { createdAt: "asc" } })).map(toPettyTopup),
    // "ซื้อของเอง" ที่จ่ายไปก่อน: รอตรวจ + ไม่ผ่านที่ยังไม่ได้เงินคืน (ทุกเดือน ไม่ใช่แค่เดือนที่เลือก)
    toReview: (await tx.moneyPettyCashEntry.findMany({ where: { orgId, voidedAt: null, reviewStatus: { in: ["pending", "rejected"] } }, orderBy: { createdAt: "asc" } })).map(toPetty),
  }));
  const seesAll = petty.view || petty.topUp || petty.adjust;
  const holders = holderUsers.map((u) => ({ userId: u.id, name: u.name, balance: balances.get(u.id) ?? 0 }));
  // สรุปรายเดือน + ประวัติของเดือนที่เลือก — คนถือเงินเห็นแค่ของตัวเอง (ผู้ใช้ 31/10/2569)
  const thisMonth = bangkokToday().slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : thisMonth;
  const holder = seesAll ? sp.holder : session.userId;
  const monthHolders = (seesAll ? holders : holders.filter((h) => h.userId === session.userId)).map((h) => ({ userId: h.userId, name: h.name }));
  const summary = await pettyMonth(orgId, month, monthHolders, holder);
  const sumRows = holder ? summary.rows.filter((r) => r.userId === holder) : summary.rows;
  const totalOf = (k: "opening" | "topUp" | "paidRequests" | "selfSpend" | "other" | "closing") => sumRows.reduce((t, r) => t + r[k], 0);
  const catMax = Math.max(1, ...summary.byCategory.map((c) => c.amount));
  const qs = (m: string, h?: string) => `?month=${m}${h ? `&holder=${h}` : ""}`;
  // ของตัวเองขึ้นก่อน
  const visibleHolders = (seesAll ? holders : holders.filter((h) => h.userId === session.userId)).sort((a, b) => Number(b.userId === session.userId) - Number(a.userId === session.userId));
  const visiblePending = seesAll ? pending : pending.filter((p) => p.holderUserId === session.userId);
  const visibleEntries = summary.entries;
  const total = holders.reduce((s, h) => s + h.balance, 0);
  const today = bangkokToday();
  // ตั้งคนถือเงิน: HR/CEO — รายชื่อให้ติ๊ก = ทุกคนที่ยังใช้งานอยู่ ยกเว้นคนงานรายวัน
  const canSetHolders = canTopUp || hasPermission(session, REQ_PERMS.settings);
  const people = canSetHolders
    ? await prisma.user.findMany({
        where: { orgId, isActive: true, roles: { none: { role: { code: WORKER_ROLE_CODE } } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  // ใบเบิกที่อนุมัติแล้วรอจ่าย — ให้คนถือเงินกดจ่ายตามใบได้จากปุ่ม "จ่ายเงิน" › ให้คนที่ขอมา (ยอดหักจากเงินในมือเอง)
  const privacy = viewer.isPettyHolder ? await payPrivacy(session) : null;
  const payable = privacy
    ? (await withRequestsTenant(orgId, (tx) => loadRequests(tx, orgId, { status: "approved" }, 200)))
        .map((r) => maskRequest(privacy, r))
        .filter((r) => payableByHolder(r, session.userId))
        .map((r) => ({ id: r.id, code: r.code, title: r.title, beneficiaryName: r.beneficiaryName, outstanding: r.netAmount - r.paidTotal }))
    : [];
  // ตรวจ "ซื้อของเอง": HR/CEO ที่อนุมัติได้ · ไม่ตรวจของตัวเอง · ผู้ถือเป็น HR ⇒ CEO
  const [hrIds, ceoIds] = await Promise.all([usersWithPermission(orgId, REQ_PERMS.approve), usersWithPermission(orgId, REQ_PERMS.approveCeo)]);
  const holderNeedsCeo = (id: string) => hrIds.includes(id) && !ceoIds.includes(id);
  const reviewers = viewer.canApprove || viewer.canApproveCeo;
  const canReview = (e: (typeof toReview)[number]) =>
    reviewers && e.holderUserId !== session.userId && e.byUserId !== session.userId && (!holderNeedsCeo(e.holderUserId) || viewer.canApproveCeo);
  const reviewList = toReview.filter((e) => e.review?.status === "pending" && (seesAll || reviewers || e.holderUserId === session.userId));
  const shortList = toReview.filter((e) => e.review?.status === "rejected" && (seesAll || reviewers || e.holderUserId === session.userId));
  const canDecide = (p: (typeof pending)[number]) => canTopUp && p.holderUserId !== session.userId && p.requestedByUserId !== session.userId && (!p.needsCeo || viewer.canApproveCeo);

  return (
    <AppScaffold title="เงินสดย่อย" backHref="/requests" width="max-w-none">
      <div className="flex flex-col gap-4">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) px-4 py-3">
          <p className="flex items-center text-sm text-(--ink)">
            เงินสดที่บริษัทให้แต่ละคนถือไว้จ่ายค่าของเล็ก ๆ น้อย ๆ
            <InfoTip label="เงินสดย่อยคืออะไร" title="เงินสดย่อยใช้ยังไง">
              <b>1. ได้เงินมาถือ</b> — HR/{ceo} กด “เติมเงินให้” หรือผู้ถือกด “ขอเติมเงิน” แล้วรออนุมัติ (ทุกครั้งต้องแนบสลิปโอน/รูปเงินสด)
              <br />
              <b>2. ใช้จ่าย</b> — กด “จ่ายเงิน” บนการ์ดของตัวเอง แล้วเลือก “ให้คนที่ขอมา” (ใบเบิกที่ HR อนุมัติแล้ว) หรือ “ซื้อของเอง” (บอกว่าค่าอะไร เลือกหมวด แนบใบเสร็จ)
              <br />
              <b>3. เงินใกล้หมด</b> — กด “ขอเติมเงิน” อีกรอบ
              <br />
              <br />
              ใบเบิกที่ HR เลือก “จ่ายจากเงินสดย่อย” จะหักยอดของคนที่จ่ายให้เองอัตโนมัติ · ไม่มีใครอนุมัติคำขอเติมของตัวเองได้ (HR ขอ = {ceo} อนุมัติ)
            </InfoTip>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {seesAll && holders.length > 1 && (
              <div className="text-sm text-(--ink-soft)">
                รวมทุกคน <span className="font-bold tabular-nums text-(--ink)">{baht(total)}</span>
              </div>
            )}
            {canSetHolders && (
              <PettyHoldersButton
                people={people.map((u) => ({ userId: u.id, name: u.name, balance: balances.get(u.id) ?? 0 }))}
                holderIds={holders.map((h) => h.userId)}
              />
            )}
          </div>
        </section>

        {visiblePending.length > 0 && (
          <section className="rounded-(--radius-lg) border-2 border-amber-300 bg-(--bg)">
            <h2 className="flex items-center border-b border-(--line) px-4 py-3 text-sm font-bold text-(--ink)">
              คำขอเติมเงินที่รออนุมัติ ({visiblePending.length})
              <InfoTip label="คำขอเติมเงิน">
                ผู้ถือเงินขอเติมเงินสดย่อยของตัวเอง — HR หรือ {ceo} ให้เงิน (โอน/เงินสด) แล้วกด “อนุมัติ + แนบสลิป” ยอดถึงจะเพิ่ม · อนุมัติของตัวเองไม่ได้ · คำขอของ HR ต้องให้ {ceo} อนุมัติ
              </InfoTip>
            </h2>
            <ul className="divide-y divide-(--line)">
              {visiblePending.map((p) => (
                <PendingTopupRow key={p.id} item={p} canDecide={canDecide(p)} isMine={p.requestedByUserId === session.userId} waitingFor={p.needsCeo ? ceo : `HR หรือ ${ceo}`} today={today} />
              ))}
            </ul>
          </section>
        )}

        {reviewList.length > 0 && (
          <section className="rounded-(--radius-lg) border-2 border-amber-300 bg-(--bg)">
            <h2 className="flex items-center border-b border-(--line) px-4 py-3 text-sm font-bold text-(--ink)">
              จ่ายไปก่อน รอตรวจ ({reviewList.length})
              <InfoTip label="จ่ายไปก่อน รอตรวจ">
                ผู้ถือเงินจ่ายค่าของจากเงินสดย่อยไปก่อน (ทำเรื่องไม่ทัน) แล้วมาลงว่าจ่ายอะไร พร้อมใบเสร็จ — HR หรือ {ceo} ดูใบเสร็จแล้วกด “ผ่าน” หรือ “ไม่ผ่าน” · ไม่ผ่าน = ผู้ถือต้องคืนเงินเข้ากอง · ตรวจของตัวเองไม่ได้ · ของ HR ต้องให้ {ceo} ตรวจ
              </InfoTip>
            </h2>
            <ul className="divide-y divide-(--line)">
              {reviewList.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <span className="font-semibold text-(--ink)">{e.holderName}</span>
                      {e.category && <span className="ml-1.5 rounded-full bg-(--bg-soft) px-2 py-0.5 text-xs text-(--ink-soft)">{e.category}</span>}
                      <div className="text-(--ink)">{e.note}</div>
                      {e.tax && <TaxLine tax={e.tax} paid={-e.delta} />}
                    </div>
                    <div className="shrink-0 text-sm font-bold tabular-nums text-(--danger)">{baht(-e.delta)}</div>
                  </div>
                  <div className="text-xs text-(--ink-soft)">
                    ลงเมื่อ {thaiDateTime(e.at)}
                    {e.attachments.map((a, i) => (
                      <a key={i} href={fileUrlWithName(a.url, a.name)} target="_blank" rel="noreferrer" className="ml-2 text-(--app-strong) hover:underline">ใบเสร็จ{e.attachments.length > 1 ? ` ${i + 1}` : ""}</a>
                    ))}
                  </div>
                  {canReview(e) ? (
                    <ReviewSpendButtons id={e.id} />
                  ) : (
                    <div className="mt-1 text-xs text-amber-800">รอ{holderNeedsCeo(e.holderUserId) ? ` ${ceo}` : ` HR หรือ ${ceo}`} ตรวจ</div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {shortList.length > 0 && (
          <section className="rounded-(--radius-lg) border-2 border-red-300 bg-(--bg)">
            <h2 className="flex items-center border-b border-(--line) px-4 py-3 text-sm font-bold text-red-800">
              เงินขาด · ไม่ผ่าน รอคืนเงิน ({shortList.length} รายการ · {baht(shortList.reduce((t, e) => t - e.delta, 0))})
              <InfoTip label="เงินขาด">
                รายการที่จ่ายไปก่อนแต่ตรวจแล้วไม่ผ่าน — เงินในมือของผู้ถือยังถูกหักอยู่ ผู้ถือต้องคืนเงินเข้ากอง แล้ว HR กด “ได้เงินคืนแล้ว” ยอดในมือถึงจะกลับมา · เรียกคืนไม่ได้จริง (เช่น เงินหาย) {ceo} กด “บริษัทรับเป็นค่าใช้จ่าย” · ในรายงานเบิกจ่าย เงินขาดไม่นับเป็นค่าใช้จ่าย
              </InfoTip>
            </h2>
            <ul className="divide-y divide-(--line)">
              {shortList.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <span className="font-semibold text-(--ink)">{e.holderName}</span> · {e.note}
                    </div>
                    <div className="shrink-0 text-sm font-bold tabular-nums text-(--danger)">{baht(-e.delta)}</div>
                  </div>
                  <div className="text-xs text-red-700">ไม่ผ่าน · {e.review?.byName} · {e.review?.note}</div>
                  <div className="flex flex-wrap gap-2">
                    {petty.adjust && <MoneyBackButton id={e.id} />}
                    {viewer.canApproveCeo && e.holderUserId !== session.userId && <WriteOffButton id={e.id} />}
                  </div>
                  {!petty.adjust && e.holderUserId === session.userId && (
                    <div className="mt-1 text-xs text-(--ink-soft)">คืนเงินเข้ากองแล้วแจ้ง HR ให้กด “ได้เงินคืนแล้ว”</div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {visibleHolders.length === 0 ? (
          <div className="rounded-(--radius-lg) border border-dashed border-(--line) p-6 text-center text-sm text-(--ink-soft)">ยังไม่มีใครถือเงินสดย่อย — HR/{ceo} กด &quot;ตั้งคนถือเงิน&quot; ด้านบน</div>
        ) : (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleHolders.map((h) => {
              const isMe = h.userId === session.userId;
              return (
                <PettyHolderCard
                  tax={{ review: reqSettings.pettySpendReview, vatPercent: reqSettings.vatPercent, whtRates: reqSettings.whtRates.filter((r) => r > 0) }}
                  key={h.userId}
                  holder={h}
                  isMe={isMe && viewer.isPettyHolder}
                  canTopUp={canTopUp}
                  canAdjust={isMe || petty.adjust}
                  pendingMine={pending.some((p) => p.holderUserId === h.userId)}
                  payable={isMe ? payable : []}
                  today={today}
                  selected={sp.holder === h.userId}
                  href={sp.holder === h.userId ? qs(month) : qs(month, h.userId)}
                />
              );
            })}
          </section>
        )}

        <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg)">
          <div className="flex flex-wrap items-center gap-2 border-b border-(--line) px-4 py-3">
            <h2 className="flex items-center text-sm font-bold text-(--ink)">
              สรุปรายเดือน
              <InfoTip label="สรุปรายเดือน">
                ยกมา = เงินในมือต้นเดือน · เติม = ที่ HR/{ceo} ให้ · จ่ายตามใบ = จ่ายให้คนที่ขอมา · ซื้อเอง = ใช้ซื้อของโดยไม่มีใบเบิก · คืน/ปรับ = เงินทอนที่รับคืน และ “นับเงินไม่ตรง” · คงเหลือ = ที่ควรมีในมือปลายเดือน · รายการที่ยกเลิกแล้วไม่นับ
              </InfoTip>
            </h2>
            <span className="flex-1" />
            <Link href={qs(shiftMonthOf(month, -1), sp.holder)} aria-label="เดือนก่อน" className="rounded-full border border-(--line) p-2 hover:bg-(--bg-soft)"><ChevronLeft className="h-4 w-4" /></Link>
            <div className="min-w-32 text-center text-sm font-semibold">{monthTitle(month)}</div>
            <Link href={qs(shiftMonthOf(month, 1), sp.holder)} aria-label="เดือนถัดไป" className="rounded-full border border-(--line) p-2 hover:bg-(--bg-soft)"><ChevronRight className="h-4 w-4" /></Link>
            <a href={`/requests/petty-cash/export${qs(month, sp.holder)}`} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-(--line) px-3.5 text-sm hover:bg-(--bg-soft)">
              <Download className="h-4 w-4" aria-hidden="true" /> Excel
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-(--bg-soft) text-left text-xs text-(--ink-soft)">
                <tr>
                  <th className="px-3 py-2 font-semibold">คนถือเงิน</th>
                  <th className="px-3 py-2 text-right font-semibold">ยกมา</th>
                  <th className="px-3 py-2 text-right font-semibold">+ เติม</th>
                  <th className="px-3 py-2 text-right font-semibold">− จ่ายตามใบ</th>
                  <th className="px-3 py-2 text-right font-semibold">− ซื้อเอง</th>
                  <th className="px-3 py-2 text-right font-semibold">± คืน/ปรับ</th>
                  <th className="px-3 py-2 text-right font-semibold">คงเหลือ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--line)">
                {sumRows.map((r) => (
                  <tr key={r.userId}>
                    <td className="px-3 py-2">
                      {seesAll ? <Link href={qs(month, r.userId)} className="text-(--app-strong) hover:underline">{r.name}</Link> : r.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{baht(r.opening)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.topUp ? `+${baht(r.topUp)}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-(--danger)">{r.paidRequests ? `−${baht(r.paidRequests)}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-(--danger)">{r.selfSpend ? `−${baht(r.selfSpend)}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.other ? `${r.other > 0 ? "+" : ""}${baht(r.other)}` : "—"}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{baht(r.closing)}</td>
                  </tr>
                ))}
              </tbody>
              {sumRows.length > 1 && (
                <tfoot className="border-t-2 border-(--line) font-bold">
                  <tr>
                    <td className="px-3 py-2">รวม</td>
                    <td className="px-3 py-2 text-right tabular-nums">{baht(totalOf("opening"))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">+{baht(totalOf("topUp"))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">−{baht(totalOf("paidRequests"))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">−{baht(totalOf("selfSpend"))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{baht(totalOf("other"))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{baht(totalOf("closing"))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {(summary.tax.vat > 0 || summary.tax.whtCount > 0 || summary.review.pendingCount > 0 || summary.review.shortCount > 0) && (
            <div className="flex flex-col gap-1 border-t border-(--line) px-4 py-3 text-sm">
              {summary.tax.vat > 0 && (
                <div>VAT ซื้อ (ใบกำกับเต็มรูป) เดือนนี้ <b className="tabular-nums">{baht(summary.tax.vat)}</b> <span className="text-(--ink-soft)">— ให้ฝ่ายบัญชีใช้ขอคืน</span></div>
              )}
              {summary.tax.whtCount > 0 && (
                <div>
                  หัก ณ ที่จ่ายที่บริษัทต้องนำส่ง ({summary.tax.whtCount} รายการ):{" "}
                  {summary.tax.wht3 > 0 && <>ภ.ง.ด.3 <b className="tabular-nums">{baht(summary.tax.wht3)}</b> </>}
                  {summary.tax.wht53 > 0 && <>ภ.ง.ด.53 <b className="tabular-nums">{baht(summary.tax.wht53)}</b> </>}
                  <span className="text-(--ink-soft)">— ยื่นภายในวันที่ 7 เดือนถัดไป (ออนไลน์วันที่ 15) และออก 50 ทวิ ให้ผู้รับเงิน</span>
                </div>
              )}
              {summary.review.pendingCount > 0 && <div className="text-amber-800">ยังรอตรวจ {summary.review.pendingCount} รายการ · {baht(summary.review.pendingAmount)}</div>}
              {summary.review.shortCount > 0 && <div className="text-red-700">เงินขาดรอคืน {summary.review.shortCount} รายการ · {baht(summary.review.shortAmount)}</div>}
            </div>
          )}
          {summary.byCategory.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-(--line) px-4 py-3">
              <div className="text-xs font-semibold text-(--ink-soft)">ซื้อเอง หมดไปกับอะไร</div>
              {summary.byCategory.map((c) => (
                <div key={c.category} className="grid grid-cols-[140px_1fr_80px] items-center gap-2 text-sm">
                  <span className="truncate">{c.category}</span>
                  <span className="h-2 rounded-full bg-(--bg-soft)"><span className="block h-2 rounded-full bg-(--brand-navy,#1b2537)" style={{ width: `${Math.max(4, (c.amount / catMax) * 100)}%` }} /></span>
                  <span className="text-right tabular-nums">{baht(c.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg)">
          <h2 className="flex flex-wrap items-center gap-2 border-b border-(--line) px-4 py-3 text-sm font-bold text-(--ink)">
            <span className="flex items-center">
              ประวัติเงินเข้า-ออก · {monthTitle(month)}{sp.holder ? ` · ${holders.find((h) => h.userId === sp.holder)?.name ?? ""}` : ""}
              <InfoTip label="ประวัติ">
                ทุกครั้งที่เงินสดย่อยเข้าหรือออก — สีเขียว = เงินเข้า, สีแดง = เงินออก · กดชื่อบนการ์ดเพื่อดูเฉพาะคนนั้น · รายการที่ลงผิดกด “ยกเลิก” ได้ (ต้องใส่เหตุผล ประวัติยังเก็บไว้)
              </InfoTip>
            </span>
            {sp.holder && (
              <Link href={qs(month)} className="text-xs font-normal text-(--app-strong) hover:underline">ดูทุกคน</Link>
            )}
          </h2>
          {visibleEntries.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-(--ink-soft)">ไม่มีรายการในเดือนนี้</div>
          ) : (
            <ul className="divide-y divide-(--line)">
              {visibleEntries.map((e) => (
                <li key={e.id} className={`px-4 py-2.5 ${e.voided ? "opacity-55" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <span className="font-semibold text-(--ink)">{KIND_LABEL[e.kind]}</span> · {e.holderName}
                      {e.category && <span className="ml-1.5 rounded-full bg-(--bg-soft) px-2 py-0.5 text-xs text-(--ink-soft)">{e.category}</span>}
                      {e.review && !e.voided && (
                        <span className={`ml-1.5 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${e.review.status === "pending" ? "bg-amber-100 text-amber-900" : e.review.status === "approved" ? "bg-slate-100 text-slate-700" : "bg-red-100 text-red-800"}`}>
                          {e.review.status === "pending" ? "รอตรวจ" : e.review.status === "approved" ? `ผ่าน · ${e.review.byName ?? ""}` : "ไม่ผ่าน · ค้างคืน"}
                        </span>
                      )}
                      {e.requestId && (
                        <>
                          {" · "}
                          <Link href={`/requests/${e.requestId}`} className="text-(--app-strong) hover:underline">{e.requestCode ?? "ดูใบ"}</Link>
                          {e.paidTo && <span className="text-(--ink-soft)"> · จ่ายให้ {e.paidTo}</span>}
                        </>
                      )}
                    </div>
                    <div className={`shrink-0 text-sm font-bold tabular-nums ${e.voided ? "line-through" : e.delta < 0 ? "text-(--danger)" : "text-emerald-700"}`}>
                      {e.delta > 0 ? "+" : ""}
                      {baht(e.delta)}
                    </div>
                  </div>
                  <div className="text-xs text-(--ink-soft)">
                    {thaiDateTime(e.at)} · {e.byName}
                    {e.note ? ` · ${e.note}` : ""}
                    {e.attachments.length > 0 && (
                      <>
                        {" · "}
                        {e.attachments.map((a, i) => (
                          <a key={i} href={fileUrlWithName(a.url, a.name)} target="_blank" rel="noreferrer" title={a.name} className="text-(--app-strong) hover:underline">
                            {/* รูปถ่ายคงเป็นลิงก์ข้อความเหมือนเดิม — หน้านี้โหลดไว้ไม่ต้องดึงรูปทุกแถว */}
                            {a.mime.startsWith("image/") ? (
                              <>หลักฐาน{e.attachments.length > 1 ? ` ${i + 1}` : ""} </>
                            ) : (
                              <DocThumbMini
                                media={{ url: a.url, name: a.name }}
                                className="mr-1 inline-block h-14 w-11 align-middle"
                                fallback={<>หลักฐาน{e.attachments.length > 1 ? ` ${i + 1}` : ""} </>}
                              />
                            )}
                          </a>
                        ))}
                      </>
                    )}
                  </div>
                  {e.tax && <TaxLine tax={e.tax} paid={-e.delta} />}
                  {e.voided && <div className="text-xs font-medium text-red-700">ยกเลิก · {e.voided.byName} · {e.voided.reason}</div>}
                  {!e.voided && !e.requestId && (petty.adjust || (e.holderUserId === session.userId && (!e.review || e.review.status === "pending"))) && <VoidPettyButton id={e.id} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppScaffold>
  );
}
