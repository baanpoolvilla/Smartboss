"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** ISO date (YYYY-MM-DD) → ISO date ของอีก N วัน — บวกลบตรงๆ ไม่ผ่าน Date เพื่อกัน timezone เพี้ยน */
function shiftDate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function formatThai(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * ตัวเลือกวันของหน้าการลงเวลา — ย้อนดูวันก่อนหน้าได้
 *
 * จำกัดไม่ให้เลือกวันในอนาคต เพราะข้อมูลลงเวลายังไม่มีให้ดู — กด "ถัดไป"
 * เกินวันนี้ไม่ได้ ปฏิทินก็เลือกเกินวันนี้ไม่ได้เหมือนกัน (attr max)
 */
export function AttendanceDateNav({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const isToday = date === today;

  function go(iso: string) {
    router.push(iso === today ? "/hr" : `/hr?date=${iso}`);
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <Link
        href={`/hr?date=${shiftDate(date, -1)}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-(--line) bg-(--bg) text-(--ink-soft) transition-colors hover:bg-(--bg-soft)"
        aria-label="วันก่อนหน้า"
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>

      <div className="relative flex-1">
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => {
            if (e.target.value) go(e.target.value);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="เลือกวันที่"
        />
        <div className="pointer-events-none flex h-9 items-center justify-center rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm font-medium text-(--ink)">
          {formatThai(date)}
          {isToday && (
            <span className="ml-2 rounded-full bg-(--app-soft,#EFF5FF) px-2 py-px text-[11px] font-bold text-(--app-strong,var(--ink))">
              วันนี้
            </span>
          )}
        </div>
      </div>

      {isToday ? (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--ink-faint,var(--ink-soft))/40"
          aria-hidden
        >
          <ChevronRight className="h-4 w-4 opacity-30" />
        </span>
      ) : (
        <Link
          href={
            shiftDate(date, 1) === today ? "/hr" : `/hr?date=${shiftDate(date, 1)}`
          }
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-(--line) bg-(--bg) text-(--ink-soft) transition-colors hover:bg-(--bg-soft)"
          aria-label="วันถัดไป"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}

      {!isToday && (
        <Link
          href="/hr"
          className="shrink-0 rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-xs font-medium text-(--ink-soft) transition-colors hover:bg-(--bg-soft)"
        >
          กลับวันนี้
        </Link>
      )}
    </div>
  );
}
