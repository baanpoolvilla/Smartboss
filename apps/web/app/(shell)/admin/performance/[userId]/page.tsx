import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { EmptyState } from "@/modules/admin/components/ui";
import { buildScorecards, gradeColor, listUserEvents, PERFORMANCE_CATEGORIES } from "@/lib/performance";
import { monthDisplay, monthRange, resolveMonthParam } from "@/lib/performance-month";

/**
 * ที่มาของคะแนนคนหนึ่งคนในเดือนหนึ่งเดือน — ทีละเหตุการณ์พร้อมวันที่
 *
 * เดิมหน้าสรุป (/admin/performance) โชว์แค่ยอดรวมตามหมวด ("ขาดงาน −45 ×9")
 * ผู้บริหารเห็นว่าหักเยอะแต่ตอบไม่ได้ว่าหักวันไหนบ้าง ทำไมถึงหัก — พนักงานเองก็
 * โต้แย้งไม่ได้ว่าครั้งไหนผิดพลาด หน้านี้ไล่คืนจากยอดรวมไปหาเหตุการณ์ดิบทุกอัน
 * ที่ประกอบเป็นยอดนั้น ในช่วงเดือนเดียวกับที่หน้าสรุปกำลังดูอยู่พอดี
 */
export const dynamic = "force-dynamic";

export default async function PerformanceUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.performanceView)) redirect("/admin");

  const { userId } = await params;
  const { month: monthParam } = await searchParams;
  const month = resolveMonthParam(monthParam);
  const { from, to } = monthRange(month);

  const { settings, cards } = await buildScorecards(session.orgId, from, to);
  const card = cards.find((c) => c.userId === userId);
  if (!card) notFound();

  const events = await listUserEvents(session.orgId, userId, { from, to, limit: 300 });
  const gradeOrder = settings.gradeThresholds.map(([g]) => g);
  const color = gradeColor(card.grade, gradeOrder);

  return (
    <AppScaffold
      title={card.name}
      width="max-w-3xl"
      backHref={`/admin/performance?month=${month}`}
    >
      <Link
        href={`/admin/performance?month=${month}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-(--ink-soft) hover:text-(--ink)"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> กลับไปหน้าผลงานรายคน
      </Link>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-[76px] flex-col items-center">
            <span className="text-2xl leading-none font-bold tabular-nums" style={{ color }}>
              {card.score}
            </span>
            <span
              className="mt-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
            >
              เกรด {card.grade}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-(--ink)">{card.name}</p>
            <p className="truncate text-xs text-(--ink-soft)">{card.email}</p>
            <p className="mt-1 text-xs text-(--ink-soft)">
              {monthDisplay(month)} · เริ่มจากคะแนนตั้งต้น {settings.baseScore} ·{" "}
              {card.eventCount === 0 ? "ไม่มีเหตุการณ์" : `${card.eventCount} เหตุการณ์`}
            </p>
          </div>
        </div>
      </Card>

      {events.length === 0 ? (
        <EmptyState>ไม่มีเหตุการณ์ที่ถูกบันทึกในเดือนนี้</EmptyState>
      ) : (
        <div className="flex flex-col gap-1.5">
          {events.map((ev) => {
            const label =
              PERFORMANCE_CATEGORIES[ev.category as keyof typeof PERFORMANCE_CATEGORIES] ??
              ev.category;
            const points = Number(ev.points);
            const workDate = ev.occurredAt.toISOString().slice(0, 10);
            // work_order เชื่อมไปดูใบงานจริงได้ตรงๆ — refType อื่น (attendance_day,
            // pm_schedule, task) ยังไม่มีหน้ารายละเอียดที่ลิงก์ตรงได้ปลอดภัย แต่
            // note ที่บันทึกไว้ตอนหักคะแนนมีรายละเอียดพอที่จะตอบว่า "ทำไม" อยู่แล้ว
            const workOrderHref =
              ev.refType === "work_order" && ev.refId ? `/maintenance/work-orders/${ev.refId}` : null;

            return (
              <Card key={ev.id} className="flex items-center gap-3 p-3">
                <div className="w-24 shrink-0 text-xs text-(--ink-soft)">
                  {new Date(workDate).toLocaleDateString("th-TH", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    calendar: "buddhist",
                  })}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-(--ink)">{label}</p>
                  {ev.note && (
                    <p className="truncate text-xs text-(--ink-soft)" title={ev.note}>
                      {ev.note}
                    </p>
                  )}
                </div>
                <span
                  className="shrink-0 text-sm font-semibold tabular-nums"
                  style={{ color: points < 0 ? "var(--tone-danger)" : "var(--tone-ok)" }}
                >
                  {points > 0 ? `+${points}` : points}
                </span>
                {workOrderHref && (
                  <Link
                    href={workOrderHref}
                    className="shrink-0 text-xs text-(--brand-green) hover:underline"
                  >
                    ดูใบงาน →
                  </Link>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AppScaffold>
  );
}
