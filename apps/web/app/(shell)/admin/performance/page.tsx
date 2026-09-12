import { redirect } from "next/navigation";
import { AlertTriangle, ClipboardList, Minus, TrendingDown, TrendingUp, Wrench } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { EmptyState } from "@/modules/admin/components/ui";
import Link from "next/link";
import { buildScorecards } from "@/lib/performance";

/**
 * สรุปผลงานรายคน — รวมคะแนนจากทุกโมดูลไว้ที่เดียว
 *
 * นี่คือหน้าที่ระบบนี้ถูกสร้างมาเพื่อมัน: ผู้บริหารเห็นว่าแต่ละคนเป็นอย่างไร
 * โดยไม่ต้องไล่เปิดทีละโมดูล งานที่ค้างในบอร์ด ใบแจ้งซ่อมที่ปล่อยเลยกำหนด
 * และรอบบำรุงรักษาที่ไม่ได้ทำ ถูกนับรวมเป็นคะแนนเดียวกัน
 *
 * เกณฑ์ทั้งหมด (คะแนนตั้งต้น อัตราหัก เกณฑ์เกรด) ตั้งค่าได้รายบริษัทที่
 * /admin/performance/settings — หน้านี้อ่านค่าที่บริษัทตั้งไว้เสมอ ไม่มีค่าฝังในโค้ด
 *
 * ⚠ เปลี่ยนจากช่วง "N วันล่าสุด" (หน้าต่างเลื่อนไปเรื่อยๆ ที่คาบเกี่ยวสองเดือน
 * ปฏิทินได้) มาเป็น "ทีละเดือนปฏิทิน" ตรงตัว — เพราะคะแนนรายเดือนต้องเทียบกัน
 * ข้ามเดือนได้แน่นอนสำหรับคำนวณโบนัสปลายปี ("เดือนที่แล้วเกรดอะไร เดือนนี้
 * เกรดอะไร") ซึ่งหน้าต่างเลื่อนแบบเดิมตอบไม่ได้ตรงๆ (เจ้าของระบบสั่งแก้ 2569-09-12)
 */
export const dynamic = "force-dynamic";

const TREND_MONTHS = 6;
const THAI_MONTH = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

const SOURCE_META = [
  { key: "report_task", label: "งาน", Icon: ClipboardList, color: "var(--mod-report)" },
  { key: "maintenance", label: "ซ่อมบำรุง", Icon: Wrench, color: "var(--mod-maintenance)" },
  { key: "workforce", label: "ลงเวลา", Icon: AlertTriangle, color: "var(--mod-hr)" },
] as const;

/*
 * สีของเกรดคิดจาก "อันดับ" ไม่ใช่ชื่อ — บริษัทตั้งชื่อเกรดเองได้ (A/B/C หรือ
 * ดีมาก/ดี/พอใช้) ถ้าผูกสีกับตัวอักษรตายตัว เกรดที่ตั้งชื่อเองจะไม่มีสี
 */
function gradeColor(grade: string, order: string[]): string {
  const i = order.indexOf(grade);
  if (i === -1) return "var(--tone-danger)"; // ต่ำกว่าทุกเกณฑ์
  const ratio = order.length <= 1 ? 0 : i / (order.length - 1);
  if (ratio <= 0.34) return "var(--tone-ok)";
  if (ratio <= 0.67) return "var(--tone-warn)";
  return "var(--tone-danger)";
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y!, m! - 1 + delta, 1)));
}
/** ขอบเขตวันของเดือนปฏิทินนั้น — ใช้ UTC ตรงๆ กันเดือนเลื่อนจาก timezone */
function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y!, m! - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y!, m!, 1, 0, 0, 0) - 1);
  return { from, to };
}
function monthDisplay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${THAI_MONTH[m! - 1]} ${y! + 543}`;
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.performanceView)) redirect("/admin");

  const { month: monthParam } = await searchParams;
  const thisRealMonth = monthKey(new Date());
  // เดือนอนาคตยังไม่มีข้อมูลให้ดู — ค่าผิดรูปแบบก็ตกกลับมาเป็นเดือนนี้เงียบๆ
  const month =
    monthParam !== undefined && /^\d{4}-\d{2}$/.test(monthParam) && monthParam <= thisRealMonth
      ? monthParam
      : thisRealMonth;
  const isCurrentMonth = month === thisRealMonth;
  const prevMonthKey = shiftMonth(month, -1);

  // แถบเทรนด์ — เดือนที่เลือกอยู่ขวาสุด ย้อนหลังไป TREND_MONTHS-1 เดือน
  const trendMonths = Array.from({ length: TREND_MONTHS }, (_, i) =>
    shiftMonth(month, -(TREND_MONTHS - 1 - i)),
  );

  const [current, previous, ...trend] = await Promise.all([
    buildScorecards(session.orgId, monthRange(month).from, monthRange(month).to),
    buildScorecards(session.orgId, monthRange(prevMonthKey).from, monthRange(prevMonthKey).to),
    ...trendMonths.map((m) =>
      buildScorecards(session.orgId, monthRange(m).from, monthRange(m).to),
    ),
  ]);

  const { settings, cards } = current;
  const prevByUser = new Map(previous.cards.map((c) => [c.userId, c]));
  const trendByUser = new Map<string, { month: string; grade: string; score: number }[]>();
  trendMonths.forEach((m, i) => {
    for (const c of trend[i]!.cards) {
      const arr = trendByUser.get(c.userId) ?? [];
      arr.push({ month: m, grade: c.grade, score: c.score });
      trendByUser.set(c.userId, arr);
    }
  });

  const needsAttention = cards.filter((c) => c.score < settings.baseScore);
  const gradeOrder = settings.gradeThresholds.map(([g]) => g);
  const canConfigure = hasPermission(session, ADMIN_PERMS.performanceSettingManage);

  return (
    <AppScaffold title="ผลงานรายคน" width="max-w-5xl" backHref="/admin">
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href={`/admin/performance?month=${shiftMonth(month, -1)}`}>
            <Button type="button" variant="outline" size="sm">
              ◀ เดือนก่อน
            </Button>
          </Link>
          <div className="min-w-[150px] text-center">
            <span className="text-base font-bold text-(--ink)">{monthDisplay(month)}</span>
            {isCurrentMonth && (
              <span className="ml-2 rounded-full bg-(--brand-green)/15 px-2 py-0.5 text-[11px] font-semibold text-(--brand-green)">
                เดือนนี้
              </span>
            )}
          </div>
          {isCurrentMonth ? (
            <Button type="button" variant="outline" size="sm" disabled>
              เดือนถัดไป ▶
            </Button>
          ) : (
            <Link href={`/admin/performance?month=${shiftMonth(month, 1)}`}>
              <Button type="button" variant="outline" size="sm">
                เดือนถัดไป ▶
              </Button>
            </Link>
          )}
          {!isCurrentMonth && (
            <Link href="/admin/performance">
              <Button type="button" variant="ghost" size="sm">
                กลับเดือนนี้
              </Button>
            </Link>
          )}
        </div>
      </Card>

      {!settings.enabled && (
        <Card className="mb-3 border-(--tone-warn) p-4 text-sm">
          <span className="font-semibold text-(--tone-warn)">ระบบคะแนนถูกปิดอยู่</span>{" "}
          <span className="text-(--ink-soft)">
            จะไม่มีการบันทึกเหตุการณ์ใหม่ ตัวเลขด้านล่างเป็นของเดิมที่เคยบันทึกไว้
          </span>
        </Card>
      )}

      <p className="mb-3 text-sm text-(--ink-soft)">
        {cards.length} คน ·{" "}
        {needsAttention.length > 0 ? (
          <span className="font-semibold text-(--tone-warn)">
            ต้องติดตาม {needsAttention.length} คน
          </span>
        ) : (
          <span className="text-(--tone-ok)">ยังไม่มีใครถูกหักคะแนน</span>
        )}
      </p>

      {canConfigure && (
        <p className="mb-3 text-sm">
          <Link
            href="/admin/performance/settings"
            className="text-(--brand-green) hover:underline"
          >
            ตั้งค่าเกณฑ์คะแนนของบริษัท →
          </Link>
        </p>
      )}

      {cards.length === 0 ? (
        <EmptyState>ยังไม่มีผู้ใช้งานในบริษัทนี้</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {cards.map((c) => {
            const color = gradeColor(c.grade, gradeOrder);
            const prev = prevByUser.get(c.userId);
            const prevColor = prev ? gradeColor(prev.grade, gradeOrder) : null;
            const delta = prev ? c.score - prev.score : null;
            const history = trendByUser.get(c.userId) ?? [];

            return (
              <Card key={c.userId} className="p-4">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  {/* คะแนน + เกรดเดือนนี้ อยู่ซ้ายสุด อ่านได้ในแวบเดียว */}
                  <div className="flex min-w-[76px] flex-col items-center">
                    <span
                      className="text-2xl leading-none font-bold tabular-nums"
                      style={{ color }}
                    >
                      {c.score}
                    </span>
                    <span
                      className="mt-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{
                        color,
                        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
                      }}
                    >
                      เกรด {c.grade}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-(--ink)">
                      {c.name}
                      {c.userId === session.userId && (
                        <span className="ml-2 text-[11px] font-normal text-(--ink-soft)">
                          (คุณ)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-(--ink-soft)">{c.email}</p>

                    {/* เดือนที่แล้วเทียบเดือนนี้ — ตัวเลขที่ต้องใช้ตอนคิดโบนัสปลายปี */}
                    {prev && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                        <span className="text-(--ink-soft)">{monthDisplay(prevMonthKey)}:</span>
                        <span
                          className="rounded-full px-1.5 py-0.5 font-semibold"
                          style={{
                            color: prevColor!,
                            backgroundColor: `color-mix(in srgb, ${prevColor} 14%, transparent)`,
                          }}
                        >
                          {prev.grade} · {prev.score}
                        </span>
                        {delta !== null && delta !== 0 && (
                          <span
                            className="flex items-center gap-0.5 font-medium"
                            style={{ color: delta > 0 ? "var(--tone-ok)" : "var(--tone-danger)" }}
                          >
                            {delta > 0 ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {delta > 0 ? `+${delta}` : delta}
                          </span>
                        )}
                        {delta === 0 && (
                          <span className="flex items-center gap-0.5 text-(--ink-soft)">
                            <Minus className="h-3 w-3" /> เท่าเดิม
                          </span>
                        )}
                      </p>
                    )}

                    {c.byCategory.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {c.byCategory.slice(0, 4).map((cat) => (
                          <li
                            key={cat.category}
                            className="rounded-full border border-(--line) px-2 py-0.5 text-[11px] text-(--ink-soft)"
                          >
                            {cat.label}{" "}
                            <span className="font-semibold tabular-nums text-(--tone-danger)">
                              {cat.points}
                            </span>
                            {cat.count > 1 && (
                              <span className="text-(--ink-soft)"> ×{cat.count}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* เทรนด์ {TREND_MONTHS} เดือนล่าสุด — ดูรวดเดียวได้ว่าดีขึ้น/แย่ลงต่อเนื่องไหม
                        โดยไม่ต้องกดย้อนทีละเดือน (ใช้ตอนสรุปโบนัสปลายปี) */}
                    {history.length > 0 && (
                      <div className="mt-2 flex items-center gap-1">
                        {trendMonths.map((m) => {
                          const h = history.find((x) => x.month === m);
                          const hColor = h ? gradeColor(h.grade, gradeOrder) : "var(--line)";
                          return (
                            <span
                              key={m}
                              title={h ? `${monthDisplay(m)} · เกรด ${h.grade} · ${h.score} คะแนน` : monthDisplay(m)}
                              className="h-2.5 w-2.5 rounded-sm"
                              style={{ backgroundColor: h ? hColor : "var(--line)" }}
                            />
                          );
                        })}
                        <span className="ml-1 text-[10px] text-(--ink-soft)">
                          {TREND_MONTHS} เดือนล่าสุด
                        </span>
                      </div>
                    )}
                  </div>

                  {/* แยกตามโมดูล — บอกว่าเสียคะแนนมาจากงานฝั่งไหน */}
                  <div className="flex shrink-0 gap-3">
                    {SOURCE_META.map(({ key: src, label: srcLabel, Icon, color: srcColor }) => {
                      const v = c.bySource[src];
                      return (
                        <div key={src} className="flex flex-col items-center gap-0.5">
                          <Icon className="h-3.5 w-3.5" style={{ color: srcColor }} />
                          <span
                            className="text-xs font-semibold tabular-nums"
                            style={{ color: v < 0 ? "var(--tone-danger)" : "var(--ink-soft)" }}
                          >
                            {v === 0 ? "—" : v}
                          </span>
                          <span className="text-[10px] text-(--ink-soft)">{srcLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {c.eventCount === 0 && (
                  <p className="mt-2 text-xs text-(--ink-soft)">
                    ไม่มีเหตุการณ์ที่ถูกบันทึกในเดือนนี้
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-(--ink-soft)">
        คะแนนตั้งต้น {settings.baseScore} แล้วหักตามเหตุการณ์จากทุกโมดูลเฉพาะที่เกิดขึ้นใน{" "}
        {monthDisplay(month)} · คำนวณใหม่ทุกครั้งที่เปิดหน้าจากเหตุการณ์ดิบ ไม่ได้เก็บยอดสะสมไว้
        จึงย้อนดูที่มาได้ทุกแต้ม — แก้เกณฑ์การหักคะแนนแล้วจะไม่กระทบแต้มของเดือนที่ปิดไปแล้ว
        เพราะแต้มถูกตรึงไว้ตอนบันทึกจริง
      </p>
    </AppScaffold>
  );
}
