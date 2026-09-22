import { requireOrg } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { EmptyState } from "@/modules/hr/components/ui";
import { buildScorecards } from "@/lib/performance";
import { MissedReportsList } from "./missed-reports-list";

/**
 * "คะแนนของฉัน" — ทุกคนเข้าได้ (HR_PERMS.access เดียวกับเมนู "ของฉัน")
 *
 * ต่างจากหน้า "คะแนน & เกรด" ของทั้งบริษัท (/hr/employees?tab=score,
 * core.performance.view — ADMIN/CEO/MANAGER เท่านั้น) ตรงที่หน้านี้เห็นได้
 * ทุกคนแต่เห็นแค่แถวของตัวเอง — เดิมพนักงานทั่วไปยื่นคำร้องขอแก้ไขคะแนนไม่ได้
 * เลยด้วยซ้ำ เพราะเข้าหน้าคะแนนรวมไม่ได้ตั้งแต่แรก
 */
export default async function MyScorePage() {
  return (
    <HrPage
      title="คะแนนของฉัน"
      permission={HR_PERMS.access}
      width="max-w-2xl"
      load={async () => {
        const session = await requireOrg();
        const to = new Date();
        const from = new Date(to);
        from.setDate(from.getDate() - 30);

        const { settings, cards } = await buildScorecards(session.orgId, from, to);
        const card = cards.find((c) => c.userId === session.userId);

        if (!card) {
          return <EmptyState>ยังไม่มีข้อมูลคะแนนผลงานในช่วง 30 วันล่าสุด</EmptyState>;
        }

        return (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-(--line) bg-white p-5">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-(--ink-soft)">คะแนนของคุณ (30 วันล่าสุด)</p>
                  <p className="mt-1 text-3xl font-bold text-(--ink)">{card.score}</p>
                </div>
                <span className="rounded-full bg-(--bg-soft) px-3 py-1 text-sm font-bold text-(--ink)">
                  เกรด {card.grade}
                </span>
              </div>
              <p className="mt-2 text-xs text-(--ink-soft)">คะแนนตั้งต้น {settings.baseScore} ทุกคนเริ่มเท่ากัน</p>
            </div>

            <div className="rounded-2xl border border-(--line) bg-white p-5">
              <p className="mb-3 text-sm font-semibold text-(--ink)">เสียคะแนนเพราะ</p>
              {card.byCategory.length === 0 ? (
                <p className="text-sm text-(--ink-soft)">ไม่มีเลย — คะแนนเต็มอยู่</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {card.byCategory.map((row) => (
                    <span
                      key={row.category}
                      className="rounded-full border border-(--line) px-2.5 py-1 text-xs text-(--ink-soft)"
                    >
                      {row.label} <span style={{ color: "var(--danger)" }}>{row.points}</span>
                      {row.count > 1 ? ` ×${row.count}` : ""}
                    </span>
                  ))}
                </div>
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
          </div>
        );
      }}
    />
  );
}
