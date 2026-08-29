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

/**
 * ตั้งรหัสให้อัตโนมัติ
 *
 * API บังคับว่าต้องมี `code` ทุกรายการ แต่ผู้ใช้ไม่ควรต้องคิดรหัสเอง —
 * ชื่อภาษาไทยแปลงเป็นรหัสไม่ได้ตรง ๆ (จะได้ตัวอักษรที่อ่านไม่ออก) และการ
 * ให้คิดเองทุกครั้งคือการโยนงานของระบบไปให้คน แล้วยังเสี่ยงกรอกซ้ำจนโดน 409
 *
 * รหัสพวกนี้ไม่มีใครต้องพิมพ์หรือจำ ต่างจากรหัสเครื่องสแกนที่ต้องตรงกับ
 * สติกเกอร์บนตัวเครื่องจริง — ตัวนั้นยังให้กรอกเองอยู่
 */
function nextCode(prefix: string, existing: readonly { code?: string }[]): string {
  const used = new Set(existing.map((item) => (item.code ?? "").toUpperCase()));
  for (let n = 1; n <= 999; n += 1) {
    const code = `${prefix}${String(n).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
  // เต็ม 999 แล้วจริง ๆ (ไม่น่าเกิด) — กันไม่ให้คืนรหัสซ้ำเงียบ ๆ
  return `${prefix}${Date.now().toString(36).toUpperCase().slice(-4)}`;
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
  const name = String(formData.get("name") ?? "").trim();
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");
  const restDay = formData.get("rest_day") === "1";

  if (!companyId) throw new Error("ยังไม่มีบริษัทในระบบ workforce");
  if (!name) throw new Error("กรุณากรอกชื่อกะ");
  if (!start || !end) throw new Error("กรุณาระบุเวลาเข้า-ออก");

  try {
    const existing = await wfFetch<Paged<{ code: string }>>(
      `/shifts?company_id=${companyId}`,
    );
    await wfFetch("/shifts", {
      method: "POST",
      body: {
        company_id: companyId,
        // แยกคำนำหน้าให้กะวันหยุด — หน้าลงวันหยุดต้องหยิบกะประเภทนี้ไปใช้
        // เห็น OFF01 แล้วรู้ทันทีว่าคือใบไหน ต่างจาก SHIFT03 ที่ต้องเปิดดู
        code: nextCode(restDay ? "OFF" : "SHIFT", existing.items),
        name,
        start,
        end,
        crosses_midnight: formData.get("crosses_midnight") === "1",
        rest_day: restDay,
        // ไม่ผูกนโยบาย = ไม่มีเกณฑ์ผ่อนผัน ⇒ สายนาทีเดียวก็นับสาย
        work_policy_id: orNull(formData.get("work_policy_id")),
      },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/shifts");
}

/**
 * นโยบายการทำงาน — เกณฑ์ว่า "สายได้กี่นาที" ก่อนจะถูกนับว่าสาย
 *
 * late_mode 3 แบบต่างกันเป็นเงินจริง:
 *   STRICT = สายนาทีเดียวก็นับ
 *   GRACE  = ผ่อนผัน grace_minutes แรก (บังคับว่าต้อง > 0)
 *   FLEX   = เข้าได้ในช่วง flex_start-flex_end ขอให้ทำครบตามชั่วโมงที่กำหนด
 */
export async function createWorkPolicyAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const companyId = String(formData.get("company_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const lateMode = String(formData.get("late_mode") ?? "GRACE");
  const graceMinutes = Number(formData.get("grace_minutes") ?? 0);
  const effectiveFrom = String(formData.get("effective_from") ?? "");

  if (!companyId) throw new Error("ยังไม่มีบริษัทในระบบ workforce");
  if (!name) throw new Error("กรุณากรอกชื่อนโยบาย");
  if (!effectiveFrom) throw new Error("กรุณาระบุวันที่เริ่มใช้");
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 240) {
    throw new Error("เวลาผ่อนผันต้องเป็น 0-240 นาที");
  }
  // ดักตั้งแต่ที่นี่แทนปล่อยไปโดน 422 — ข้อความของ API เป็นอังกฤษและอ่านยากกว่า
  if (lateMode === "GRACE" && graceMinutes === 0) {
    throw new Error("เลือก \"ผ่อนผัน\" แล้วต้องกำหนดเวลาผ่อนผันมากกว่า 0 นาที");
  }

  try {
    const existing = await wfFetch<Paged<{ code: string }>>("/work-policies");
    await wfFetch("/work-policies", {
      method: "POST",
      body: {
        company_id: companyId,
        code: nextCode("POLICY", existing.items),
        name,
        late_mode: lateMode,
        grace_minutes: graceMinutes,
        grace_deduction: String(formData.get("grace_deduction") ?? "EXCESS_OVER_GRACE"),
        early_out_tolerance_minutes: Number(
          formData.get("early_out_tolerance_minutes") ?? 0,
        ),
        ot_requires_approval: formData.get("ot_requires_approval") === "1",
        effective_from: effectiveFrom,
      },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/shifts");
}

/**
 * ผูกกะกับพนักงานรายวันจันทร์-อาทิตย์
 *
 * ไม่ต้องสร้าง roster ก่อน — ตอนคำนวณผลลงเวลา ระบบอ่านตารางนี้ตรง ๆ
 * ตาม employment + วันที่ (attendance.repository.ts) ตั้งแล้วมีผลทันที
 *
 * คืนเป็นค่าไม่ throw เพราะฟอร์มมี 7 ช่อง ถ้าเด้ง error page ผู้ใช้ต้องกรอกใหม่หมด
 */
export interface PatternState {
  ok?: boolean;
  error?: string;
}

const WEEKDAY_FIELDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export async function setRecurringPatternAction(
  _prev: PatternState,
  formData: FormData,
): Promise<PatternState> {
  try {
    await guard(HR_PERMS.settingManage);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const employmentId = String(formData.get("employment_id") ?? "");
  const effectiveFrom = String(formData.get("effective_from") ?? "");
  if (!employmentId) return { error: "กรุณาเลือกพนักงาน" };
  if (!effectiveFrom) return { error: "กรุณาระบุวันที่เริ่มใช้" };

  const days = Object.fromEntries(
    WEEKDAY_FIELDS.map((day) => [`${day}_shift_id`, orNull(formData.get(day))]),
  );
  if (Object.values(days).every((value) => value === null)) {
    return { error: "ต้องเลือกกะอย่างน้อยหนึ่งวัน ไม่งั้นเท่ากับไม่ได้ตั้งอะไรเลย" };
  }

  try {
    await wfFetch("/recurring-work-patterns", {
      method: "POST",
      body: {
        employment_id: employmentId,
        ...days,
        effective_from: effectiveFrom,
        effective_to: null,
        // ปิดตารางเดิมของคนนี้ให้อัตโนมัติ ไม่งั้นสองใบทับกันแล้วผลคำนวณกำกวม
        supersede_current: true,
      },
    });
  } catch (error) {
    return { error: toMessage(error) };
  }

  revalidatePath("/hr/shifts");
  return { ok: true };
}

/**
 * สั่งคำนวณผลลงเวลาใหม่
 *
 * การสแกนถูกเก็บเป็น raw_time_events ทันที แต่ไม่กลายเป็น attendance_results เอง —
 * ต้องมีคนสั่งคำนวณ ระบบถึงจะเอาไปเทียบกับกะแล้วสรุปว่าสาย/ขาด/OT กี่นาที
 * หน้า "ผลลงเวลา" อ่านจากตารางผลลัพธ์ ไม่ได้อ่าน raw event ⇒ ถ้าไม่เคยสั่งคำนวณ
 * จะขึ้น 0 ทุกช่องทั้งที่สแกนติดแล้ว ซึ่งอ่านแล้วนึกว่าเครื่องไม่ส่งข้อมูล
 *
 * API คำนวณทีละคน จึงต้องวนเองเมื่อเลือก "ทุกคน"
 */
export interface RecalcState {
  ok?: boolean;
  people?: number;
  failed?: number;
  error?: string;
}

export async function recalculateAttendanceAction(
  _prev: RecalcState,
  formData: FormData,
): Promise<RecalcState> {
  try {
    await guard(HR_PERMS.employeeView);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const target = String(formData.get("employment_id") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  if (!from || !to) return { error: "ไม่พบช่วงวันที่" };

  let ids: string[];
  if (target === "ALL") {
    try {
      const list = await wfFetch<Paged<{ id: string; terminated_on: string | null }>>(
        "/employments",
      );
      ids = list.items.filter((e) => e.terminated_on === null).map((e) => e.id);
    } catch (error) {
      return { error: toMessage(error) };
    }
    if (ids.length === 0) return { error: "ยังไม่มีพนักงานในระบบ" };
  } else {
    if (!target) return { error: "กรุณาเลือกพนักงาน" };
    ids = [target];
  }

  // ล้มทีละคน ไม่ล้มทั้งชุด — คนที่คำนวณสำเร็จต้องไม่ถูกทิ้งเพราะเพื่อนข้อมูลไม่ครบ
  let failed = 0;
  for (const employmentId of ids) {
    try {
      await wfFetch("/attendance-results:recalculate", {
        method: "POST",
        body: { employment_id: employmentId, from, to },
      });
    } catch {
      failed += 1;
    }
  }

  if (failed === ids.length) {
    return { error: "คำนวณไม่สำเร็จสักคน — ตรวจว่าผูกกะให้พนักงานแล้วหรือยัง" };
  }

  revalidatePath("/hr/attendance");
  return { ok: true, people: ids.length - failed, failed };
}

/* ═══════════════════ วันหยุด ═══════════════════ */

/**
 * เพิ่มวันหยุด — สร้างปฏิทินให้อัตโนมัติถ้ายังไม่มี
 *
 * ผู้ใช้ไม่ควรต้องรู้จักคำว่า "ปฏิทินวันหยุด" ก่อนจะลงวันหยุดได้สักวัน
 * ทุกบริษัทใช้ใบเดียว (findHoliday จับคู่ด้วย company_id ไม่สนว่าปฏิทินไหน)
 * การให้เลือกปฏิทินจึงเป็นตัวเลือกที่ไม่มีความหมายกับผู้ใช้
 */
export interface HolidayState {
  ok?: boolean;
  added?: string;
  error?: string;
}

export async function addHolidayAction(
  _prev: HolidayState,
  formData: FormData,
): Promise<HolidayState> {
  try {
    await guard(HR_PERMS.settingManage);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const companyId = String(formData.get("company_id") ?? "");
  const date = String(formData.get("holiday_date") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!companyId) return { error: "ยังไม่มีบริษัทในระบบ workforce" };
  if (!date) return { error: "กรุณาเลือกวันที่" };
  if (!name) return { error: "กรุณาตั้งชื่อวันหยุด" };

  try {
    const existing = await wfFetch<Paged<{ id: string; company_id: string }>>(
      `/holiday-calendars?company_id=${companyId}`,
    );
    let calendarId = existing.items[0]?.id;

    if (calendarId === undefined) {
      const created = await wfFetch<{ id: string }>("/holiday-calendars", {
        method: "POST",
        body: { company_id: companyId, code: "MAIN", name: "วันหยุดบริษัท" },
      });
      calendarId = created.id;
    }

    await wfFetch(`/holiday-calendars/${calendarId}/dates`, {
      method: "POST",
      body: {
        dates: [
          { holiday_date: date, name, paid: formData.get("paid") !== "0" },
        ],
      },
    });
  } catch (error) {
    return { error: toMessage(error) };
  }

  revalidatePath("/hr/holidays");
  return { ok: true, added: date };
}

export async function deleteHolidayAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const id = String(formData.get("holidayDateId") ?? "");
  if (!id) throw new Error("ไม่พบวันหยุด");

  try {
    await wfFetch(`/holiday-dates/${id}/delete`, { method: "POST" });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/holidays");
}

/**
 * ลงวันหยุดของพนักงานหนึ่งคน ทั้งเดือนในครั้งเดียว
 *
 * ── ทำไมต้องส่งทั้งเดือน ไม่ใช่เฉพาะวันที่หยุด ──
 * roster เป็นตัวทับ recurring pattern รายวัน (resolveShiftId ดู roster ก่อน)
 * ถ้าส่งเฉพาะวันหยุด การ "ยกเลิกวันหยุด" จะทำไม่ได้ เพราะแถวเดิมยังค้างอยู่
 * ⇒ ให้ตารางเดือนนั้นเป็นแหล่งความจริงทั้งเดือนไปเลย วันไหนไม่หยุดก็ใส่กะปกติ
 *
 * ── ทำไมต้องสร้าง roster ใบใหม่ทุกครั้ง ──
 * bulkUpsertAssignments ปฏิเสธตารางที่ publish แล้ว (แก้เงียบ ๆ ไม่ได้ตามเจตนา)
 * การแก้จึงต้องเป็นใบใหม่เสมอ — publishRoster ล้างแถวของวันเดียวกันจากใบเก่าให้
 */
export interface DaysOffState {
  ok?: boolean;
  offDays?: number;
  error?: string;
}

export async function setEmployeeDaysOffAction(
  _prev: DaysOffState,
  formData: FormData,
): Promise<DaysOffState> {
  try {
    await guard(HR_PERMS.settingManage);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const companyId = String(formData.get("company_id") ?? "");
  const employmentId = String(formData.get("employment_id") ?? "");
  const month = String(formData.get("month") ?? "");
  const workShiftId = String(formData.get("work_shift_id") ?? "");
  const restShiftId = String(formData.get("rest_shift_id") ?? "");
  const offDays = formData.getAll("off").map(String);

  if (!companyId) return { error: "ยังไม่มีบริษัทในระบบ workforce" };
  if (!employmentId) return { error: "กรุณาเลือกพนักงาน" };
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "เดือนไม่ถูกต้อง" };
  if (!workShiftId) return { error: "กรุณาเลือกกะสำหรับวันทำงาน" };
  if (!restShiftId) return { error: "ต้องมีกะประเภทวันหยุดก่อน — สร้างที่หน้า “กะทำงาน”" };

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  const startsOn = `${month}-01`;
  const endsOn = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const offSet = new Set(offDays);

  const assignments = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return {
      employment_id: employmentId,
      work_date: date,
      shift_id: offSet.has(date) ? restShiftId : workShiftId,
      note: offSet.has(date) ? "วันหยุดของพนักงาน" : "",
    };
  });

  try {
    const roster = await wfFetch<{ id: string }>("/roster-periods", {
      method: "POST",
      body: {
        company_id: companyId,
        // ใส่เวลาไว้ในชื่อเพื่อให้ไล่ย้อนได้ว่าใบไหนมาทีหลัง — มีหลายใบต่อเดือนแน่นอน
        name: `วันหยุด ${month} · ${new Date().toISOString().slice(11, 19)}`,
        starts_on: startsOn,
        ends_on: endsOn,
      },
    });

    await wfFetch(`/roster-periods/${roster.id}/shift-assignments:bulk-upsert`, {
      method: "POST",
      body: { assignments },
    });

    // ยังไม่ publish = ยังไม่มีผลกับการคำนวณเลย ขั้นนี้ข้ามไม่ได้
    await wfFetch(`/roster-periods/${roster.id}/publish`, { method: "POST" });
  } catch (error) {
    return { error: toMessage(error) };
  }

  revalidatePath("/hr/holidays");
  return { ok: true, offDays: offDays.length };
}

/* ═══════════════════ วันลา / วันหยุดของพนักงาน ═══════════════════ */

/**
 * พนักงานขอลาเอง
 *
 * ใช้ระบบ leave ของ workforce ไม่ใช่ปฏิทินของโมดูล PM — เพราะ **เฉพาะใบที่
 * APPROVED เท่านั้นที่เข้าการคำนวณผลลงเวลา** (attendance.service เรียก
 * approvedMinutesByDate) ปฏิทินของ PM เก็บใน ReportTaskStore คนละที่
 * และไม่มีผลกับเงินเดือน/ผลลงเวลาเลย
 *
 * ไม่ต้องมี hr.* permission — role EMPLOYEE ของ workforce มี
 * workforce.leave.request ติดตัวทุกคนอยู่แล้ว และ API ตรวจซ้ำเองอีกชั้น
 */
export interface LeaveState {
  ok?: boolean;
  days?: number;
  error?: string;
}

export async function submitLeaveAction(
  _prev: LeaveState,
  formData: FormData,
): Promise<LeaveState> {
  await requireOrg();

  const employmentId = String(formData.get("employment_id") ?? "");
  const leaveTypeId = String(formData.get("leave_type_id") ?? "");
  const dates = formData.getAll("day").map(String).sort();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!employmentId) {
    return { error: "บัญชีนี้ยังไม่ถูกผูกกับทะเบียนพนักงาน — แจ้งฝ่ายบุคคล" };
  }
  if (!leaveTypeId) return { error: "กรุณาเลือกประเภทการลา" };
  if (dates.length === 0) return { error: "คลิกเลือกวันที่จะหยุดก่อน" };

  /*
   * ส่งทีละใบต่อหนึ่งวัน ไม่รวบเป็นช่วงเดียว — วันที่เลือกอาจไม่ติดกัน
   * (เช่นหยุดจันทร์กับศุกร์) ถ้ารวบเป็น starts_on..ends_on จะกินวันกลางไปด้วย
   */
  let failed = 0;
  for (const day of dates) {
    try {
      await wfFetch("/leave-requests", {
        method: "POST",
        body: {
          employment_id: employmentId,
          leave_type_id: leaveTypeId,
          starts_on: day,
          ends_on: day,
          total_minutes: 480,
          reason,
        },
      });
    } catch {
      failed += 1;
    }
  }

  if (failed === dates.length) {
    return { error: "ส่งคำขอไม่สำเร็จ — อาจขอวันเดิมไปแล้ว หรือโควตาไม่พอ" };
  }

  revalidatePath("/hr/leave");
  return { ok: true, days: dates.length - failed };
}

/** อนุมัติ/ไม่อนุมัติคำขอลา — ต้องมี workforce.leave.approve (SUPERVISOR ขึ้นไป) */
export async function decideLeaveAction(formData: FormData) {
  await requireOrg();
  const id = String(formData.get("requestId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!id) throw new Error("ไม่พบคำขอ");
  if (outcome !== "APPROVED" && outcome !== "REJECTED") throw new Error("ผลไม่ถูกต้อง");

  try {
    await wfFetch(`/leave-requests/${id}/decide`, {
      method: "POST",
      body: {
        outcome,
        reason:
          String(formData.get("reason") ?? "").trim() ||
          (outcome === "APPROVED" ? "อนุมัติจากปฏิทินวันหยุด" : "ไม่อนุมัติ"),
      },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/leave");
}

/** ประเภทการลา — ต้องมีอย่างน้อยหนึ่งอันก่อนพนักงานจะขอลาได้ */
export async function createLeaveTypeAction(formData: FormData) {
  await guard(HR_PERMS.settingManage);
  const companyId = String(formData.get("company_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!companyId) throw new Error("ยังไม่มีบริษัทในระบบ workforce");
  if (!name) throw new Error("กรุณากรอกชื่อประเภทการลา");

  try {
    const existing = await wfFetch<Paged<{ code: string }>>("/leave-types");
    await wfFetch("/leave-types", {
      method: "POST",
      body: {
        company_id: companyId,
        code: nextCode("LEAVE", existing.items),
        name,
        paid: formData.get("paid") !== "0",
        unit: "DAY",
        quota_minutes_per_year: Number(formData.get("quota_days") ?? 0) * 480,
        // ไม่บังคับแจ้งล่วงหน้า/แนบเอกสารในเวอร์ชันแรก — เพิ่มทีหลังได้ที่ API เดิม
        effective_from: new Date().toISOString().slice(0, 10),
      },
    });
  } catch (error) {
    throw new Error(toMessage(error));
  }
  revalidatePath("/hr/leave");
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

  if (!employmentId) return { error: "กรุณาเลือกพนักงาน" };
  if (!deviceId) return { error: "กรุณาเลือกเครื่องสแกน" };

  /*
   * หา slot ว่างเอง ไม่ให้ผู้ใช้กรอก
   *
   * slot เป็นช่องเก็บ template ใน **ตัวเครื่อง** ไม่ใช่ของคน คนกรอกจึงไม่มีทาง
   * รู้ว่าเลขไหนว่างบนเครื่องนั้น เดาแล้วชนก็ได้แค่ 409 กลับมาแบบไม่มีคำใบ้
   *
   * ต้องนับจากทุกคนบนเครื่องนั้น ไม่ใช่จากนิ้วของคนที่กำลังตั้งค่า —
   * ถ้านับจากคนเดียว พนักงานใหม่ทุกคนจะได้ slot 1 แล้วชนกันหมด
   */
  let slot: number;
  try {
    const onDevice = await wfFetch<Paged<{ template_slot: number; status: string }>>(
      `/biometric-enrollments?device_id=${deviceId}`,
    );
    const used = new Set(
      onDevice.items
        .filter((en) => en.status !== "DELETED")
        .map((en) => en.template_slot),
    );
    let candidate = 1;
    while (used.has(candidate) && candidate < 1000) candidate += 1;
    if (candidate >= 1000) {
      return { error: "เครื่องนี้เก็บลายนิ้วมือเต็มแล้ว — ลบของคนที่ลาออกออกก่อน" };
    }
    slot = candidate;
  } catch (error) {
    return { error: toMessage(error) };
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
