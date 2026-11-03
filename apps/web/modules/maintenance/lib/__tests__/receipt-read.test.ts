import assert from "node:assert/strict";
import { normalizeReceipt, receiptHasData } from "../receipt-read";

const ok = normalizeReceipt({ amount: "1,450.50", paid_at: "2569-11-03 14:25", receipt_no: " INV-001 ", payee: "ร้านอะไหล่", payer: "สมชาย", payment_method: "TRANSFER", summary: "ปั๊มน้ำ" });
assert.equal(ok.amount, 1450.5);
assert.equal(ok.paidAt, "2026-11-03T14:25");
assert.equal(ok.receiptNo, "INV-001");
assert.equal(ok.paymentMethod, "transfer");
assert.equal(receiptHasData(ok), true);

// ค.ศ. + ไม่มีเวลา
assert.equal(normalizeReceipt({ paid_at: "2026-11-03" }).paidAt, "2026-11-03T00:00");
// อ่านไม่ได้ = null ไม่เดา
const bad = normalizeReceipt({ amount: "ไม่ทราบ", paid_at: "เมื่อวาน", receipt_no: "null", payment_method: "bitcoin" });
assert.equal(bad.amount, null);
assert.equal(bad.paidAt, null);
assert.equal(bad.receiptNo, null);
assert.equal(bad.paymentMethod, null);
assert.equal(receiptHasData(bad), false);
assert.equal(normalizeReceipt({ amount: -5 }).amount, null);
assert.equal(normalizeReceipt({ paid_at: "2026-13-45 10:00" }).paidAt, null);
assert.equal(receiptHasData(normalizeReceipt(null)), false);

console.log("receipt-read ok");
