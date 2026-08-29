import Link from "next/link";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import {
  DataTable,
  EmptyState,
  NoPermission,
  Pill,
  SectionCard,
  StatCard,
  Td,
} from "@/modules/hr/components/ui";
import { buildScorecards } from "@/lib/performance";

const RANGES = {
  "30": { days: 30, label: "30 วันล่าสุด" },
  "90": { days: 90, label: "90 วันล่าสุด" },
  "365": { days: 365, label: "1 ปีล่าสุด" },
} as const;

type RangeKey = keyof typeof RANGES;

/**
 * สีของเกรดเลือกจาก **อันดับ** ไม่ใช่ตัวอักษร
 *
 * ชื่อเกรดตั้งเองได้รายบริษัท (A-F, ผ่าน/ไม่ผ่าน, ดีมาก/ดี/พอใช้) ถ้าผูกสีกับ "A"
 * ตายตัว เกรดที่ตั้งชื่อเองจะไม่มีสี — ดู docs/performance.md
 */
function toneOfRank(rank: number, total: number): string {
  if (total <= 1) return "var(--tone-ok)";
  const ratio = rank / (total - 1);
  if (ratio <= 0.34) return "var(--tone-ok)";
  if (ratio <= 0.67) return "var(--tone-warn)";
  return "var(--danger)";
}

export default async function HrPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireOrg();
  const { range } = await searchParams;
  const key: RangeKey = range === "90" || range === "365" ? range : "30";

  return (
    <HrPage
      title="ผลงานรายคน"
      permission={ADMIN_PERMS.performanceView}
      width="max-w-4xl"
      load={async () => {
        if (!hasPermission(session, ADMIN_PERMS.performanceView)) {
          return <NoPermission what="ผลงานรายคน" />;
        }

        const to = new Date();
        const from = new Date(to);
        from.setDate(from.getDate() - RANGES[key].days);

        const { settings, cards } = await buildScorecards(session.orgId, from, to);
        const gradeOrder = settings.gradeThresholds.map(([g]) => g);
        const rankOf = (grade: string) => {
          const i = gradeOrder.indexOf(grade);
          return i === -1 ? gradeOrder.length : i;
        };

        const sorted = [...cards].sort((a, b) => a.score - b.score);
        const needsAttention = sorted.filter((c) => c.score < settings.baseScore);
        const canConfigure = hasPermission(
          session,
          ADMIN_PERMS.performanceSettingManage,
        );

        return (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="พนักงาน" value={String(cards.length)} hint="คน" />
              <StatCard
                label="ต้องติดตาม"
                value={String(needsAttention.length)}
                hint={needsAttention.length === 0 ? "ไม่มีเลย" : "คะแนนต่ำกว่าตั้งต้น"}
                tone={
                  needsAttention.length > 0 ? "var(--danger)" : "var(--tone-ok)"
                }
              />
              <StatCard
                label="คะแนนตั้งต้น"
                value={String(settings.baseScore)}
                hint="ทุกคนเริ่มเท่ากัน"
              />
            </div>

            <SectionCard
              title="คะแนนและเกรด"
              description="คิดรวมจากงานซ่อมบำรุง งานในบอร์ด และการลงเวลา — เรียงจากคะแนนน้อยไปมาก"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <form method="GET" className="flex items-center gap-2">
                    <select
                      name="range"
                      defaultValue={key}
                      className="h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-xs"
                    >
                      {Object.entries(RANGES).map(([value, r]) => (
                        <option key={value} value={value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm" variant="outline">
                      ดูข้อมูล
                    </Button>
                  </form>
                  {canConfigure && (
                    <Link href="/admin/performance/settings">
                      <Button size="sm" variant="ghost">
                        ตั้งเกณฑ์
                      </Button>
                    </Link>
                  )}
                </div>
              }
            >
              {cards.length === 0 ? (
                <EmptyState>ยังไม่มีข้อมูลผลงานในช่วงนี้</EmptyState>
              ) : (
                <DataTable head={["พนักงาน", "เกรด", "คะแนน", "เสียคะแนนเพราะ"]}>
                  {sorted.map((card) => (
                    <tr key={card.userId} className="hover:bg-(--bg-soft)">
                      <Td>
                        <span className="font-medium">{card.name}</span>
                        <span className="block truncate text-xs text-(--ink-soft)">
                          {card.email}
                        </span>
                      </Td>
                      <Td>
                        <Pill
                          tone={toneOfRank(rankOf(card.grade), gradeOrder.length + 1)}
                        >
                          {card.grade}
                        </Pill>
                      </Td>
                      <Td align="right" className="font-mono font-medium">
                        {card.score}
                      </Td>
                      <Td>
                        {card.byCategory.length === 0 ? (
                          <span className="text-(--ink-soft)">ไม่มีเลย</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {card.byCategory.slice(0, 3).map((row) => (
                              <span
                                key={row.category}
                                className="rounded-full border border-(--line) px-2 py-0.5 text-[11px] text-(--ink-soft)"
                              >
                                {row.label}{" "}
                                <span style={{ color: "var(--danger)" }}>
                                  {row.points}
                                </span>
                                {row.count > 1 ? ` ×${row.count}` : ""}
                              </span>
                            ))}
                            {card.byCategory.length > 3 && (
                              <span className="px-1 text-[11px] text-(--ink-soft)">
                                +{card.byCategory.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              )}

              <p className="mt-3 text-xs text-(--ink-soft)">
                การแก้เกณฑ์<strong>ไม่ย้อนไปแก้คะแนนเดิม</strong> — แต้มถูกตรึงไว้ตอนบันทึก
                ตั้งใจให้เป็นอย่างนั้น ไม่งั้นการปรับเกณฑ์วันนี้จะเปลี่ยนคะแนนย้อนหลัง
                ของทุกคนโดยไม่มีใครรู้ตัว
              </p>
            </SectionCard>
          </div>
        );
      }}
    />
  );
}
