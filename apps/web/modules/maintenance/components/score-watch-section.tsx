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

/** โดนัทใบงานที่ยังไม่ปิด แยกตามกำหนดส่ง — หน้าตาเดียวกับโดนัทค่าใช้จ่าย (วงหนา ตัวเลขรวมตรงกลาง) */
function DueDonut({ data }: { data: ScoreWatch }) {
  const parts = [
    { label: "เลยกำหนด", value: data.overdueCount, color: "#DC2626" },
    { label: "ใกล้ครบกำหนด (≤ 3 วัน)", value: data.dueSoonCount, color: "#F59E0B" },
    { label: "ยังไม่ถึงกำหนด", value: data.laterCount, color: "#16A34A" },
    { label: "ไม่ได้ตั้งวันครบกำหนด", value: data.noDueCount, color: "#94A3B8" },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-10">
      <svg viewBox="0 0 140 140" className="h-44 w-44 shrink-0" role="img" aria-label={`ใบงานที่ยังไม่ปิด ${total} ใบ`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line)" strokeWidth="22" />
        {total > 0 &&
          parts.map((p) => {
            if (!p.value) return null;
            const len = (p.value / total) * C;
            const el = (
              <circle
                key={p.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="22"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            );
            offset += len;
            return el;
          })}
        <text x="70" y="68" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">
          {total}
        </text>
        <text x="70" y="86" textAnchor="middle" fontSize="10" fill="var(--ink-soft)">
          ใบงานที่ยังไม่ปิด
        </text>
      </svg>
      <div className="grid gap-2 text-sm">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="text-(--ink)">{p.label}</span>
            <span className="ml-auto pl-4 font-semibold tabular-nums text-(--ink)">{p.value}</span>
            <span className="w-10 text-right text-xs tabular-nums text-(--ink-soft)">
              {total ? `${Math.round((p.value / total) * 100)}%` : "–"}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 border-t border-(--line) pt-2">
          <TrendingDown className="h-4 w-4 shrink-0 text-[#DC2626]" />
          <span className="text-(--ink)">
            คะแนนที่โดนหักเดือนนี้ {data.orgWide ? "(ทั้งบริษัท)" : "(ของฉัน)"}
          </span>
          <span className="ml-auto pl-4 font-semibold tabular-nums text-[#DC2626]">
            {data.monthPoints < 0 ? `−${Math.abs(data.monthPoints)}` : data.monthPoints}
          </span>
          <span className="w-10 text-right text-xs tabular-nums text-(--ink-soft)">{data.monthDocks} ครั้ง</span>
        </div>
      </div>
    </div>
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
      <Card className="mb-3 p-4">
        <DueDonut data={data} />
        <p className="mt-4 text-center text-xs text-(--ink-soft)">
          ใบงานที่เลยกำหนดแล้วยังไม่ปิด ระบบหักคะแนนผู้รับผิดชอบ และแจ้งเตือนคนนั้นทันที · ปิดงานก่อนครบกำหนดเพื่อไม่ให้โดนหัก
        </p>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
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
      </div>
    </>
  );
}
