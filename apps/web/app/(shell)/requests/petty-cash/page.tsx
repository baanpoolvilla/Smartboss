import Link from "next/link";
import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { pettyBalances, toPetty, withRequestsTenant } from "@/modules/requests/lib/db";
import { requestsPage } from "@/modules/requests/lib/page";
import { PettyEntryForm, VoidPettyButton } from "@/modules/requests/components/petty-forms";
import { bangkokToday, baht, thaiDateTime } from "@/modules/requests/lib/types";

export const dynamic = "force-dynamic";

const KIND_LABEL = { top_up: "เติมเงิน", spend: "จ่ายออก", return: "รับเงินทอนคืน", adjust: "ปรับยอด" } as const;

/**
 * เงินสดย่อย — แอดมิน/HR แต่ละคนถือเงินก้อนของตัวเอง ยอดคงเหลือ = เติม + รับคืน − จ่าย ± ปรับ
 * จ่ายออกเกิดเองตอนบันทึกจ่ายคำขอแบบ "เงินสดย่อย" · รับคืนเกิดตอน HR ตรวจเคลียร์ที่มีเงินทอน
 */
export default async function PettyCashPage({ searchParams }: { searchParams: Promise<{ holder?: string }> }) {
  const { session, viewer } = await requestsPage(REQ_PERMS.pettyCash);
  const orgId = session.orgId;
  const sp = await searchParams;
  const holderUsers = await prisma.user.findMany({
    where: { orgId, isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: REQ_PERMS.pettyCash } } } } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const { balances, entries } = await withRequestsTenant(orgId, async (tx) => ({
    balances: await pettyBalances(tx, orgId),
    entries: (await tx.moneyPettyCashEntry.findMany({ where: { orgId, ...(sp.holder ? { holderUserId: sp.holder } : {}) }, orderBy: { createdAt: "desc" }, take: 300 })).map(toPetty),
  }));
  const holders = holderUsers.map((u) => ({ userId: u.id, name: u.name, balance: balances.get(u.id) ?? 0 }));
  const visibleHolders = viewer.canPay ? holders : holders.filter((h) => h.userId === session.userId);
  const total = holders.reduce((s, h) => s + h.balance, 0);
  const requestIds = [...new Set(entries.map((e) => e.requestId).filter((x): x is string => !!x))];
  const codes = requestIds.length
    ? new Map((await withRequestsTenant(orgId, (tx) => tx.moneyRequest.findMany({ where: { orgId, id: { in: requestIds } }, select: { id: true, code: true } }))).map((r) => [r.id, r.code]))
    : new Map<string, string>();

  return (
    <AppScaffold title="เงินสดย่อย" backHref="/requests" width="max-w-5xl">
      <div className="flex flex-col gap-4">
        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {holders.map((h) => (
            <Link key={h.userId} href={sp.holder === h.userId ? "/requests/petty-cash" : `?holder=${h.userId}`} className={`rounded-(--radius-lg) border bg-(--bg) p-3.5 hover:bg-(--bg-soft) ${sp.holder === h.userId ? "border-2 border-(--brand-navy)" : "border-(--line)"}`}>
              <div className="truncate text-xs text-(--ink-soft)">{h.name}</div>
              <div className={`mt-0.5 text-xl font-bold tabular-nums ${h.balance < 0 ? "text-(--danger)" : "text-(--ink)"}`}>{baht(h.balance)}</div>
            </Link>
          ))}
          {holders.length > 1 && (
            <div className="rounded-(--radius-lg) border border-dashed border-(--line) bg-(--bg) p-3.5">
              <div className="text-xs text-(--ink-soft)">รวมทุกคน</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-(--ink)">{baht(total)}</div>
            </div>
          )}
        </section>
        {holders.length === 0 && <div className="rounded-(--radius-lg) border border-dashed border-(--line) p-6 text-center text-sm text-(--ink-soft)">ยังไม่มีใครถือเงินสดย่อย — ให้สิทธิ์ &quot;ถือเงินสดย่อย&quot; ที่ /admin/roles</div>}

        <div className="flex flex-wrap items-start gap-4">
          <section className="min-w-0 flex-[999_1_480px] rounded-(--radius-lg) border border-(--line) bg-(--bg)">
            <h2 className="border-b border-(--line) px-4 py-3 text-sm font-bold text-(--ink)">ประวัติ{sp.holder ? ` · ${holders.find((h) => h.userId === sp.holder)?.name ?? ""}` : ""}</h2>
            {entries.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-(--ink-soft)">ยังไม่มีรายการ</div>
            ) : (
              <ul className="divide-y divide-(--line)">
                {entries.map((e) => (
                  <li key={e.id} className={`px-4 py-2.5 ${e.voided ? "opacity-55" : ""}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0 text-sm">
                        <span className="font-semibold text-(--ink)">{KIND_LABEL[e.kind]}</span> · {e.holderName}
                        {e.requestId && (
                          <>
                            {" · "}
                            <Link href={`/requests/${e.requestId}`} className="text-(--app-strong) hover:underline">{codes.get(e.requestId) ?? "ดูใบ"}</Link>
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
                            <a key={i} href={a.url} target="_blank" rel="noreferrer" className="text-(--app-strong) hover:underline">หลักฐาน{e.attachments.length > 1 ? ` ${i + 1}` : ""} </a>
                          ))}
                        </>
                      )}
                    </div>
                    {e.voided && <div className="text-xs font-medium text-red-700">ยกเลิก · {e.voided.byName} · {e.voided.reason}</div>}
                    {!e.voided && !e.requestId && (viewer.canPay || e.holderUserId === session.userId) && <VoidPettyButton id={e.id} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {visibleHolders.length > 0 && (
            <div className="min-w-0 flex-[1_1_300px]">
              <PettyEntryForm holders={visibleHolders} defaultHolder={visibleHolders.find((h) => h.userId === session.userId)?.userId ?? visibleHolders[0]!.userId} today={bangkokToday()} />
            </div>
          )}
        </div>
      </div>
    </AppScaffold>
  );
}
