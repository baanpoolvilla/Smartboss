import { redirect } from "next/navigation";

/**
 * "ตั้งวันหยุด" ย้ายไปอยู่ใต้ /hr/settings แล้ว (ยุบเมนู 15 → 5 กลุ่ม)
 * เก็บ path เดิมไว้เป็นทางผ่าน — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้ รวมถึงที่มี
 * ?year=/&emp=/&month= ต่อท้าย ซึ่งหน้าเดิมอ่านใช้จริง
 */
export default async function HolidaysRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value);
  }
  const suffix = qs.toString();
  redirect(`/hr/settings/holidays${suffix ? `?${suffix}` : ""}`);
}
