import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "./types";
import { MAIN_COMPANY, companyDbId, companyKey, findCompany, hasMultipleCompanies, mainCompany, slipNumber, slipOrder, type PayCompany } from "./companies";

const main = mainCompany("บริษัทหลัก", { ...DEFAULT_SETTINGS, companyTaxId: "0105555000001", companyAddress: "กรุงเทพ" });
const b: PayCompany = { ...main, id: "b-1", name: "บริษัท B", main: false, retired: false };
const c: PayCompany = { ...main, id: "c-1", name: "บริษัท C", main: false, retired: true };

describe("บริษัทที่ออกเงินเดือน", () => {
  it("บริษัทหลักมาจากตั้งค่าเดิม", () => {
    expect(main).toMatchObject({ id: MAIN_COMPANY, name: "บริษัทหลัก", taxId: "0105555000001", address: "กรุงเทพ", main: true });
  });
  it("null / ไม่รู้จัก = บริษัทหลัก", () => {
    expect(companyKey(null)).toBe(MAIN_COMPANY);
    expect(findCompany([main, b], null).id).toBe(MAIN_COMPANY);
    expect(findCompany([main, b], "หายไปแล้ว").id).toBe(MAIN_COMPANY);
    expect(findCompany([main, b], "b-1").name).toBe("บริษัท B");
  });
  it("บริษัทหลักเก็บเป็น null ในฐานข้อมูล", () => {
    expect(companyDbId(MAIN_COMPANY)).toBeNull();
    expect(companyDbId("b-1")).toBe("b-1");
  });
  it("บริษัทเดียว หรือบริษัทอื่นเลิกใช้หมด = หน้าตาเดิม", () => {
    expect(hasMultipleCompanies([main])).toBe(false);
    expect(hasMultipleCompanies([main, c])).toBe(false);
    expect(hasMultipleCompanies([main, b, c])).toBe(true);
  });
});

describe("เลขที่สลิป", () => {
  it("PS-ปี พ.ศ.-เดือน-ลำดับ 4 หลัก", () => {
    expect(slipNumber("2026-12", 10)).toBe("PS-2569-12-0010");
  });
  it("ลำดับคงที่ตามรหัสพนักงาน ไม่ขึ้นกับลำดับที่อ่านมา", () => {
    const lines = [
      { employmentId: "x", employeeCode: "GL-012", name: "ข" },
      { employmentId: "y", employeeCode: "GL-002", name: "ก" },
      { employmentId: "z", employeeCode: "GL-010", name: "ค" },
    ];
    expect(slipOrder(lines, "y")).toBe(1);
    expect(slipOrder(lines, "z")).toBe(2);
    expect(slipOrder([...lines].reverse(), "x")).toBe(3);
  });
});
