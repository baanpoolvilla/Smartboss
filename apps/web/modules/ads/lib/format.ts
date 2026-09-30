/** รูปแบบตัวเลขที่ใช้ร่วมกัน หน้าเว็บ / อีเมล / PDF / Excel — ไม่มี server-only */

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtMoney(v: number | null | undefined, currency?: string | null): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  const sym = !currency || currency === "THB" ? "฿" : `${currency} `;
  return `${sym}${fmtNum(v, 2)}`;
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? "N/A" : `${fmtNum(v, digits)}%`;
}

/** % เปลี่ยนแปลงพร้อมเครื่องหมาย เช่น +12.5% / −8.2% */
export function fmtChange(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${fmtNum(Math.abs(v), 1)}%`;
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "ยังไม่เคย";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(d));
}

/** ค่าของ KPI แต่ละตัวในรูปที่แสดง */
export function fmtMetric(metric: string, v: number | null | undefined, currency?: string | null): string {
  if (metric === "cpc" || metric === "cpa" || metric === "cost") return fmtMoney(v, currency);
  if (metric === "ctr" || metric === "conv_rate" || metric.endsWith("_pct") || metric.endsWith("_is") || metric === "search_impr_share") {
    return fmtPct(v);
  }
  if (metric === "roas") return v == null ? "N/A" : `${fmtNum(v, 2)}x`;
  if (metric === "conversions") return fmtNum(v, 2);
  return fmtNum(v);
}

/** สำหรับ KPI "ต่ำ = ดี" ตัวเลขที่ลดลงคือข่าวดี — ใช้เลือกสีของ % เปลี่ยนแปลง */
export function changeIsGood(metric: string, change: number | null | undefined): boolean | null {
  if (change == null || change === 0) return null;
  const lowerBetter = metric === "cpc" || metric === "cpa" || metric === "cost";
  return lowerBetter ? change < 0 : change > 0;
}
