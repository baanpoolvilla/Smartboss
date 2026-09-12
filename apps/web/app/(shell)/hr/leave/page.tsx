import { redirect } from "next/navigation";

/**
 * "ปฏิทินวันหยุด" ย้ายไปเป็นแท็บ "ปฏิทินทีม" ของหน้าหลักแล้ว
 * เก็บ path เดิมไว้เป็นทางผ่านพร้อม ?month= เดิม — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 */
export default async function LeaveRedirect({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const suffix = sp.month ? `&month=${encodeURIComponent(sp.month)}` : "";
  redirect(`/hr?tab=calendar${suffix}`);
}
