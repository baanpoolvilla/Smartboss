import assert from "node:assert/strict";
import { groupExpenseBatches, realExpenseTotal } from "../expense-batches";

const at = (s: number) => new Date(1_800_000_000_000 + s * 1000);
const row = (over: Partial<{ workOrderId: string | null; createdBy: string | null; amount: number; description: string | null; createdAt: Date }>) => ({
  workOrderId: "wo1", createdBy: "hr", amount: 900, description: "ตัดหญ้า", createdAt: at(0), ...over,
});

// ใบ 2 บ้าน บันทึกครั้งเดียว = จ่ายจริงครั้งเดียว
const two = [row({}), row({ createdAt: at(1) })];
assert.equal(groupExpenseBatches(two).length, 1);
assert.equal(groupExpenseBatches(two)[0]!.houses, 2);
assert.equal(realExpenseTotal(two), 900);

// บันทึกคนละครั้ง ยอดเท่ากัน = จ่ายสองครั้งจริง
assert.equal(realExpenseTotal([row({}), row({ createdAt: at(60) })]), 1800);
// คนละรายการ
assert.equal(realExpenseTotal([row({}), row({ description: "ค่าน้ำมัน", amount: 100 })]), 1000);
// คนละใบงาน
assert.equal(realExpenseTotal([row({}), row({ workOrderId: "wo2" })]), 1800);
// ไม่ผูกใบงาน ไม่รวมกัน
assert.equal(realExpenseTotal([row({ workOrderId: null }), row({ workOrderId: null })]), 1800);

console.log("expense-batches ok");
