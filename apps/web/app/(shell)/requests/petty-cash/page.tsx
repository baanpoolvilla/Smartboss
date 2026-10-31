import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@smartboss/database";
import { hasPermission } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { InfoTip } from "@/modules/salary/components/help";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";
import { pettyBalances, toPetty, toPettyTopup, withRequestsTenant } from "@/modules/requests/lib/db";
import { listPettyHolders } from "@/modules/requests/lib/holders";
import { pettyAccess, requestsPage } from "@/modules/requests/lib/page";
import { PendingTopupRow, PettyHolderCard, PettyHoldersButton, VoidPettyButton } from "@/modules/requests/components/petty-forms";
import { bangkokToday, baht, thaiDateTime } from "@/modules/requests/lib/types";

export const dynamic = "force-dynamic";

const KIND_LABEL = { top_up: "รับเงินเติม", spend: "จ่ายค่าของ", return: "รับเงินทอนคืน", adjust: "ปรับยอด (นับเงินจริง)" } as const;

/**
 * เงินสดย่อย — แอดมิน/HR แต่ละคนถือเงินก้อนของตัวเอง ยอดคงเหลือ = เติม + รับคืน − จ่าย ± ปรับ
 * จ่ายออกเกิดตอนบันทึกจ่ายคำขอแบบ "เงินสดย่อย" หรือผู้ถือกด "จ่ายค่าของ" เอง · รับคืนเกิดตอน HR ตรวจเคลียร์ที่มีเงินทอน
 *
 * ผู้ใช้ 30/10/2569: ปุ่มอยู่บนการ์ดของแต่ละคน + ⓘ อธิบาย · ผู้ถือขอเติมเอง → HR/CEO อนุมัติ (ไม่อนุมัติของตัวเอง,
 * HR ขอเอง = CEO) · บัญชีผู้ดูแลระบบสูงสุด (SUPER_ADMIN) ไม่ใช่คนถือเงินจริง ไม่ขึ้นการ์ด
 * 31/10/2569: ใครเห็น/เติม/ปรับยอด ใช้สิทธิ์เงินสดย่อยแยก (REQ_PERMS.petty*) ไม่ผูกกับสิทธิ์ใบเบิกแล้ว
 *             ใครถือเงิน = HR/CEO ติ๊กรายคนที่ปุ่ม "ตั้งคนถือเงิน" บนหน้านี้ (lib/holders.ts)
 */
export default async function PettyCashPage({ searchParams }: { searchParams: Promise<{ holder?: string }> }) {
  const { session, viewer } = await requestsPage();
  // HR/CEO ที่ไม่ได้ถือเงินเองก็ต้องเข้ามาอนุมัติคำขอเติม/เติมเงินให้คนอื่นได้
  const petty = pettyAccess(session);
  const canTopUp = petty.topUp;
  if (!viewer.isPettyHolder && !petty.view && !petty.topUp && !petty.adjust) redirect("/requests");
  const orgId = session.orgId;
  const sp = await searchParams;
  const holderUsers = await listPettyHolders(orgId);
  const { balances, entries, pending } = await withRequestsTenant(orgId, async (tx) => ({
    balances: await pettyBalances(tx, orgId),
    entries: (await tx.moneyPettyCashEntry.findMany({ where: { orgId, ...(sp.holder ? { holderUserId: sp.holder } : {}) }, orderBy: { createdAt: "desc" }, take: 300 })).map(toPetty),
    pending: (await tx.moneyPettyTopup.findMany({ where: { orgId, status: "pending" }, orderBy: { createdAt: "asc" } })).map(toPettyTopup),
  }));
  const seesAll = petty.view || petty.topUp || petty.adjust;
  const holders = holderUsers.map((u) => ({ userId: u.id, name: u.name, balance: balances.get(u.id) ?? 0 }));
  // ของตัวเองขึ้นก่อน
  const visibleHolders = (seesAll ? holders : holders.filter((h) => h.userId === session.userId)).sort((a, b) => Number(b.userId === session.userId) - Number(a.userId === session.userId));
  const visiblePending = seesAll ? pending : pending.filter((p) => p.holderUserId === session.userId);
  const visibleEntries = seesAll ? entries : entries.filter((e) => e.holderUserId === session.userId);
  const total = holders.reduce((s, h) => s + h.balance, 0);
  const today = bangkokToday();
  const requestIds = [...new Set(visibleEntries.map((e) => e.requestId).filter((x): x is string => !!x))];
  const codes = requestIds.length
    ? new Map((await withRequestsTenant(orgId, (tx) => tx.moneyRequest.findMany({ where: { orgId, id: { in: requestIds } }, select: { id: true, code: true } }))).map((r) => [r.id, r.code]))
    : new Map<string, string>();
  // ตั้งคนถือเงิน: HR/CEO — รายชื่อให้ติ๊ก = ทุกคนที่ยังใช้งานอยู่ ยกเว้นคนงานรายวัน
  const canSetHolders = canTopUp || hasPermission(session, REQ_PERMS.settings);
  const people = canSetHolders
    ? await prisma.user.findMany({
        where: { orgId, isActive: true, roles: { none: { role: { code: WORKER_ROLE_CODE } } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  const canDecide = (p: (typeof pending)[number]) => canTopUp && p.holderUserId !== session.userId && p.requestedByUserId !== session.userId && (!p.needsCeo || viewer.canApproveCeo);

  return (
    <AppScaffold title="เงินสดย่อย" backHref="/requests" width="max-w-6xl">
      <div className="flex flex-col gap-4">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) px-4 py-3">
          <p className="flex items-center text-sm text-(--ink)">
            เงินสดที่บริษัทให้แต่ละคนถือไว้จ่ายค่าของเล็ก ๆ น้อย ๆ
            <InfoTip label="เงินสดย่อยคืออะไร" title="เงินสดย่อยใช้ยังไง">
              <b>1. ได้เงินมาถือ</b> — HR/CEO กด “เติมเงินให้” หรือผู้ถือกด “ขอเติมเงิน” แล้วรออนุมัติ (ทุกครั้งต้องแนบสลิปโอน/รูปเงินสด)
              <br />
              <b>2. ใช้จ่าย</b> — ซื้อของ/จ่ายค่าบริการแล้วกด “จ่ายค่าของ” บนการ์ดของตัวเอง บอกว่าค่าอะไร เลือกหมวด แนบใบเสร็จ
              <br />
              <b>3. เงินใกล้หมด</b> — กด “ขอเติมเงิน” อีกรอบ
              <br />
              <br />
              ใบเบิกที่ HR เลือก “จ่ายจากเงินสดย่อย” จะหักยอดของคนที่จ่ายให้เองอัตโนมัติ · ไม่มีใครอนุมัติคำขอเติมของตัวเองได้ (HR ขอ = CEO อนุมัติ)
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
                ผู้ถือเงินขอเติมเงินสดย่อยของตัวเอง — HR หรือ CEO ให้เงิน (โอน/เงินสด) แล้วกด “อนุมัติ + แนบสลิป” ยอดถึงจะเพิ่ม · อนุมัติของตัวเองไม่ได้ · คำขอของ HR ต้องให้ CEO อนุมัติ
              </InfoTip>
            </h2>
            <ul className="divide-y divide-(--line)">
              {visiblePending.map((p) => (
                <PendingTopupRow key={p.id} item={p} canDecide={canDecide(p)} isMine={p.requestedByUserId === session.userId} waitingFor={p.needsCeo ? "CEO" : "HR หรือ CEO"} today={today} />
              ))}
            </ul>
          </section>
        )}

        {visibleHolders.length === 0 ? (
          <div className="rounded-(--radius-lg) border border-dashed border-(--line) p-6 text-center text-sm text-(--ink-soft)">ยังไม่มีใครถือเงินสดย่อย — HR/CEO กด &quot;ตั้งคนถือเงิน&quot; ด้านบน</div>
        ) : (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleHolders.map((h) => {
              const isMe = h.userId === session.userId;
              return (
                <PettyHolderCard
                  key={h.userId}
                  holder={h}
                  isMe={isMe && viewer.isPettyHolder}
                  canTopUp={canTopUp}
                  canAdjust={isMe || petty.adjust}
                  pendingMine={pending.some((p) => p.holderUserId === h.userId)}
                  today={today}
                  selected={sp.holder === h.userId}
                  href={sp.holder === h.userId ? "/requests/petty-cash" : `?holder=${h.userId}`}
                />
              );
            })}
          </section>
        )}

        <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg)">
          <h2 className="flex flex-wrap items-center gap-2 border-b border-(--line) px-4 py-3 text-sm font-bold text-(--ink)">
            <span className="flex items-center">
              ประวัติเงินเข้า-ออก{sp.holder ? ` · ${holders.find((h) => h.userId === sp.holder)?.name ?? ""}` : ""}
              <InfoTip label="ประวัติ">
                ทุกครั้งที่เงินสดย่อยเข้าหรือออก — สีเขียว = เงินเข้า, สีแดง = เงินออก · กดชื่อบนการ์ดเพื่อดูเฉพาะคนนั้น · รายการที่ลงผิดกด “ยกเลิก” ได้ (ต้องใส่เหตุผล ประวัติยังเก็บไว้)
              </InfoTip>
            </span>
            {sp.holder && (
              <Link href="/requests/petty-cash" className="text-xs font-normal text-(--app-strong) hover:underline">ดูทุกคน</Link>
            )}
          </h2>
          {visibleEntries.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-(--ink-soft)">ยังไม่มีรายการ — เริ่มจากกด “เติมเงินให้” หรือ “ขอเติมเงิน” บนการ์ดด้านบน</div>
          ) : (
            <ul className="divide-y divide-(--line)">
              {visibleEntries.map((e) => (
                <li key={e.id} className={`px-4 py-2.5 ${e.voided ? "opacity-55" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <span className="font-semibold text-(--ink)">{KIND_LABEL[e.kind]}</span> · {e.holderName}
                      {e.category && <span className="ml-1.5 rounded-full bg-(--bg-soft) px-2 py-0.5 text-xs text-(--ink-soft)">{e.category}</span>}
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
                  {!e.voided && !e.requestId && (petty.adjust || e.holderUserId === session.userId) && <VoidPettyButton id={e.id} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppScaffold>
  );
}
