import { redirect } from "next/navigation";
import { AlertTriangle, ClipboardList, Wrench } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { EmptyState, selectClass } from "@/modules/admin/components/ui";
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
 */
export const dynamic = "force-dynamic";

const RANGES = {
  "30": { days: 30, label: "30 วันล่าสุด" },
  "90": { days: 90, label: "90 วันล่าสุด" },
  "365": { days: 365, label: "1 ปีล่าสุด" },
} as const;

type RangeKey = keyof typeof RANGES;

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

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.performanceView)) redirect("/admin");

  const { range } = await searchParams;
  const key: RangeKey = range === "90" || range === "365" ? range : "30";
  const { days, label } = RANGES[key];

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);

  const { settings, cards } = await buildScorecards(session.orgId, from, to);
  const needsAttention = cards.filter((c) => c.score < settings.baseScore);
  const gradeOrder = settings.gradeThresholds.map(([g]) => g);
  const canConfigure = hasPermission(session, ADMIN_PERMS.performanceSettingManage);

  return (
    <AppScaffold title="ผลงานรายคน" width="max-w-5xl" backHref="/admin">
      <Card className="mb-4 p-4">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">ช่วงเวลา</span>
            <select name="range" defaultValue={key} className={selectClass}>
              {Object.entries(RANGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" className="w-full sm:w-28">
            ดูข้อมูล
          </Button>
        </form>
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
        {label} · {cards.length} คน ·{" "}
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
            const lost = settings.baseScore - c.score;
            return (
              <Card key={c.userId} className="p-4">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  {/* คะแนน + เกรด อยู่ซ้ายสุด อ่านได้ในแวบเดียว */}
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
                  </div>

                  {/* แยกตามโมดูล — บอกว่าเสียคะแนนมาจากงานฝั่งไหน */}
                  <div className="flex shrink-0 gap-3">
                    {SOURCE_META.map(({ key: src, label: srcLabel, Icon, color }) => {
                      const v = c.bySource[src];
                      return (
                        <div key={src} className="flex flex-col items-center gap-0.5">
                          <Icon className="h-3.5 w-3.5" style={{ color }} />
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

                {lost === 0 && c.eventCount === 0 && (
                  <p className="mt-2 text-xs text-(--ink-soft)">
                    ไม่มีเหตุการณ์ที่ถูกบันทึกในช่วงนี้
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-(--ink-soft)">
        คะแนนตั้งต้น {settings.baseScore} แล้วหักตามเหตุการณ์จากทุกโมดูล · คำนวณใหม่ทุกครั้งที่เปิดหน้า
        ไม่ได้เก็บยอดสะสมไว้ จึงย้อนดูที่มาได้ทุกแต้ม
      </p>
    </AppScaffold>
  );
}
