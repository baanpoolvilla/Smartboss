/** ฟอร์แมตวันที่/สถานะ — ให้ตรงกับของเดิม (ChangYai) */

export function fmtThaiDate(d: Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(d);
}

export function fmtThaiDateTime(d: Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** yyyy-mm-dd สำหรับ input[type=date] */
export function toDateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export const MAINT_TEAL = "#0D9488";
export const MAINT_TEAL_BG = "#ECFDF7";
