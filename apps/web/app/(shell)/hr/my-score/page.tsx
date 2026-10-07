import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrg } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { EmptyState } from "@/modules/hr/components/ui";
import { buildScorecards, buildUserMonthlyScores, gradeColor, listUserEvents } from "@/lib/performance";
import { hasBreakdown, ScoreBreakdown } from "@/components/performance/score-breakdown";
import { buildMyEventDetails } from "@/lib/performance-details";
import { monthDisplay, monthKey, monthRange, resolveMonthParam, shiftMonth } from "@/lib/performance-month";
import { MissedReportsList } from "./missed-reports-list";

/**
 * "คะแนนของฉัน" — ทุกคนเข้าได้ (HR_PERMS.access เดียวกับเมนู "ของฉัน")
 *
 * ต่างจากหน้า "คะแนน & เกรด" ของทั้งบริษัท (/hr/employees?tab=score,
 * core.performance.view — ADMIN/CEO/MANAGER เท่านั้น) ตรงที่หน้านี้เห็นได้
 * ทุกคนแต่เห็นแค่แถวของตัวเอง — เดิมพนักงานทั่วไปยื่นคำร้องขอแก้ไขคะแนนไม่ได้
 * เลยด้วยซ้ำ เพราะเข้าหน้าคะแนนรวมไม่ได้ตั้งแต่แรก
 *
 * ?month=YYYY-MM ดูเดือนย้อนหลังได้ (ผิดรูปแบบ/เดือนอนาคต ตกเป็นเดือนนี้) + ตาราง
 * ย้อนหลัง 12 เดือนท้ายหน้า กดแถวไหนก็เปิดเดือนนั้น
 */
const MONTHS_BACK = 12;

export default async function MyScorePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  return (
    <HrPage
      title="คะแนนของฉัน"
      permission={HR_PERMS.access}
      width="max-w-2xl"
      load={async () => {
        const session = await requireOrg();
        // เดือนนี้ (1 ถึงสิ้นเดือน) ตรงกับเกรด/ค่าคอมที่ตัดรอบรายเดือน — เดิม 30 วันล่าสุด วันที่ 1
        // คะแนนเลยไม่เริ่มใหม่ ยังเห็นที่โดนหักปลายเดือนก่อน
        const thisMonth = monthKey(new Date());
        const month = resolveMonthParam(sp.month);
        const { from, to } = monthRange(month);
        const history = Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonth(thisMonth, -i));

        const [{ settings, cards }, monthly] = await Promise.all([
          buildScorecards(session.orgId, from, to),
          buildUserMonthlyScores(session.orgId, session.userId, history),
        ]);
        const card = cards.find((c) => c.userId === session.userId);
        const gradeOrder = settings.gradeThresholds.map(([g]) => g);

        const monthNav = (
          <div className="flex items-center justify-between gap-2">
            <Link
              prefetch={false}
              href={`/hr/my-score?month=${shiftMonth(month, -1)}`}
              className="inline-flex h-9 items-center gap-1 rounded-(--radius) border border-(--line) bg-white px-3 text-sm text-(--ink) hover:bg-(--bg-soft)"
            >
              <ChevronLeft className="h-4 w-4" /> เดือนก่อน
            </Link>
            <p className="text-sm font-semibold text-(--ink)">
              {month === thisMonth ? `เดือนนี้ (${monthDisplay(month)})` : monthDisplay(month)}
            </p>
            {month < thisMonth ? (
              <Link
                prefetch={false}
                href={shiftMonth(month, 1) === thisMonth ? "/hr/my-score" : `/hr/my-score?month=${shiftMonth(month, 1)}`}
                className="inline-flex h-9 items-center gap-1 rounded-(--radius) border border-(--line) bg-white px-3 text-sm text-(--ink) hover:bg-(--bg-soft)"
              >
                เดือนถัดไป <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center gap-1 rounded-(--radius) border border-(--line) px-3 text-sm text-(--ink-soft) opacity-50">
                เดือนถัดไป <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        );

        // ย้อนหลัง 12 เดือน — กดแถวไหนก็เปิดเดือนนั้นด้านบน
        const historyCard = (
          <div className="rounded-2xl border border-(--line) bg-white p-5">
            <p className="text-sm font-semibold text-(--ink)">คะแนนย้อนหลัง</p>
            <p className="mb-3 text-xs text-(--ink-soft)">{MONTHS_BACK} เดือนล่าสุด · กดเดือนไหนเพื่อดูรายละเอียดเดือนนั้น</p>
            <div className="flex flex-col">
              {monthly.map((m) => {
                const active = m.month === month;
                const pct = m.score === null ? 0 : Math.max(0, Math.min(100, (m.score / settings.baseScore) * 100));
                const tone = m.grade ? gradeColor(m.grade, gradeOrder) : "var(--line)";
                return (
                  <Link
                    key={m.month}
                    prefetch={false}
                    href={m.month === thisMonth ? "/hr/my-score" : `/hr/my-score?month=${m.month}`}
                    className={`grid grid-cols-[6.5rem_1fr_3rem_3.5rem] items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-(--bg-soft) ${active ? "bg-(--bg-soft) font-semibold" : ""}`}
                  >
                    <span className="text-(--ink)">{monthDisplay(m.month)}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-(--bg-soft)">
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: tone }} />
                    </span>
                    <span className="text-right tabular-nums text-(--ink)">{m.score ?? "–"}</span>
                    <span className="text-right text-xs font-bold" style={{ color: m.grade ? tone : "var(--ink-soft)" }}>
                      {m.grade ? `เกรด ${m.grade}` : "ยังไม่นับ"}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        );

        if (!card) {
          return (
            <div className="flex flex-col gap-4">
              {monthNav}
              <EmptyState>ยังไม่มีข้อมูลคะแนนผลงานของเดือน {monthDisplay(month)}</EmptyState>
              {historyCard}
            </div>
          );
        }
        // ช่วงเดียวกับที่คิดคะแนนเดือนนี้ — จำนวนในแต่ละหมวดกับรายการข้างในจึงตรงกัน
        // ดึงเสมอ (ไม่ใช่แค่ตอนมีหมวดที่ติดลบ) — หมวดที่ได้คืนคะแนนหมดแล้วยังต้องเห็นว่า "คืนแล้ว"
        const events = await listUserEvents(session.orgId, session.userId, { from, to, limit: 1000 });
        const details = await buildMyEventDetails(session.orgId, events);

        return (
          <div className="flex flex-col gap-4">
            {monthNav}
            <div className="rounded-2xl border border-(--line) bg-white p-5">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-(--ink-soft)">คะแนนของคุณ เดือน {monthDisplay(month)}</p>
                  <p className="mt-1 text-3xl font-bold text-(--ink)">{card.score}</p>
                </div>
                <span className="rounded-full bg-(--bg-soft) px-3 py-1 text-sm font-bold text-(--ink)">
                  เกรด {card.grade}
                </span>
              </div>
              <p className="mt-2 text-xs text-(--ink-soft)">คะแนนตั้งต้น {settings.baseScore} ทุกคนเริ่มใหม่ทุกวันที่ 1</p>
            </div>

            <div className="rounded-2xl border border-(--line) bg-white p-5">
              <p className="mb-3 text-sm font-semibold text-(--ink)">เสียคะแนนเพราะ</p>
              {!hasBreakdown(card.byCategory, events) ? (
                <p className="text-sm text-(--ink-soft)">ไม่มีเลย — คะแนนเต็มอยู่</p>
              ) : (
                <>
                  <p className="-mt-2 mb-3 text-xs text-(--ink-soft)">กดหมวดเพื่อดูวันที่ แล้วกดรายการเพื่อดูว่าหักจากอะไร</p>
                  <ScoreBreakdown rows={card.byCategory} events={events} details={details} />
                </>
              )}
            </div>

            <div className="rounded-2xl border border-(--line) bg-white p-5">
              <p className="text-sm font-semibold text-(--ink)">รายงานที่พลาด/ส่งช้า</p>
              <p className="mb-3 text-xs text-(--ink-soft)">
                คิดว่าถูกหักคะแนนผิด หรือมีเหตุสุดวิสัย (ป่วยกะทันหัน ระบบขัดข้อง) — กด &quot;ขอแก้ไข&quot;
                ที่แถวนั้นเพื่อยื่นให้ CEO พิจารณาได้เลย
              </p>
              <MissedReportsList userId={card.userId} />
            </div>

            {historyCard}
          </div>
        );
      }}
    />
  );
}
