import "server-only";
import { cookies } from "next/headers";

/**
 * เรียก workforce API จากฝั่งเซิร์ฟเวอร์ของ Next.js
 *
 * token ของ Smartboss อยู่ใน httpOnly cookie (`sb_access`) — อ่านได้เฉพาะฝั่งนี้
 * แล้วส่งต่อเป็น Bearer ให้ workforce ซึ่งตั้ง AUTH_PROVIDER=smartboss ไว้
 * จึงตรวจ token ใบเดียวกันได้ (ดู docs/workforce_integration.md ข้อ 2)
 *
 * ทุก mutation ต้องมี Idempotency-Key (ADR-0008 ของ workforce) — ใส่ให้อัตโนมัติ
 */

export const WORKFORCE_API_BASE =
  process.env.WORKFORCE_API_BASE ?? "http://127.0.0.1:4100/api/workforce/v1";

const COOKIE_ACCESS = "sb_access";

/** error ของ workforce เป็น RFC 7807 problem+json */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  errors?: { path: string; message: string }[];
}

export class WorkforceError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail;

  constructor(problem: ProblemDetail) {
    super(problem.title);
    this.name = "WorkforceError";
    this.status = problem.status;
    this.problem = problem;
  }

  /** ข้อความพร้อมแสดงผล — รวม validation รายช่องถ้ามี */
  get displayMessage(): string {
    const fields = this.problem.errors ?? [];
    if (fields.length > 0) {
      return fields.map((e) => `${e.path}: ${e.message}`).join("\n");
    }
    return this.problem.detail ?? this.problem.title;
  }
}

/** ต่อ API ไม่ได้เลย (ยังไม่ได้สตาร์ต / เน็ตล่ม) — แยกจาก error ที่ API ตอบกลับมา */
export class WorkforceUnavailableError extends Error {
  constructor(cause: unknown) {
    super("เชื่อมต่อระบบบุคคลไม่ได้");
    this.name = "WorkforceUnavailableError";
    this.cause = cause;
  }
}

export interface Paged<T> {
  items: T[];
  next_cursor?: string | null;
}

interface FetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
}

export async function wfFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const token = (await cookies()).get(COOKIE_ACCESS)?.value;

  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    headers["idempotency-key"] = options.idempotencyKey ?? crypto.randomUUID();
  }

  let response: Response;
  try {
    response = await fetch(`${WORKFORCE_API_BASE}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      // ข้อมูลบุคคล/เงินเดือนเปลี่ยนตลอด — ห้ามให้ Next cache ไว้ข้ามคำขอ
      cache: "no-store",
    });
  } catch (error) {
    throw new WorkforceUnavailableError(error);
  }

  const text = await response.text();
  const parsed: unknown = text === "" ? null : JSON.parse(text);

  if (!response.ok) {
    const problem = parsed as ProblemDetail | null;
    throw new WorkforceError(
      problem ?? {
        type: "about:blank",
        title: `HTTP ${response.status}`,
        status: response.status,
        code: "UNKNOWN",
      }
    );
  }

  return parsed as T;
}

/**
 * เรียกแบบไม่ให้ล้มทั้งหน้า — คืน null เมื่อ API ใช้ไม่ได้หรือไม่มีสิทธิ์
 *
 * หน้าภาพรวมดึงหลายอย่างพร้อมกัน ผู้ใช้บางคนมีสิทธิ์แค่บางส่วน
 * ถ้าปล่อยให้ 403 ล้มทั้งหน้า คนที่มีสิทธิ์บางส่วนจะเข้าหน้าไม่ได้เลย
 */
export async function wfTry<T>(path: string): Promise<T | null> {
  try {
    return await wfFetch<T>(path);
  } catch {
    return null;
  }
}

/* ────────── shape ที่ API คืนกลับมา ────────── */

export interface Me {
  principal_id: string;
  tenant_id: string;
  subject: string;
  display_name: string;
  permissions: string[];
  roles: { code: string; company_id: string | null }[];
}

export interface Employment {
  id: string;
  company_id: string;
  person_id: string;
  employee_code: string;
  display_name: string;
  full_name: string;
  employment_type: string;
  hired_on: string;
  terminated_on: string | null;
  status: string;
  time_zone: string;
}

export interface Person {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string;
  display_name: string;
  email: string | null;
  status: string;
}

export interface Company {
  id: string;
  code: string;
  legal_name: string;
  display_name: string;
  time_zone: string;
  currency: string;
}

export interface Device {
  id: string;
  company_id: string;
  device_code: string;
  name: string;
  device_type: string;
  status: string;
  firmware_version: string | null;
  last_seen_at: string | null;
  has_active_credential: boolean;
}

export interface PayrollRun {
  id: string;
  period_id: string;
  period_name?: string;
  run_type: string;
  status: string;
  locked_at: string | null;
}

export interface PayrollEmployeeResult {
  id: string;
  employment_id: string;
  currency: string;
  gross: string;
  total_deduction: string;
  employer_contribution: string;
  net_pay: string;
  warnings: string[];
  lines: {
    code: string;
    name: string;
    category: string;
    amount: string;
    employer_only: boolean;
  }[];
}

export interface Payslip {
  id: string;
  run_id: string;
  document_version: number;
  gross: string;
  total_deduction: string;
  net_pay: string;
  currency: string;
  published_at: string;
}

export interface TimesheetPeriod {
  id: string;
  company_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: string;
}

export interface Shift {
  id: string;
  company_id: string;
  code: string;
  name: string;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  status?: string;
}

export interface StatutoryRuleSet {
  id: string;
  rule_type: string;
  name: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  jurisdiction?: string;
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: string;
  actor_principal_id: string | null;
}

export interface EmployeeAttendanceStat {
  employment_id: string;
  days: number;
  worked_days: number;
  worked_minutes: number;
  late_minutes: number;
  late_days: number;
  early_out_minutes: number;
  absence_minutes: number;
  absent_days: number;
  ot_minutes: number;
}

export interface AttendanceSummary {
  from: string;
  to: string;
  totals: Omit<EmployeeAttendanceStat, "employment_id"> & { employees: number };
  employees: EmployeeAttendanceStat[];
}
