import Link from "next/link";
import { AlarmClock, CalendarClock, TrendingDown } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";

import type { ScoreWatch, ScoreWatchItem } from "@/modules/maintenance/data/score-watch";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";

/**
 * ส่วน "ใบงานที่มีผลกับคะแนน" บนแดชบอร์ดแจ้งซ่อม — เลยกำหนด (กำลังโดนหัก) + ใกล้ครบกำหนด
 * (ปิดก่อนโดนหัก) + คะแนนที่โดนหักเดือนนี้ · ข้อมูลจาก data/score-watch.ts
 */

/** ห่างจากวันนี้กี่วัน ตามวันที่ไทย (ติดลบ = เลยมาแล้ว) */
function dayDiff(due: Date): number {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  return Math.round((Date.parse(day(due)) - Date.parse(day(new Date()))) / 86_400_000);
}

function dueLabel(due: Date): string {
  const n = dayDiff(due);
  if (n < 0) return `เลย ${-n} วัน`;
  if (n === 0) return "วันนี้";
  if (n === 1) return "พรุ่งนี้";
  return `อีก ${n} วัน`;
}

function Row({ item, late }: { item: ScoreWatchItem; late: boolean }) {
  return (
    <Link
      href={`/maintenance/work-orders/${item.id}`}
      className="block border-t border-(--line) first:border-t-0"
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-(--bg-soft)">
        <span className="shrink-0 rounded-md bg-[#E6F6F4] px-1.5 py-0.5 text-[11px] font-medium text-[#0F766E]">
          {item.code}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-(--ink)">{item.title}</p>
          <p className="truncate text-xs text-(--ink-soft)">
            {[item.place, item.responsibleName, `ครบกำหนด ${fmtThaiDate(item.dueDate)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={late ? { background: "#FEF2F2", color: "#DC2626" } : { background: "#FFF7E6", color: "#B45309" }}
        >
          {dueLabel(item.dueDate)}
        </span>
        {late && item.docked !== null && (
          <span className="w-7 shrink-0 text-right text-xs font-semibold tabular-nums text-[#DC2626]">
            −{Math.abs(item.docked)}
          </span>
        )}
      </div>
    </Link>
  );
}

function ListCard({
  title,
  Icon,
  color,
  count,
  items,
  late,
  empty,
}: {
  title: string;
  Icon: typeof AlarmClock;
  color: string;
  count: number;
  items: ScoreWatchItem[];
  late: boolean;
  empty: string;
}) {
  return (
    <Card className="min-w-0 overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-(--line) px-3 py-2.5">
        <Icon className="h-4 w-4" style={{ color }} />
        <p className="flex-1 text-sm font-semibold text-(--ink)">{title}</p>
        <span className="text-lg font-bold tabular-nums" style={{ color }}>
          {count}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-5 text-center text-sm text-(--ink-soft)">{empty}</p>
      ) : (
        <div>
          {items.map((it) => (
            <Row key={it.id} item={it} late={late} />
          ))}
          {count > items.length && (
            <p className="border-t border-(--line) px-3 py-2 text-xs text-(--ink-soft)">และอีก {count - items.length} ใบ</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function ScoreWatchSection({ data }: { data: ScoreWatch }) {
  return (
    <>
      <div className="mb-2 mt-6 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">ใบงานที่มีผลกับคะแนน</h2>
        <Link href="/hr/my-score" className="text-sm text-[#0F766E] hover:underline">
          ดูคะแนนของฉัน
        </Link>
      </div>
      <p className="-mt-1 mb-3 text-xs text-(--ink-soft)">
        ใบงานที่เลยกำหนดแล้วยังไม่ปิด ระบบหักคะแนนผู้รับผิดชอบ และแจ้งเตือนคนนั้นทันที · ปิดงานก่อนครบกำหนดเพื่อไม่ให้โดนหัก
      </p>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_220px]">
        <ListCard
          title="เลยกำหนด · กำลังโดนหัก"
          Icon={AlarmClock}
          color="#DC2626"
          count={data.overdueCount}
          items={data.overdue}
          late
          empty="ไม่มีใบงานเลยกำหนด"
        />
        <ListCard
          title="ใกล้ครบกำหนด · ปิดก่อนโดนหัก"
          Icon={CalendarClock}
          color="#B45309"
          count={data.dueSoonCount}
          items={data.dueSoon}
          late={false}
          empty="ไม่มีใบงานครบกำหนดใน 3 วันนี้"
        />
        <Card className="flex flex-col justify-center gap-1 p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-(--radius) bg-[#DC26261a]">
            <TrendingDown className="h-5 w-5 text-[#DC2626]" />
          </span>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#DC2626]">
            {data.monthPoints < 0 ? `−${Math.abs(data.monthPoints)}` : data.monthPoints}
          </p>
          <p className="text-xs text-(--ink-soft)">
            คะแนนที่โดนหักเดือนนี้ {data.orgWide ? "(ทั้งบริษัท)" : "(ของฉัน)"} · {data.monthDocks} ครั้ง
          </p>
          <p className="text-[11px] text-(--ink-soft)">รวมใบงานเลยกำหนดและไม่ทำ PM ตามรอบ</p>
        </Card>
      </div>
    </>
  );
}
