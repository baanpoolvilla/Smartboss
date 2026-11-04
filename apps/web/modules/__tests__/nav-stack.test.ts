import { test } from "node:test";
import assert from "node:assert/strict";

import { backTarget, pop, visit, type NavEntry } from "@/lib/nav-stack";

const walk = (...urls: string[]) => urls.reduce<NavEntry[]>((s, u) => visit(s, u), []);

test("เดินเข้าลึกหลายชั้น: ย้อนกลับไปหน้าก่อนหน้าทีละชั้น", () => {
  const s = walk("/maintenance", "/maintenance/properties", "/maintenance/properties/a", "/maintenance/assets/x");
  const t = backTarget(s);
  assert.equal(t?.url, "/maintenance/properties/a");
  assert.equal(t?.direct, true);
});

test("ไม่มีประวัติ: ใช้ปลายทางสำรองของหน้า", () => {
  assert.equal(backTarget([]), null);
  assert.equal(backTarget(walk("/maintenance/work-orders/1")), null);
});

test("รีเฟรชหน้าเดิม: ไม่เพิ่มในเส้นทาง", () => {
  assert.equal(walk("/a", "/b", "/b").length, 2);
});

test("สร้างแล้ว redirect: ย้อนกลับข้ามฟอร์ม ไม่ถอยประวัติตรง ๆ", () => {
  const t = backTarget(walk("/maintenance/work-orders", "/maintenance/work-orders/new", "/maintenance/work-orders/1"));
  assert.equal(t?.url, "/maintenance/work-orders");
  assert.equal(t?.direct, false);
});

test("แก้แล้วบันทึกกลับหน้าเดิม: ย้อนไปหน้าก่อนเปิด ไม่ใช่ฟอร์มหรือหน้าเดิม", () => {
  const t = backTarget(walk("/list", "/d/1", "/d/1/edit", "/d/1"));
  assert.equal(t?.url, "/list");
  assert.equal(t?.direct, false);
});

test("เปลี่ยนตัวกรองในหน้าเดียวกัน: ย้อนไปหน้าก่อนเข้า พร้อมเก็บตัวกรองล่าสุด", () => {
  const s = walk("/home", "/expenses", "/expenses?month=10", "/expenses?month=9");
  assert.equal(s.length, 2);
  const t = backTarget(s);
  assert.equal(t?.url, "/home");
  assert.equal(t?.direct, false);
  const back = backTarget(walk("/expenses?month=9", "/expenses/report"));
  assert.equal(back?.url, "/expenses?month=9");
});

test("หน้าเดิมซ้ำในเส้นทาง: ย้อนไปหน้าที่เพิ่งมาจริง", () => {
  assert.equal(backTarget(walk("/board", "/wo/1", "/house/a", "/wo/1"))?.url, "/house/a");
});

test("กดย้อนของเบราว์เซอร์/มือถือ: เส้นทางตัดกลับตรงนั้น", () => {
  const s = pop(walk("/a", "/b", "/c"), "/b");
  assert.deepEqual(s.map((e) => e.u), ["/a", "/b"]);
  assert.equal(backTarget(s)?.url, "/a");
});

test("กดย้อนไปหน้าที่ไม่อยู่ในเส้นทาง: เริ่มต่อจากหน้านั้น", () => {
  assert.deepEqual(pop(walk("/a"), "/z").map((e) => e.u), ["/a", "/z"]);
});
