import Link from "next/link";

/**
 * แท็บของเมนู "จ่ายเงิน" — เรื่องเงินทั้งหมดอยู่ที่นี่ที่เดียว (ผู้ใช้ 19/10/2569: "แยกคิดเงินเป็นอีกหน้า ตั้งค่าไม่เอาไว้หน้าตาราง มันงง")
 * ตั้งค่าแรงเห็นเฉพาะคนที่มีสิทธิ์ตั้งค่าแรง (HR/CEO)
 */
export function PayTabs({
  active,
  month,
  date,
  canSetPay,
}: {
  active: "day" | "month" | "settings" | "log";
  month: string;
  date?: string;
  canSetPay: boolean;
}) {
  const tab = (on: boolean) => `rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${on ? "bg-(--ink) text-(--bg)" : "border border-(--line) hover:bg-(--bg-soft)"}`;
  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="เมนูจ่ายเงิน">
      <Link href={`/daily-workers/pay${date ? `?date=${date}` : ""}`} className={tab(active === "day")}>
        รายวัน
      </Link>
      <Link href={`/daily-workers/pay?month=${month}`} className={tab(active === "month")}>
        ทั้งเดือน
      </Link>
      {canSetPay && (
        <Link href="/daily-workers/pay/settings" className={tab(active === "settings")}>
          ตั้งค่าแรง
        </Link>
      )}
      <Link href={`/daily-workers/pay/log?month=${month}`} className={tab(active === "log")}>
        ประวัติการแก้ไข
      </Link>
    </nav>
  );
}
