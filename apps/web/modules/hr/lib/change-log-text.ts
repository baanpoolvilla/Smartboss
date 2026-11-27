/**
 * รหัสใน workforce.audit_events → ประโยคภาษาไทยที่คนอ่านรู้เรื่อง + แถวเดิม→ใหม่
 * (Log การบันทึกระบบบุคคล — ผู้ใช้ 27/11/2569 "ใครเข้าไปแก้อะไรเวลาไหนอะไรยังไง")
 * ไฟล์นี้ไม่แตะฐานข้อมูล ทดสอบแยกได้ (change-log-text.test.ts)
 */

export const CHANGE_CATEGORIES = {
  people: "ข้อมูลพนักงาน",
  pay: "เงินเดือน/ค่าจ้าง",
  leave: "ลา",
  time: "แก้เวลาเข้างาน",
  ot: "OT",
  shift: "กะ/วันหยุด",
  money: "เบิกจ่าย/เงินสดย่อย",
  worker: "คนงานรายวัน",
  commission: "ค่าคอม/คะแนน",
  settings: "ตั้งค่า",
  device: "เครื่องสแกน/มือถือ",
  view: "เปิดดูข้อมูลลับ",
  checkin: "ลงเวลาปกติ",
} as const;

export type ChangeCategory = keyof typeof CHANGE_CATEGORIES;

export interface ChangeDetail {
  label: string;
  before: string | null;
  after: string | null;
}

type Obj = Record<string, unknown>;

/** ชื่อช่องภาษาไทย — ช่องที่ไม่อยู่ในนี้และลงท้าย _id ไม่แสดง (เป็นรหัสภายใน) */
const FIELD: Record<string, string> = {
  amount: "จำนวนเงิน",
  pay_basis: "ฐานค่าจ้าง",
  effective_from: "มีผลตั้งแต่",
  effective_to: "ถึงวันที่",
  note: "หมายเหตุ",
  currency: "สกุลเงิน",
  status: "สถานะ",
  first_name: "ชื่อ",
  last_name: "นามสกุล",
  preferred_name: "ชื่อเล่น",
  email: "อีเมล",
  phone: "เบอร์โทร",
  date_of_birth: "วันเกิด",
  national_id_present: "เลขบัตรประชาชน",
  employee_code: "รหัสพนักงาน",
  hired_on: "วันเริ่มงาน",
  terminated_on: "วันพ้นสภาพ",
  employment_type: "ประเภทการจ้าง",
  name: "ชื่อ",
  code: "รหัส",
  paid: "ได้ค่าจ้าง",
  unit: "หน่วย",
  starts_on: "วันเริ่ม",
  ends_on: "วันสิ้นสุด",
  total_minutes: "รวม",
  minutes: "จำนวน",
  entitled_days: "สิทธิ์ต่อปี (วัน)",
  approval_notice_days: "ต้องแจ้งล่วงหน้า (วัน)",
  holiday_valid_months: "วันหยุดชดเชยใช้ได้ (เดือน)",
  holiday_year_carry_months: "ยกไปปีหน้าได้ (เดือน)",
  accrues_from_holidays: "ได้วันหยุดชดเชยเมื่อทำงานวันหยุด",
  yearly_entitlement: "จำกัดสิทธิ์รายปี",
  monthly_quota: "โควตาต่อเดือน",
  month_allowance: "สิทธิ์ต่อเดือน",
  period_year: "ปี",
  year: "ปี",
  decision: "ผลตรวจ",
  review_outcome: "ผลตรวจ",
  title: "ชื่อตำแหน่ง",
  label: "ชื่อ",
  display_label: "ชื่อที่แสดง",
  reason: "เหตุผล",
  occurred_at: "เวลา",
  event_time: "เวลา",
  work_date: "วันที่",
  hours: "ชั่วโมง",
  timezone: "เขตเวลา",
};

const VALUE: Record<string, string> = {
  APPROVED: "อนุมัติ",
  REJECTED: "ไม่อนุมัติ",
  SUBMITTED: "รออนุมัติ",
  PENDING: "รออนุมัติ",
  CANCELLED: "ยกเลิก",
  ACTIVE: "ทำงานอยู่",
  TERMINATED: "พ้นสภาพ",
  MONTHLY: "รายเดือน",
  DAILY: "รายวัน",
  HOURLY: "รายชั่วโมง",
  DAY: "วัน",
  HOUR: "ชั่วโมง",
  ACCEPTED: "ผ่าน",
  true: "ใช่",
  false: "ไม่",
};

function isSkippedKey(k: string): boolean {
  // สกุลเงินเป็นบาทเสมอ ไม่ต้องขึ้น
  return k === "currency" || (!FIELD[k] && (k.endsWith("_id") || k.endsWith("_ids") || k === "id" || k === "version"));
}

function minutesText(m: number): string {
  if (!Number.isFinite(m)) return String(m);
  if (m % 480 === 0) return `${m / 480} วัน`;
  if (m >= 480) return `${Math.floor(m / 480)} วัน ${((m % 480) / 60).toLocaleString("th-TH", { maximumFractionDigits: 1 })} ชม.`;
  return `${(m / 60).toLocaleString("th-TH", { maximumFractionDigits: 1 })} ชม.`;
}

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function thaiDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  return `${Number(m[3])} ${THAI_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}

function baht(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}` : String(v);
}

/** ค่าหนึ่งช่อง → ข้อความ */
export function fieldValue(key: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (key === "national_id_present") return "ซ่อนไว้";
  if (key === "amount") return baht(v);
  if (key === "minutes" || key === "total_minutes") return minutesText(Number(v));
  if (typeof v === "boolean") return VALUE[String(v)]!;
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return thaiDay(v);
    return VALUE[v] ?? v;
  }
  if (typeof v === "number") return v.toLocaleString("th-TH");
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map((x) => fieldValue(key, x) ?? "—").join(", ");
  return JSON.stringify(v);
}

/** before/after → แถวที่เปลี่ยน (สร้างใหม่ = มีแต่ค่าใหม่ · ลบ = มีแต่ค่าเดิม) */
export function diffDetails(before: Obj | null, after: Obj | null): ChangeDetail[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !isSkippedKey(k));
  const out: ChangeDetail[] = [];
  for (const k of keys) {
    const bv = before ? fieldValue(k, b[k]) : null;
    const av = after ? fieldValue(k, a[k]) : null;
    if (before && after && JSON.stringify(b[k]) === JSON.stringify(a[k])) continue;
    if (bv === null && av === null) continue;
    out.push({ label: FIELD[k] ?? k, before: bv, after: av });
  }
  return out;
}

function categoryOf(action: string): ChangeCategory {
  if (action === "attendance.photo-checkin.commit") return "checkin";
  if (action === "attendance.evidence.read" || action === "payslip.download" || action === "payroll.export") return "view";
  if (action.startsWith("leave.type.") || action.startsWith("attendance.policy-group.") || action.startsWith("organization.") || action.startsWith("payroll.rule-set.") || action.startsWith("payroll.pay-item.")) return "settings";
  if (action.startsWith("leave.")) return "leave";
  if (action.startsWith("overtime.")) return "ot";
  if (action.startsWith("attendance.") || action.startsWith("time-event.")) return "time";
  if (action.startsWith("scheduling.") || action.startsWith("timesheet.")) return "shift";
  if (action.startsWith("device.") || action.startsWith("biometric.") || action.startsWith("mobile-device.")) return "device";
  if (action.startsWith("compensation.") || action.startsWith("payroll.") || action.startsWith("payslip.") || action.startsWith("bank.")) return "pay";
  return "people";
}

/** ชื่อการกระทำที่ไม่มีประโยคเฉพาะ */
const ACTION_LABEL: Record<string, string> = {
  "attendance.correction.request": "ขอแก้เวลาเข้า-ออกงาน",
  "attendance.correction.approve": "อนุมัติแก้เวลาเข้า-ออกงาน",
  "attendance.correction.reject": "ไม่อนุมัติแก้เวลาเข้า-ออกงาน",
  "attendance.evidence.read": "เปิดดูรูปถ่ายตอนลงเวลา",
  "attendance.exception.waive": "ตรวจการลงเวลาผิดปกติแล้ว ให้ผ่าน",
  "attendance.photo-checkin.commit": "ลงเวลาด้วยมือถือ",
  "attendance.policy-group.assign": "ย้ายกลุ่มกติกาลงเวลา",
  "attendance.policy-group.create": "สร้างกลุ่มกติกาลงเวลา",
  "attendance.policy-group.set-allowed-sites": "ตั้งสถานที่ลงเวลาที่อนุญาต",
  "bank.batch.create": "สร้างไฟล์โอนเงินเดือน",
  "bank.profile.create": "เพิ่มบัญชีธนาคาร",
  "biometric.enrollment.delete": "ลบลายนิ้วมือ",
  "biometric.enrollment.request": "สั่งลงทะเบียนลายนิ้วมือ",
  "compensation.rate.create": "ตั้งเงินเดือน/ค่าจ้าง",
  "compensation.rate.update": "แก้เงินเดือน/ค่าจ้าง",
  "device.activate": "เปิดใช้เครื่องสแกน",
  "device.activation-token.issue": "ออกรหัสเปิดใช้เครื่องสแกน",
  "device.clock.anomaly": "เวลาในเครื่องสแกนเพี้ยน",
  "device.command.ack": "เครื่องสแกนทำคำสั่งสำเร็จ",
  "device.command.fail": "เครื่องสแกนทำคำสั่งไม่สำเร็จ",
  "device.credential.revoke": "ยกเลิกสิทธิ์เครื่องสแกน",
  "device.provision": "เพิ่มเครื่องสแกน",
  "leave.balance.grant": "เพิ่มวันลาให้",
  "leave.balance.set_yearly": "ตั้งสิทธิ์วันลาต่อปี",
  "leave.request.cancel": "ยกเลิกใบลา",
  "leave.request.decide": "พิจารณาใบลา",
  "leave.request.relabel": "เปลี่ยนประเภทใบลา",
  "leave.request.submit": "ยื่นลา",
  "leave.type.approval_notice": "ตั้งจำนวนวันที่ต้องแจ้งลาล่วงหน้า",
  "leave.type.archive": "เลิกใช้ประเภทลา",
  "leave.type.create": "เพิ่มประเภทลา",
  "leave.type.holiday_accrual": "ตั้งการได้วันหยุดชดเชย",
  "leave.type.holiday_valid_months": "ตั้งอายุวันหยุดชดเชย",
  "leave.type.month_allowance": "ตั้งสิทธิ์ลาต่อเดือน",
  "leave.type.monthly_quota": "ตั้งโควตาลาต่อเดือน",
  "leave.type.person_grant": "ให้สิทธิ์ลาเฉพาะคน",
  "leave.type.rename": "เปลี่ยนชื่อประเภทลา",
  "leave.type.yearly_entitlement": "ตั้งสิทธิ์ลารายปี",
  "mobile-device.replacement.approve": "อนุมัติเปลี่ยนมือถือที่ใช้ลงเวลา",
  "organization.company.create": "เพิ่มบริษัท",
  "organization.company.update": "แก้ข้อมูลบริษัท",
  "organization.org-unit.create": "เพิ่มแผนก",
  "organization.position.create": "เพิ่มตำแหน่ง",
  "organization.site.create": "เพิ่มสถานที่ทำงาน",
  "organization.site.update": "แก้สถานที่ทำงาน",
  "overtime.request.decide-from-attendance": "อนุมัติ OT จากเวลาสแกน",
  "overtime.request.final-approve": "อนุมัติ OT",
  "overtime.request.pre-approve": "อนุมัติ OT ล่วงหน้า",
  "overtime.request.submit": "ขอ OT",
  "payroll.export": "ดาวน์โหลดข้อมูลเงินเดือน",
  "payroll.pay-item.create": "เพิ่มรายการเงินเดือน",
  "payroll.pay-item.publish": "เปิดใช้รายการเงินเดือน",
  "payroll.period.create": "สร้างงวดเงินเดือน",
  "payroll.rule-set.create": "สร้างกฎคำนวณเงินเดือน",
  "payroll.rule-set.publish": "เปิดใช้กฎคำนวณเงินเดือน",
  "payroll.run.approve": "อนุมัติรอบเงินเดือน",
  "payroll.run.calculate": "คำนวณรอบเงินเดือน",
  "payroll.run.create": "สร้างรอบเงินเดือน",
  "payroll.run.lock": "ล็อกรอบเงินเดือน",
  "payroll.run.mark-paid": "บันทึกจ่ายเงินเดือนแล้ว",
  "payroll.run.reject": "ตีกลับรอบเงินเดือน",
  "payroll.run.snapshot": "ดึงข้อมูลเข้ารอบเงินเดือน",
  "payroll.run.submit": "ส่งรอบเงินเดือนให้อนุมัติ",
  "payslip.download": "ดาวน์โหลดสลิป",
  "payslip.publish": "ปล่อยสลิปให้พนักงานเห็น",
  "people.assignment.create": "ตั้งตำแหน่ง/แผนก",
  "people.employment.create": "เพิ่มพนักงาน",
  "people.employment.terminate": "ตั้งพ้นสภาพพนักงาน",
  "people.employment.update": "แก้ข้อมูลการจ้าง",
  "people.person.create": "เพิ่มข้อมูลบุคคล",
  "people.person.update": "แก้ข้อมูลส่วนตัว",
  "scheduling.holiday-calendar.create": "สร้างปฏิทินวันหยุด",
  "scheduling.holiday-date.delete": "ลบวันหยุด",
  "scheduling.holiday.add": "เพิ่มวันหยุด",
  "scheduling.pattern.replace": "เปลี่ยนรูปแบบกะ",
  "scheduling.pattern.set": "ตั้งรูปแบบกะ",
  "scheduling.roster.assign": "จัดกะ",
  "scheduling.roster.create": "สร้างตารางกะ",
  "scheduling.roster.publish": "ประกาศตารางกะ",
  "scheduling.shift.create": "เพิ่มกะ",
  "scheduling.work-policy.create": "สร้างกติกาเวลาทำงาน",
  "time-event.quarantine": "กันเวลาสแกนที่ผิดปกติไว้ตรวจ",
  "timesheet.period.close": "ปิดรอบเวลาทำงาน",
  "timesheet.period.create": "สร้างรอบเวลาทำงาน",
  "timesheet.period.generate": "คำนวณรอบเวลาทำงาน",
  "timesheet.period.reopen": "เปิดรอบเวลาทำงานใหม่",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** ประโยคหลักของหนึ่งรายการ */
export function describeWorkforce(
  action: string,
  before: Obj | null,
  after: Obj | null,
  metadata: Obj,
  ctx: { leaveType: string | null },
): { category: ChangeCategory; text: string; details: ChangeDetail[] } {
  const category = categoryOf(action);
  const lt = ctx.leaveType ? `"${ctx.leaveType}"` : "";
  let text = actionLabel(action);
  let details = diffDetails(before, after);
  const a = after ?? {};
  const b = before ?? {};

  switch (action) {
    case "leave.request.submit": {
      const day = str(a.starts_on);
      const mins = Number(a.total_minutes);
      text = `ยื่นลา${lt ? ` ${lt}` : ""}${day ? ` ${thaiDay(day)}` : ""}${Number.isFinite(mins) && mins > 0 ? ` (${minutesText(mins)})` : ""}`;
      details = [];
      break;
    }
    case "leave.request.decide": {
      const s = str(a.status);
      text = `${s === "APPROVED" ? "อนุมัติ" : s === "REJECTED" ? "ไม่อนุมัติ" : "พิจารณา"}ใบลา${lt ? ` ${lt}` : ""}`;
      details = [];
      break;
    }
    case "leave.request.cancel":
      text = `ยกเลิกใบลา${lt ? ` ${lt}` : ""}`;
      details = [];
      break;
    case "compensation.rate.create": {
      const day = str(a.effective_from);
      text = `ตั้งเงินเดือน/ค่าจ้าง ${fieldValue("amount", a.amount) ?? ""} ${fieldValue("pay_basis", a.pay_basis) ?? ""}${day ? ` มีผล ${thaiDay(day)}` : ""}`.replace(/\s+/g, " ").trim();
      break;
    }
    case "compensation.rate.update":
      text = b.amount !== a.amount ? `แก้เงินเดือน/ค่าจ้าง ${fieldValue("amount", b.amount)} → ${fieldValue("amount", a.amount)}` : "แก้รายละเอียดเงินเดือน/ค่าจ้าง";
      break;
    case "leave.balance.set_yearly":
      text = `ตั้งสิทธิ์วันลาต่อปี${lt ? ` ${lt}` : ""}${a.year ? ` ปี ${Number(a.year) + 543}` : ""}`;
      break;
    case "leave.balance.grant": {
      const mins = Number(a.minutes);
      text = `เพิ่มวันลา${lt ? ` ${lt}` : ""}${Number.isFinite(mins) ? ` ${minutesText(mins)}` : ""}`;
      details = [];
      break;
    }
    case "people.employment.terminate": {
      const day = str(a.terminated_on);
      text = `ตั้งพ้นสภาพพนักงาน${day ? ` วันที่ ${thaiDay(day)}` : ""}`;
      break;
    }
    case "attendance.photo-checkin.commit":
      details = [];
      text = metadata.decision && metadata.decision !== "ACCEPTED" ? "ลงเวลาด้วยมือถือ (มีข้อสังเกต)" : "ลงเวลาด้วยมือถือ";
      break;
    default:
      if (lt && category === "settings" && action.startsWith("leave.type.")) text = `${text} ${lt}`;
  }
  return { category, text, details };
}
