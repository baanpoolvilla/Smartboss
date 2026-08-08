"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, WorkforceError, WorkforceUnavailableError } from "@/modules/hr/lib/api";

/**
 * Server action ของโมดูลบุคคล — ทุกตัวยิงต่อไปที่ workforce API
 *
 * สิทธิ์ถูกตรวจสองชั้น: ชั้นนี้กันไม่ให้ยิงถ้าไม่มีสิทธิ์ใน Smartboss
 * และ workforce ตรวจซ้ำจาก role ของ principal เองเสมอ (การซ่อนปุ่มไม่ใช่ security control)
 */
async function guard(permission: string) {
  const session = await requireOrg();
  if (!hasPermission(session, permission)) {
    throw new Error("ไม่มีสิทธิ์ดำเนินการนี้");
  }
  return session;
}

/** แปลง error ของ workforce เป็นข้อความไทยที่อ่านรู้เรื่อง */
function toMessage(error: unknown): string {
  if (error instanceof WorkforceUnavailableError) {
    return "เชื่อมต่อระบบบุคคลไม่ได้ — ตรวจว่า workforce API รันอยู่หรือไม่";
  }
  if (error instanceof WorkforceError) return error.displayMessage;
  return error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ";
}

/* ═══════════════════ Timesheet ═══════════════════ */

export async function generateTimesheetAction(formData: FormData) {
  await guard(HR_PERMS.employeeManage);
  const id = String(formData.get("periodId") ?? "");
  if (!id) throw new Error("ไม่พบงวด");

  try {
    await wfFetch(`/timesheet-periods/${id}/generate`, { method: "POST" });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/timesheets");
}

export async function closeTimesheetAction(formData: FormData) {
  await guard(HR_PERMS.employeeManage);
  const id = String(formData.get("periodId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) throw new Error("ไม่พบงวด");
  if (!reason) throw new Error("ต้องระบุเหตุผลในการปิดงวด");

  try {
    await wfFetch(`/timesheet-periods/${id}/close`, {
      method: "POST",
      body: { reason },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/timesheets");
}

/* ═══════════════════ งวดเงินเดือน ═══════════════════ */

/**
 * เปลี่ยนสถานะงวด — workforce บังคับลำดับ state machine เอง
 * และห้ามคนเตรียมงวดอนุมัติงวดตัวเอง (แยกหน้าที่ระดับ permission)
 */
export async function payrollTransitionAction(formData: FormData) {
  const action = String(formData.get("action") ?? "");
  const runId = String(formData.get("runId") ?? "");
  if (!runId || !action) throw new Error("ข้อมูลไม่ครบ");

  // calculate = งานของผู้จัดทำ · approve/lock = งานของผู้อนุมัติ
  const needsApprove = ["approve", "lock", "reject"].includes(action);
  await guard(needsApprove ? HR_PERMS.payrollApprove : HR_PERMS.payrollManage);

  try {
    await wfFetch(`/payroll-runs/${runId}/${action}`, { method: "POST" });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath(`/hr/payroll/${runId}`);
  revalidatePath("/hr/payroll");
}

/* ═══════════════════ บริษัท (ตั้งต้นระบบ) ═══════════════════ */

/**
 * สร้าง company ตัวแรกของ tenant
 *
 * workforce แยก tenant (บริษัทลูกค้าใน Smartboss) ออกจาก company (นิติบุคคลที่จ้างงาน)
 * เพราะลูกค้าหนึ่งรายอาจมีหลายนิติบุคคล — ทุกอย่างที่เหลือ (พนักงาน/กะ/งวด) ต้องมี company ก่อน
 */
export async function createCompanyAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const legalName = String(formData.get("legal_name") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!code) throw new Error("กรุณากรอกรหัสบริษัท");
  if (!legalName || !displayName) throw new Error("กรุณากรอกชื่อบริษัท");

  try {
    await wfFetch("/companies", {
      method: "POST",
      body: {
        code,
        legal_name: legalName,
        display_name: displayName,
        time_zone: "Asia/Bangkok",
        currency: "THB",
      },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr", "layout");
}

/* ═══════════════════ พนักงาน ═══════════════════ */

/** ค่าว่างจากฟอร์มต้องส่งเป็น null ไม่ใช่ "" — schema ฝั่ง API เป็น nullable ไม่ใช่ optional string */
function orNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

/**
 * สร้างพนักงาน = สร้าง person ก่อนแล้วค่อยผูก employment
 * workforce แยกสองตารางเพราะคนหนึ่งคนมีสัญญาจ้างได้หลายครั้ง (ลาออกแล้วกลับมา)
 */
export async function createEmployeeAction(formData: FormData) {
  await guard(HR_PERMS.employeeManage);

  const companyId = String(formData.get("company_id") ?? "");
  const employeeCode = String(formData.get("employee_code") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const hiredOn = String(formData.get("hired_on") ?? "");

  if (!companyId) throw new Error("ยังไม่มีบริษัทในระบบ workforce");
  if (!firstName || !lastName) throw new Error("กรุณากรอกชื่อและนามสกุล");
  if (!employeeCode) throw new Error("กรุณากรอกรหัสพนักงาน");
  if (!hiredOn) throw new Error("กรุณาระบุวันเริ่มงาน");

  let employmentId: string;
  try {
    const person = await wfFetch<{ id: string }>("/people", {
      method: "POST",
      body: {
        first_name: firstName,
        last_name: lastName,
        preferred_name: String(formData.get("preferred_name") ?? "").trim(),
        email: orNull(formData.get("email")),
        phone: orNull(formData.get("phone")),
        date_of_birth: orNull(formData.get("date_of_birth")),
        national_id: orNull(formData.get("national_id")),
      },
    });

    const employment = await wfFetch<{ id: string }>("/employments", {
      method: "POST",
      body: {
        company_id: companyId,
        person_id: person.id,
        employee_code: employeeCode,
        employment_type: String(formData.get("employment_type") ?? "MONTHLY"),
        hired_on: hiredOn,
        time_zone: "Asia/Bangkok",
      },
    });
    employmentId = employment.id;
  } catch (error) {
    throw new Error(toMessage(error));
  }

  // ตั้งฐานค่าจ้างให้เลยถ้ากรอกมา — แต่ต้องใช้สิทธิ์คนละตัว (workforce.payroll.prepare)
  // คนที่เพิ่มพนักงานได้อาจตั้งเงินเดือนไม่ได้ ซึ่งถูกต้องตามการแยกหน้าที่
  // ⇒ ล้มตรงนี้ต้องไม่ทำให้ดูเหมือนสร้างพนักงานไม่สำเร็จ (พนักงานถูกสร้างไปแล้วจริง)
  const amount = String(formData.get("amount") ?? "").trim();
  if (amount !== "") {
    try {
      await wfFetch("/compensation-rates", {
        method: "POST",
        body: {
          employment_id: employmentId,
          pay_basis: String(formData.get("employment_type") ?? "MONTHLY"),
          amount,
          currency: "THB",
          effective_from: hiredOn,
          note: "ตั้งจาก Smartboss ตอนสร้างพนักงาน",
        },
      });
    } catch {
      // หน้ารายละเอียดจะบอกเองว่ายังไม่มีอัตราค่าจ้าง และตั้งได้ที่ไหน
    }
  }

  revalidatePath("/hr/employees");
  redirect(`/hr/employees/${employmentId}`);
}

export async function addCompensationRateAction(formData: FormData) {
  await guard(HR_PERMS.salaryManage);
  const employmentId = String(formData.get("employment_id") ?? "");
  const amount = String(formData.get("amount") ?? "").trim();
  const effectiveFrom = String(formData.get("effective_from") ?? "");

  if (!employmentId) throw new Error("ไม่พบพนักงาน");
  if (amount === "") throw new Error("กรุณาระบุจำนวนเงิน");
  if (!effectiveFrom) throw new Error("กรุณาระบุวันที่มีผล");

  try {
    await wfFetch("/compensation-rates", {
      method: "POST",
      body: {
        employment_id: employmentId,
        pay_basis: String(formData.get("pay_basis") ?? "MONTHLY"),
        amount,
        currency: "THB",
        effective_from: effectiveFrom,
        note: String(formData.get("note") ?? "").trim(),
        // ปิดช่วงเดิมให้อัตโนมัติ ไม่งั้น trigger กันช่วงซ้อนจะปฏิเสธ
        supersede_current: true,
      },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath(`/hr/employees/${employmentId}`);
}

export async function terminateEmploymentAction(formData: FormData) {
  await guard(HR_PERMS.employeeManage);
  const employmentId = String(formData.get("employment_id") ?? "");
  const terminatedOn = String(formData.get("terminated_on") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!employmentId || !terminatedOn) throw new Error("ข้อมูลไม่ครบ");

  try {
    await wfFetch(`/employments/${employmentId}/terminate`, {
      method: "POST",
      body: { terminated_on: terminatedOn, reason: reason || "ระบุจาก Smartboss" },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath(`/hr/employees/${employmentId}`);
  revalidatePath("/hr/employees");
}

/* ═══════════════════ กะทำงาน ═══════════════════ */

export async function createShiftAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const companyId = String(formData.get("company_id") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");

  if (!companyId) throw new Error("ยังไม่มีบริษัทในระบบ workforce");
  if (!code || !name) throw new Error("กรุณากรอกรหัสและชื่อกะ");
  if (!start || !end) throw new Error("กรุณาระบุเวลาเข้า-ออก");

  try {
    await wfFetch("/shifts", {
      method: "POST",
      body: {
        company_id: companyId,
        code,
        name,
        start,
        end,
        crosses_midnight: formData.get("crosses_midnight") === "1",
        rest_day: formData.get("rest_day") === "1",
      },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/shifts");
}

/* ═══════════════════ งวด timesheet ═══════════════════ */

export async function createTimesheetPeriodAction(formData: FormData) {
  await guard(HR_PERMS.employeeManage);
  const companyId = String(formData.get("company_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const startsOn = String(formData.get("starts_on") ?? "");
  const endsOn = String(formData.get("ends_on") ?? "");

  if (!companyId) throw new Error("ยังไม่มีบริษัทในระบบ workforce");
  if (!name || !startsOn || !endsOn) throw new Error("ข้อมูลไม่ครบ");

  try {
    await wfFetch("/timesheet-periods", {
      method: "POST",
      body: { company_id: companyId, name, starts_on: startsOn, ends_on: endsOn },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/timesheets");
}

/* ═══════════════════ เครื่องสแกน ═══════════════════ */

export async function createDeviceAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const companyId = String(formData.get("company_id") ?? "");
  const deviceCode = String(formData.get("device_code") ?? "").trim();

  if (!companyId) throw new Error("ยังไม่มีบริษัทในระบบ workforce");
  if (!deviceCode) throw new Error("กรุณากรอกรหัสเครื่อง");

  try {
    await wfFetch("/devices", {
      method: "POST",
      body: {
        company_id: companyId,
        device_code: deviceCode,
        name: String(formData.get("name") ?? "").trim(),
        device_type: String(formData.get("device_type") ?? "FINGERPRINT_TERMINAL"),
        time_zone: "Asia/Bangkok",
      },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/devices");
}

export async function issueDeviceTokenAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const deviceId = String(formData.get("deviceId") ?? "");
  if (!deviceId) throw new Error("ไม่พบเครื่อง");

  try {
    await wfFetch(`/devices/${deviceId}/activation-tokens`, { method: "POST" });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/devices");
}

export async function revokeDeviceAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const deviceId = String(formData.get("deviceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "revoked from Smartboss";
  if (!deviceId) throw new Error("ไม่พบเครื่อง");

  try {
    await wfFetch(`/devices/${deviceId}/revoke`, {
      method: "POST",
      body: { reason },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/devices");
}
