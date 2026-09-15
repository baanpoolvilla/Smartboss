import type { NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";
import { wfFetch, wfTry, type Me, type LeaveType, type LeaveRequest, type Paged } from "@/modules/hr/lib/api";

export const dynamic = "force-dynamic";

/** ช่วงกว้างพอครอบคลุมวันลาที่ยังขอสลับได้จริง — ไม่ผูกกับเดือนที่ปฏิทิน
 * กำลังดูอยู่ตอนนี้ เพื่อไม่ต้องยิงซ้ำทุกครั้งที่เปลี่ยนเดือน */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - 3);
  const to = new Date(now);
  to.setMonth(to.getMonth() + 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * ข้อมูลที่ต้องใช้ยื่น/สลับวันลาจากปฏิทินของโมดูลรายงานและงาน — employment id
 * ของผู้ใช้ปัจจุบัน, รายชื่อประเภทการลาจริง, และคำขอของตัวเองที่ยังมีผล (เอา
 * leave_type_id จริงไว้ให้ swapLeaveAction ยื่นสลับด้วยประเภทเดิม) ทั้งหมดดึง
 * จากฝ่ายบุคคล (workforce) ให้ตรงกับที่หน้า /hr?tab=calendar ใช้เป๊ะ ๆ ไม่ใช่
 * ทะเบียนแยกของโมดูลนี้เอง (ดู
 * modules/report_task/components/calendar/submit-leave-dialog.tsx และ
 * leave-sidebar.tsx's ปุ่ม "สลับ")
 */
export async function GET(request: NextRequest) {
  try {
    await requireOrg();
    const { searchParams } = new URL(request.url);
    const { from, to } = defaultRange();

    const [me, types, myRequests] = await Promise.all([
      wfFetch<Me>("/me"),
      wfTry<Paged<LeaveType>>("/leave-types"),
      wfTry<{ items: LeaveRequest[] }>(
        `/me/leave-requests?from=${searchParams.get("from") ?? from}&to=${searchParams.get("to") ?? to}`
      ),
    ]);

    return Response.json({
      employmentId: me.employment_id,
      myName: me.display_name,
      leaveTypes: (types?.items ?? []).map((t) => ({
        id: t.id,
        label: `${t.name}${t.paid ? "" : " (ไม่ได้ค่าจ้าง)"}`,
        autoApprove: t.auto_approve,
        monthlyQuotaDays: t.monthly_quota_days,
      })),
      myRequests: (myRequests?.items ?? [])
        .filter((r) => r.status === "SUBMITTED" || r.status === "APPROVED")
        .map((r) => ({
          id: r.id,
          leaveTypeId: r.leave_type_id,
          startsOn: r.starts_on,
          displayLabel: r.display_label,
        })),
    });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : "เชื่อมต่อระบบบุคคลไม่ได้";
    if (status === 500) console.error("[report-task/hr/leave-context GET]", err);
    return Response.json({ error: message }, { status });
  }
}
