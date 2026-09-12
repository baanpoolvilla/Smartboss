import Link from "next/link";
import type { OrgSession } from "@smartboss/auth";
import { hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
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

/** แท็บ "คะแนน & เกรด" ของหน้าพนักงาน — เดิมคือหน้า /hr/performance */
export async function renderScoreTab(
  session: OrgSession,
  rangeParam: string | undefined,
): Promise<React.ReactNode> {
  if (!hasPermission(session, ADMIN_PERMS.performanceView)) {
    return <NoPermission what="คะแนน & เกรด" />;
  }

  const key: RangeKey = rangeParam === "90" || rangeParam === "365" ? rangeParam : "30";
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
  const canConfigure = hasPermission(session, ADMIN_PERMS.performanceSettingManage);

  // เกณฑ์อาจตั้งเข้มเกินไปถ้าคนส่วนใหญ่ได้เกรดต่ำสุดหรือมีคะแนนติดลบ — สิ่งที่
  // ควรเห็นตั้งแต่เปิดหน้า ไม่ใช่ต้องไล่นับเองจากตาราง (สเปคข้อ 4.6)
  const fCount = cards.filter((c) => c.grade === "F").length;
  const negativeCount = cards.filter((c) => c.score < 0).length;
  const criteriaLooksStrict = cards.length > 0 && (fCount / cards.length > 0.5 || negativeCount > 0);

  return (
    <div className="flex flex-col gap-4">
      {criteriaLooksStrict && (
        <div className="flex flex-wrap items-start gap-3 rounded-(--radius-lg) border border-(--tone-warn)/35 bg-(--tone-warn)/10 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-(--ink)">เกณฑ์คะแนนอาจตั้งไว้เข้มเกินไป</p>
            <p className="mt-0.5 text-sm text-(--ink-soft)">
              พนักงาน {fCount} จาก {cards.length} คนได้เกรด F
              {negativeCount > 0 ? ` และมี ${negativeCount} คนคะแนนติดลบ` : ""} — ลองทบทวนตัวคูณการหักคะแนนดู
            </p>
          </div>
          {canConfigure && (
            <Link href="/admin/performance/settings">
              <Button size="sm" variant="outline">ทบทวนเกณฑ์</Button>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="พนักงาน" value={String(cards.length)} hint="คน" />
        <StatCard
          label="ต้องติดตาม"
          value={String(needsAttention.length)}
          hint={needsAttention.length === 0 ? "ไม่มีเลย" : "คะแนนต่ำกว่าตั้งต้น"}
          tone={needsAttention.length > 0 ? "var(--danger)" : "var(--tone-ok)"}
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
            <form method="GET" action="/hr/employees" className="flex items-center gap-2">
              <input type="hidden" name="tab" value="score" />
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
                  <Pill tone={toneOfRank(rankOf(card.grade), gradeOrder.length + 1)}>
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
                          <span style={{ color: "var(--danger)" }}>{row.points}</span>
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
}
