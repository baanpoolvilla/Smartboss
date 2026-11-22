import { describe, expect, it } from "vitest";
import { accountLabel, mustUseCompanyAccount, parseCompanyAccounts, slipFromMatches, type CompanyAccount } from "./company-accounts";

const acc: CompanyAccount = { id: "acc-1", bankName: "กสิกรไทย", accountNo: "123-4-56789-0", accountName: "บจก. บ้านพูลวิลล่า" };

describe("บัญชีบริษัท", () => {
  it("อ่านจากฐานข้อมูล: ตัดรายการไม่ครบ", () => {
    expect(parseCompanyAccounts([acc, { ...acc, id: "acc-2", accountNo: "12" }, { ...acc, id: "acc-3", accountName: "" }, "x"]).map((a) => a.id)).toEqual(["acc-1"]);
  });
  it("ชื่อที่แสดงซ่อนเลขบัญชีเหลือ 4 ตัวท้าย", () => {
    expect(accountLabel(acc)).toBe("กสิกรไทย xxx-7890 (บจก. บ้านพูลวิลล่า)");
  });
  it("หัก ณ ที่จ่าย + เปิดสวิตช์ = ต้องโอนจากบัญชีบริษัท", () => {
    expect(mustUseCompanyAccount({ whtCompanyOnly: true }, 60)).toBe(true);
    expect(mustUseCompanyAccount({ whtCompanyOnly: true }, 0)).toBe(false);
    expect(mustUseCompanyAccount({ whtCompanyOnly: false }, 60)).toBe(false);
  });
});

describe("ผู้โอนในสลิปตรงกับบัญชีที่เลือกไหม", () => {
  it("เลขบัญชีที่ธนาคารปิดบางหลัก เทียบตามตำแหน่ง", () => {
    expect(slipFromMatches({ fromAccount: "xxx-x-x6789-x" }, acc)).toBe(true); // 123-4-56789-0 ตำแหน่งตรง
    expect(slipFromMatches({ fromAccount: "xxx-x-x7890-x" }, acc)).toBe(false); // ตัวเลขตรงแต่คนละตำแหน่ง = คนละบัญชี
    expect(slipFromMatches({ fromAccount: "X6789" }, acc)).toBe(true); // ไม่ครบหลัก: ช่วงที่เห็นอยู่ในเลขบัญชี
    expect(slipFromMatches({ fromAccount: "xxx-x-x1111-x" }, acc)).toBe(false);
  });
  it("ชื่อบัญชีตรง ไม่สนคำนำหน้า บจก./จำกัด", () => {
    expect(slipFromMatches({ fromName: "บริษัท บ้านพูลวิลล่า จำกัด" }, acc)).toBe(true);
    expect(slipFromMatches({ fromName: "BAANPOOL" }, { ...acc, accountName: "Baanpool Villa Co., Ltd." })).toBe(true);
  });
  it("ชื่อคนอื่น / บัญชีส่วนตัว = ไม่ตรง", () => {
    expect(slipFromMatches({ fromName: "นางสาว กนิษฐา ใจดี", fromAccount: "xxx-x-x1111-x" }, acc)).toBe(false);
  });
  it("สลิปไม่บอกผู้โอน = ไม่รู้ (ไม่เตือน)", () => {
    expect(slipFromMatches({ fromName: null, fromAccount: null }, acc)).toBeNull();
    expect(slipFromMatches(null, acc)).toBeNull();
  });
});
