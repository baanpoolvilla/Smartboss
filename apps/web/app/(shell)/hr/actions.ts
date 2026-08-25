"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  WorkforceError,
  WorkforceUnavailableError,
  type Paged,
  type Person,
} from "@/modules/hr/lib/api";

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

/*
 * createCompanyAction ถูกถอดออกแล้ว — นิติบุคคลถูกสร้างให้อัตโนมัติตอนเปิดบริษัท
 * ใน Smartboss (apps/web/lib/workforce-provisioning.ts) เพราะเป็นข้อมูลชุดเดียวกับ
 * core.organizations การให้ผู้ใช้กรอกซ้ำทำให้สองที่ไม่ตรงกันได้โดยไม่มีใครรู้
 *
 * นิติบุคคลตัวที่ 2 ขึ้นไป (ลูกค้าที่มีหลายบริษัทจดทะเบียน) ยังสร้างได้ผ่าน
 * workforce API ตามเดิม — ยังไม่มีหน้าจอให้ เพราะยังไม่มีลูกค้าที่ใช้
 */

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

/**
 * นำเข้าพนักงานหลายคนจากบัญชีผู้ใช้ของ Smartboss ในครั้งเดียว
 *
 * ── ทำไมไม่แปลง core.users → พนักงาน ให้อัตโนมัติตอน sync ──
 * ทะเบียนจ้างงานต้องมีวันเริ่มงาน รหัสพนักงาน และประเภทการจ้าง ซึ่ง `core.users`
 * ไม่มีสักตัว โดยเฉพาะ **วันเริ่มงาน** ที่เข้าไปคำนวณลงเวลา/เงินเดือน/สิทธิ์ลาโดยตรง
 * เดาให้แล้วผิด = ตัวเลขผิดทั้งระบบโดยไม่มีใครรู้ตัว · และไม่ใช่ทุกบัญชีจะเป็นพนักงาน
 * (บัญชี IT/ผู้ดูแลระบบล็อกอินได้แต่ไม่ได้อยู่ในทะเบียนจ้างงาน)
 * ⇒ ให้คนเลือกและกรอกเอง แต่ไม่ต้องพิมพ์ชื่อ/อีเมลซ้ำ
 *
 * ── ทำไมต้องหา person เดิมด้วยอีเมลก่อนสร้างใหม่ ──
 * ขั้นตอนเป็นสองคำสั่ง (สร้าง person แล้วค่อยผูก employment) ถ้า employment ล้ม
 * กลางทาง person จะค้างอยู่แล้ว การกดซ้ำจะสร้าง person ซ้ำอีกใบ — ใช้อีเมลเป็น
 * ตัวจับคู่เพราะเป็นค่าเดียวที่ทั้งสองระบบมีและไม่ซ้ำ (ตัวเดียวกับที่ provisionPrincipal ใช้)
 *
 * ล้มทีละแถว ไม่ล้มทั้งชุด — คนที่สำเร็จต้องไม่ถูก rollback เพราะเพื่อนกรอกรหัสซ้ำ
 */
export async function importEmployeesAction(formData: FormData) {
  await guard(HR_PERMS.employeeManage);

  const companyId = String(formData.get("company_id") ?? "");
  if (!companyId) throw new Error("ยังไม่มีบริษัทในระบบบุคคล");

  const picked = formData.getAll("pick").map(String).filter(Boolean);
  if (picked.length === 0) throw new Error("ยังไม่ได้เลือกใครเลย");

  const field = (name: string, userId: string) =>
    String(formData.get(`${name}.${userId}`) ?? "").trim();

  // อีเมล → person ที่มีอยู่แล้ว ใช้ซ้ำแทนการสร้างใบใหม่
  let personByEmail = new Map<string, string>();
  try {
    const people = await wfFetch<Paged<Person>>("/people");
    personByEmail = new Map(
      people.items
        .filter((row) => row.email !== null && row.email !== "")
        .map((row) => [row.email!.toLowerCase(), row.id])
    );
  } catch {
    // อ่านไม่ได้ = ถือว่ายังไม่มีใคร แล้วปล่อยให้ API ฝั่งโน้นตัดสินเอง
  }

  let created = 0;
  const failures: string[] = [];

  for (const userId of picked) {
    const label = field("label", userId) || field("first_name", userId) || userId.slice(0, 8);
    const firstName = field("first_name", userId);
    const lastName = field("last_name", userId);
    const email = field("email", userId).toLowerCase();
    const employeeCode = field("employee_code", userId);
    const hiredOn = field("hired_on", userId);
    const employmentType = field("employment_type", userId) || "MONTHLY";
    const amount = field("amount", userId);

    if (!firstName || !lastName) {
      failures.push(`${label}: ยังไม่ได้กรอกชื่อ-นามสกุล`);
      continue;
    }
    if (!employeeCode) {
      failures.push(`${label}: ยังไม่ได้กรอกรหัสพนักงาน`);
      continue;
    }
    if (!hiredOn) {
      failures.push(`${label}: ยังไม่ได้ระบุวันเริ่มงาน`);
      continue;
    }

    try {
      let personId = email === "" ? undefined : personByEmail.get(email);
      if (personId === undefined) {
        const person = await wfFetch<{ id: string }>("/people", {
          method: "POST",
          body: {
            first_name: firstName,
            last_name: lastName,
            preferred_name: field("preferred_name", userId),
            email: email === "" ? null : email,
          },
        });
        personId = person.id;
        if (email !== "") personByEmail.set(email, personId);
      }

      const employment = await wfFetch<{ id: string }>("/employments", {
        method: "POST",
        body: {
          company_id: companyId,
          person_id: personId,
          employee_code: employeeCode,
          employment_type: employmentType,
          hired_on: hiredOn,
          time_zone: "Asia/Bangkok",
        },
      });
      created += 1;

      // ตั้งฐานค่าจ้างให้เลยถ้ากรอกมา — ใช้สิทธิ์คนละตัว (hr.salary.manage)
      // คนที่นำเข้าพนักงานได้อาจตั้งเงินเดือนไม่ได้ ซึ่งถูกต้องตามการแยกหน้าที่
      // ⇒ ล้มตรงนี้ต้องไม่ทำให้ดูเหมือนนำเข้าไม่สำเร็จ (พนักงานถูกสร้างไปแล้วจริง)
      if (amount !== "") {
        try {
          await wfFetch("/compensation-rates", {
            method: "POST",
            body: {
              employment_id: employment.id,
              pay_basis: employmentType,
              amount,
              currency: "THB",
              effective_from: hiredOn,
              note: "ตั้งจาก Smartboss ตอนนำเข้าพนักงาน",
            },
          });
        } catch {
          failures.push(`${label}: สร้างพนักงานสำเร็จ แต่ตั้งฐานค่าจ้างไม่ได้ (ไปตั้งที่หน้ารายละเอียด)`);
        }
      }
    } catch (error) {
      failures.push(`${label}: ${toMessage(error)}`);
    }
  }

  revalidatePath("/hr/employees");
  revalidatePath("/hr/employees/import");
  revalidatePath("/hr");

  // เก็บรายละเอียดไว้ไม่เกิน 3 บรรทัด — URL ยาวเกินจะโดนตัดกลางทาง
  const detail = failures.slice(0, 3).join(" · ");
  const params = new URLSearchParams({ ok: String(created) });
  if (failures.length > 0) {
    params.set("fail", String(failures.length));
    if (detail) params.set("msg", detail);
  }
  redirect(
    failures.length === 0
      ? `/hr/employees?imported=${created}`
      : `/hr/employees/import?${params.toString()}`
  );
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

/**
 * ผลของการออกโทเคนผูกเครื่อง
 *
 * ต้องส่ง token กลับไปแสดงบนหน้าจอ ไม่ใช่ throw/void แบบ action ตัวอื่น —
 * เพราะ **เซิร์ฟเวอร์เก็บแค่ hash** (`hashActivationToken`) ค่าจริงมีอยู่ครั้งเดียว
 * ตอนตอบกลับ ถ้าไม่แสดงตรงนี้ก็ไม่มีทางรู้ค่าอีกเลย ต้องออกใบใหม่
 */
export interface IssueTokenState {
  token?: string;
  expiresAt?: string;
  error?: string;
}

export async function issueDeviceTokenAction(
  _prev: IssueTokenState,
  formData: FormData,
): Promise<IssueTokenState> {
  try {
    await guard(HR_PERMS.settingManage);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const deviceId = String(formData.get("deviceId") ?? "");
  if (!deviceId) return { error: "ไม่พบเครื่อง" };

  try {
    const result = await wfFetch<{ activation_token: string; expires_at: string }>(
      `/devices/${deviceId}/activation-tokens`,
      { method: "POST" },
    );
    // ไม่ revalidate — ไม่มีคอลัมน์ไหนบนตารางเปลี่ยนจนกว่าเครื่องจะ activate สำเร็จ
    // และการ refresh จะล้าง token ที่เพิ่งแสดงทิ้งไปทั้งที่ผู้ใช้ยังไม่ได้คัดลอก
    return { token: result.activation_token, expiresAt: result.expires_at };
  } catch (error) {
    return { error: toMessage(error) };
  }
}

/**
 * ผลของการสั่งลงทะเบียนลายนิ้วมือ
 *
 * ต้องคืนเป็นค่า ไม่ใช่ throw — คำสั่งนี้ "สั่งแล้วยังไม่จบ" ผู้ใช้ต้องเดินไป
 * วางนิ้วที่เครื่องต่อ ถ้าไม่บอกบนหน้าจอว่าสั่งสำเร็จและต้องทำอะไรต่อ
 * จะไม่มีทางรู้เลยว่ากดติดหรือไม่ (เหมือนปัญหาปุ่มออกโทเคนเดิม)
 */
export interface EnrollState {
  ok?: boolean;
  slot?: number;
  error?: string;
}

export async function requestEnrollmentAction(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  try {
    await guard(HR_PERMS.settingManage);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const employmentId = String(formData.get("employment_id") ?? "");
  const deviceId = String(formData.get("device_id") ?? "");
  const slot = Number(formData.get("template_slot"));

  if (!employmentId) return { error: "กรุณาเลือกพนักงาน" };
  if (!deviceId) return { error: "กรุณาเลือกเครื่องสแกน" };
  if (!Number.isInteger(slot) || slot < 0 || slot > 65_535) {
    return { error: "หมายเลข slot ต้องเป็นจำนวนเต็ม 0-65535" };
  }

  try {
    await wfFetch("/biometric-enrollments", {
      method: "POST",
      body: {
        employment_id: employmentId,
        device_id: deviceId,
        template_slot: slot,
        finger_position: orNull(formData.get("finger_position")),
        ttl_seconds: 600,
      },
    });
  } catch (error) {
    return { error: toMessage(error) };
  }

  revalidatePath("/hr/devices");
  return { ok: true, slot };
}

/**
 * ลบลายนิ้วมือของพนักงานออกจากทุกเครื่อง
 *
 * workforce ไม่มี endpoint ลบทีละ enrollment — ลบเป็นรายคนเสมอ (spec §6.2)
 * เพราะการปล่อยให้เหลือนิ้วค้างอยู่เครื่องใดเครื่องหนึ่งหลังคนลาออก
 * คือช่องให้ลงเวลาแทนกันได้
 */
export async function deleteEnrollmentsAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const employmentId = String(formData.get("employmentId") ?? "");
  const reason =
    String(formData.get("reason") ?? "").trim() || "ลบจากหน้าเครื่องสแกนของ Smartboss";
  if (!employmentId) throw new Error("ไม่พบพนักงาน");

  try {
    await wfFetch(`/employments/${employmentId}/biometric-enrollments:delete`, {
      method: "POST",
      body: { reason },
    });
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
