import type { LineInfo } from "../lib/run";

/**
 * สรุปวันทำงานของงวด (ผู้ใช้ขอ 27/10/2569 "ดูในเงินเดือนว่าทำไปกี่วัน หยุดกี่วัน มาทำ OT กี่วัน")
 * ตัวเลขเก็บไว้ในบรรทัดตอนคำนวณรอบ — รอบเก่าไม่มี offDays/OT: วันลาเดิมรวม Day-Off อยู่แล้ว จึงแสดงเป็น "ลา/หยุด" ก้อนเดียว
 */
export function workDayParts(info: Partial<LineInfo> | undefined) {
  const i = info ?? {};
  const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}`;
  const hours = (m: number) => {
    const h = m / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} ชม.`;
  };
  const leave = Math.max(0, (i.leaveDays ?? 0) - (i.offDays ?? 0));
  const parts: { label: string; value: string; tone?: "warn" | "bad" | "ot" }[] = [{ label: "มาทำงาน", value: `${i.workedDays ?? 0} วัน` }];
  if (i.offDays === undefined) {
    parts.push({ label: "ลา/หยุด", value: `${days(i.leaveDays ?? 0)} วัน` });
  } else {
    parts.push({ label: "หยุด", value: `${days(i.offDays)} วัน` });
    parts.push({ label: "ลา", value: `${days(leave)} วัน` });
  }
  if (i.absentDays !== undefined) parts.push({ label: "ขาด", value: `${i.absentDays} วัน`, tone: i.absentDays > 0 ? "bad" : undefined });
  parts.push({ label: "สาย", value: `${i.lateCount ?? 0} ครั้ง`, tone: (i.lateCount ?? 0) > 0 ? "warn" : undefined });
  if (i.otDays !== undefined) parts.push({ label: "OT", value: i.otDays ? `${i.otDays} วัน · ${hours(i.otMinutes ?? 0)}` : "0 วัน", tone: i.otDays ? "ot" : undefined });
  return parts;
}

const TONE = { warn: "text-amber-700", bad: "text-red-700", ot: "text-violet-700 dark:text-violet-300" } as const;

/** ช่องสถิติบนสลิป */
export function WorkDaysTiles({ info }: { info: Partial<LineInfo> | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {workDayParts(info).map((p) => (
        <div key={p.label} className="rounded-(--radius) bg-(--bg-soft) px-2 py-1.5 text-center">
          <div className="text-[11px] text-(--ink-soft)">{p.label}</div>
          <div className={`text-sm font-semibold tabular-nums ${p.tone ? TONE[p.tone] : ""}`}>{p.value}</div>
        </div>
      ))}
    </div>
  );
}

/** บรรทัดเดียวใต้ชื่อในตารางรอบเงินเดือน */
export function WorkDaysLine({ info }: { info: Partial<LineInfo> | undefined }) {
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs tabular-nums text-(--ink-soft)">
      {workDayParts(info).map((p) => (
        <span key={p.label} className={p.tone ? TONE[p.tone] : undefined}>
          {p.label} {p.value}
        </span>
      ))}
    </div>
  );
}
