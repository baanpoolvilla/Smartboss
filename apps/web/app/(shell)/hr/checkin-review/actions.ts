"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@smartboss/database";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, WorkforceError } from "@/modules/hr/lib/api";
import { invalidateAttendanceThrottle } from "@/modules/hr/lib/auto-recalculate";
import { localDateStr } from "@/modules/hr/lib/date";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { notifyUser } from "@/modules/maintenance/data/notify";
import { postClockNotice } from "@/lib/attendance-chat";

/** userId ของ SmartBoss จาก employment ของระบบบุคคล (employment → person → principal.subject) */
async function userIdOfEmployment(orgId: string, employmentId: string): Promise<string | null> {
  try {
    const rows = await withWorkforceTenant(orgId, (tx) =>
      tx.$queryRaw<{ subject: string | null }[]>`
        SELECT p.subject
        FROM workforce.employments e
        JOIN workforce.principals p ON p.person_id = e.person_id
        WHERE e.id = ${employmentId}::uuid
        LIMIT 1
      `
    );
    const id = rows[0]?.subject ?? null;
    if (!id) return null;
    const user = await prisma.user.findFirst({ where: { orgId, id }, select: { id: true } });
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * จัดการรายการลงเวลาผิดปกติ
 *
 * APPROVED = ปกติ/นับเวลา · REJECTED = ไม่นับ (เหมือนไม่เคยลงเวลาครั้งนั้น — ตัดสินที่ฝั่ง workforce
 * attendance.service collectPunches ซึ่งอ่านผลตรวจจาก mobile_risk_assessments)
 *
 * หลังกดสั่งคำนวณผลลงเวลาของคนนั้นใหม่ทันที (คะแนนผลงานหัก/คืนตามผลใหม่ในรอบเช้าถัดไป) และ
 * ถ้าไม่นับ แจ้งพนักงานพร้อมเหตุผลในแอป (กระดิ่ง + ห้องแชท "ระบบลงเวลา" — ไม่ส่ง LINE) — ไม่ให้โดนหักคะแนน
 * ทั้งที่ไม่รู้ว่าเกิดอะไรขึ้น จะได้ยื่นขอแก้เวลาได้ถ้าไม่เห็นด้วย
 */
export async function reviewCheckinAction(formData: FormData): Promise<{ error?: string }> {
  const s = await requireOrg();
  if (!hasPermission(s, HR_PERMS.employeeManage)) return { error: "ไม่มีสิทธิ์จัดการการลงเวลา" };

  const id = String(formData.get("id") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const employmentId = String(formData.get("employmentId") ?? "");
  const at = String(formData.get("at") ?? "");
  const typedReason = String(formData.get("reason") ?? "").trim();
  if (!id || (outcome !== "APPROVED" && outcome !== "REJECTED")) return { error: "ข้อมูลไม่ครบ" };
  if (outcome === "REJECTED" && typedReason === "") return { error: "ใส่เหตุผลที่ไม่นับก่อน" };
  const reason = typedReason || "ตรวจแล้วปกติ";

  try {
    await wfFetch(`/attendance-risk-assessments/${id}/review`, {
      method: "POST",
      body: { outcome, reason: reason.slice(0, 500) },
    });
  } catch (error) {
    if (error instanceof WorkforceError) return { error: error.displayMessage };
    return { error: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }

  // คำนวณใหม่เฉพาะวันนั้น (± 1 วัน เผื่อกะข้ามเที่ยงคืน) — ล้มก็ไม่เป็นไร รอบอัตโนมัติ/รอบหักคะแนนเช้าจะตามมาเก็บ
  if (employmentId && at) {
    const day = new Date(at);
    await wfFetch("/attendance-results:recalculate", {
      method: "POST",
      body: {
        employment_id: employmentId,
        from: localDateStr(new Date(day.getTime() - 86_400_000)),
        to: localDateStr(day),
      },
    }).catch(() => null);
  }
  invalidateAttendanceThrottle(s.orgId);

  if (outcome === "REJECTED" && employmentId) {
    const userId = await userIdOfEmployment(s.orgId, employmentId);
    if (userId) {
      const when = at ? hhmm(at) : "";
      const text = `HR ไม่นับการลงเวลา ${when} — ${reason}`;
      await notifyUser(s.orgId, userId, {
        title: `❌ ${text}`,
        body: "ถ้าไม่ถูกต้อง ยื่นขอแก้เวลาได้ที่ระบบบุคคล › คำขอแก้เวลา",
        type: "hr_attendance_correction_decided",
        referenceId: id,
        // แจ้งในแอปเท่านั้น ไม่ส่ง LINE (เจ้าของงานตัดสิน 2026-10-07)
      });
      await postClockNotice(s.orgId, userId, `❌ ${text} · ไม่ถูกต้องยื่นขอแก้เวลาได้`).catch(() => null);
    }
  }

  revalidatePath("/hr/checkin-review");
  revalidatePath("/hr");
  return {};
}
