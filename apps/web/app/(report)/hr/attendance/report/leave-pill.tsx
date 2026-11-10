import { leaveColor } from "./leave-colors";

/** ป้ายสีประเภทลา เช่น "ลาป่วย 2" — n ไม่ส่ง = แสดงแค่ชื่อ (ใช้ในตารางรายวัน) */
export function LeavePill({ name, n }: { name: string; n?: number }) {
  const c = leaveColor(name);
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold"
      style={{ color: c.fg, backgroundColor: c.bg }}
      data-leave-pill={name}
    >
      {name}
      {n !== undefined ? <b className="ml-1 tabular-nums">{n}</b> : null}
    </span>
  );
}
