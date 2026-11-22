/**
 * ช่องทางการเงินของบริษัท (ลอกแนว PEAK "ช่องทางการเงิน") — ผู้ใช้ 22/11/2569
 *   บัญชีธนาคารบริษัทตั้งไว้ในตั้งค่า · บันทึกโอนต้องเลือกว่าโอนจากบัญชีไหน
 *   รายการหัก ณ ที่จ่าย (บริษัทเปิดสวิตช์) ต้องโอนจากบัญชีบริษัทเท่านั้น — เอาไปหักภาษีได้ชัด ไม่ใช่เงินสด/บัญชีส่วนตัว
 *   อ่านชื่อ/เลขบัญชีผู้โอนจากสลิป เทียบกับบัญชีที่เลือก — ไม่ตรง = เตือน (ไม่บล็อก: AI อ่านพลาดได้)
 * ฟังก์ชันล้วน ทดสอบได้
 */

export interface CompanyAccount {
  id: string;
  bankName: string;
  accountNo: string;
  accountName: string;
}

const digits = (s: string) => s.replace(/\D/g, "");

/** อ่านจากฐานข้อมูล/ฟอร์ม — รายการที่ไม่ครบตัดทิ้ง */
export function parseCompanyAccounts(value: unknown): CompanyAccount[] {
  if (!Array.isArray(value)) return [];
  const out: CompanyAccount[] = [];
  for (const raw of value.slice(0, 20)) {
    const a = raw as Partial<CompanyAccount>;
    const id = typeof a?.id === "string" && /^[a-z0-9-]{4,40}$/i.test(a.id) ? a.id : null;
    const bankName = String(a?.bankName ?? "").trim().slice(0, 60);
    const accountNo = String(a?.accountNo ?? "").trim().slice(0, 30);
    const accountName = String(a?.accountName ?? "").trim().slice(0, 120);
    if (!id || !bankName || digits(accountNo).length < 6 || !accountName) continue;
    out.push({ id, bankName, accountNo, accountName });
  }
  return out;
}

/** "กสิกรไทย xxx-x-x1234-x (บจก. บ้านพูลวิลล่า)" — เก็บไว้กับการจ่ายแต่ละครั้ง (แก้บัญชีทีหลัง ของเดิมไม่เปลี่ยน) */
export function accountLabel(a: CompanyAccount): string {
  const d = digits(a.accountNo);
  return `${a.bankName} ${d.length > 4 ? `xxx-${d.slice(-4)}` : a.accountNo} (${a.accountName})`;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/บริษัท|บจก\.?|ห้างหุ้นส่วนจำกัด|หจก\.?|จำกัด|\(มหาชน\)|co\.?,?|ltd\.?|company|limited|นาย|นาง|นางสาว|น\.ส\./g, "")
    .replace(/[^a-z0-9ก-๙]/g, "");

/**
 * ผู้โอนในสลิปตรงกับบัญชีที่เลือกไหม — เลข 4 ตัวท้ายที่อ่านได้ตรง หรือชื่อบัญชีตรง (ตัดคำนำหน้า บจก./จำกัด ออก)
 * null = สลิปไม่บอก (อ่านไม่ได้) · true/false = ตรง/ไม่ตรง
 */
export function slipFromMatches(slip: { fromName?: string | null; fromAccount?: string | null } | null | undefined, account: CompanyAccount): boolean | null {
  if (!slip) return null;
  const nameRead = norm(slip.fromName ?? "");
  const hasName = nameRead.length >= 3;
  const accMatch = accountNoMatches(slip.fromAccount ?? "", digits(account.accountNo));
  if (accMatch === null && !hasName) return null;
  if (accMatch === true) return true;
  const mine = norm(account.accountName);
  if (hasName && mine.length >= 3 && (nameRead.includes(mine) || mine.includes(nameRead))) return true;
  return false;
}

/**
 * เลขบัญชีในสลิป (ธนาคารไทยปิดบางหลักด้วย x ตามตำแหน่ง เช่น xxx-x-x6789-x) เทียบกับเลขบัญชีเต็ม
 * ความยาวเท่ากัน = เทียบทีละตำแหน่งที่อ่านได้ · ไม่เท่า = ตัวเลขช่วงที่เห็นต้องอยู่ในเลขบัญชี · อ่านได้ไม่ถึง 3 หลัก = null
 */
function accountNoMatches(slipNo: string, accDigits: string): boolean | null {
  const mask = slipNo.replace(/[^0-9xX*•]/g, "").toLowerCase();
  const shown = mask.replace(/[^0-9]/g, "");
  if (shown.length < 3 || accDigits.length < 6) return null;
  if (mask.length === accDigits.length) return [...mask].every((c, i) => !/[0-9]/.test(c) || c === accDigits[i]);
  const runs = mask.split(/[^0-9]+/).filter((x) => x.length >= 3);
  return runs.length > 0 && runs.every((run) => accDigits.includes(run));
}

/** รายการนี้ต้องโอนจากบัญชีบริษัทไหม (บริษัทเปิดสวิตช์ + มีหัก ณ ที่จ่าย) */
export function mustUseCompanyAccount(settings: { whtCompanyOnly: boolean }, whtAmount: number): boolean {
  return settings.whtCompanyOnly && whtAmount > 0.005;
}
