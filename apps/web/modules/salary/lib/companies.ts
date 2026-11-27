import type { Tx } from "./db";
import type { SettingsView } from "./types";

/**
 * บริษัทที่ออกเงินเดือน (ผู้ใช้ 27/11/2569: มี 3 บริษัท แต่ละคนออกในนามบริษัทของตัวเอง)
 *
 *  - บริษัทหลัก = ข้อมูลเดิมใน salary.settings + ชื่อบริษัทในระบบ (id = MAIN_COMPANY) — ไม่ต้องย้ายข้อมูล
 *  - บริษัทอื่น = salary.companies (เพิ่ม/แก้/เลิกใช้ได้)
 *  - คนที่ไม่ได้เลือก (profiles.pay_company_id = null) และรอบเก่า (run_lines.company_id = null) = บริษัทหลัก
 *  ⇒ ยังไม่เพิ่มบริษัทอื่น ทุกหน้าเหมือนเดิมทุกอย่าง
 */

/** id ของบริษัทหลักในหน้าเว็บ/URL — ในฐานข้อมูลเก็บเป็น null */
export const MAIN_COMPANY = "main";

export interface PayCompany {
  /** MAIN_COMPANY หรือ salary.companies.id */
  id: string;
  name: string;
  taxId: string;
  branch: string;
  ssoEmployerNo: string;
  payBankName: string;
  payBankAccount: string;
  address: string;
  main: boolean;
  retired: boolean;
}

export function mainCompany(orgName: string, s: SettingsView): PayCompany {
  return {
    id: MAIN_COMPANY,
    name: orgName,
    taxId: s.companyTaxId,
    branch: s.ssoBranch,
    ssoEmployerNo: s.ssoEmployerNo,
    payBankName: s.payBankName,
    payBankAccount: s.payBankAccount,
    address: s.companyAddress,
    main: true,
    retired: false,
  };
}

/** บริษัทหลักก่อน แล้วบริษัทอื่นตามลำดับที่เพิ่ม (รวมที่เลิกใช้แล้ว — รอบเก่ายังต้องหาชื่อเจอ) */
export async function readCompanies(tx: Tx, orgId: string, orgName: string, settings: SettingsView): Promise<PayCompany[]> {
  const rows = await tx.salaryCompany.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  return [
    mainCompany(orgName, settings),
    ...rows.map((r) => ({
      id: r.id,
      name: r.name,
      taxId: r.taxId,
      branch: r.branch,
      ssoEmployerNo: r.ssoEmployerNo,
      payBankName: r.payBankName,
      payBankAccount: r.payBankAccount,
      address: r.address,
      main: false,
      retired: r.retiredAt !== null,
    })),
  ];
}

/** null/ไม่รู้จัก = บริษัทหลัก */
export function companyKey(id: string | null | undefined): string {
  return id || MAIN_COMPANY;
}

export function findCompany(list: PayCompany[], id: string | null | undefined): PayCompany {
  const key = companyKey(id);
  return list.find((c) => c.id === key) ?? list[0]!;
}

/** ค่าที่เก็บลงฐานข้อมูล: บริษัทหลัก = null */
export function companyDbId(id: string | null | undefined): string | null {
  return !id || id === MAIN_COMPANY ? null : id;
}

/** มีบริษัทอื่นที่ยังใช้อยู่ไหม — ไม่มี = ซ่อนทุกอย่างเรื่องบริษัท (หน้าตาเดิม) */
export function hasMultipleCompanies(list: PayCompany[]): boolean {
  return list.some((c) => !c.main && !c.retired);
}

/**
 * เลขที่สลิป เช่น PS-2569-12-0010 (ผู้ใช้ 27/11/2569)
 * ปี พ.ศ.-เดือนของงวด-ลำดับในรอบ (เรียงตามรหัสพนักงาน แล้วชื่อ) — รอบที่จ่ายแล้วรายชื่อไม่เปลี่ยน เลขจึงคงที่
 */
export function slipNumber(period: string, order: number): string {
  const [y, m] = period.split("-");
  return `PS-${Number(y) + 543}-${m}-${String(order).padStart(4, "0")}`;
}

export function slipOrder<T extends { employmentId: string; employeeCode: string; name: string }>(lines: T[], employmentId: string): number {
  const sorted = [...lines].sort(
    (a, b) => a.employeeCode.localeCompare(b.employeeCode, "en", { numeric: true }) || a.name.localeCompare(b.name, "th") || a.employmentId.localeCompare(b.employmentId),
  );
  return sorted.findIndex((l) => l.employmentId === employmentId) + 1;
}
