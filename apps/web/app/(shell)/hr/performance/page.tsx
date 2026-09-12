import { redirect } from "next/navigation";

/**
 * "ผลงานรายคน" ย้ายไปเป็นแท็บ "คะแนน & เกรด" ของหน้าพนักงานแล้ว
 * เก็บ path เดิมไว้เป็นทางผ่านพร้อม ?range= เดิม — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 */
export default async function PerformanceRedirect({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const suffix = sp.range ? `&range=${encodeURIComponent(sp.range)}` : "";
  redirect(`/hr/employees?tab=score${suffix}`);
}
