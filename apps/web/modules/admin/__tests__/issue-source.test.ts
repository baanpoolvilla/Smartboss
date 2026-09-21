import test from "node:test";
import assert from "node:assert/strict";
import { classifyIssueSource, normalizePageUrl, type SourceModule } from "../issue-source";

const modules: SourceModule[] = [
  { id: "admin", name: "หลังบ้าน", color: "#111", icon: "Shield", basePath: "/admin", menus: [{ label: "ภาพรวม", path: "/admin" }, { label: "ผู้ใช้งาน", path: "/admin/users" }] },
  { id: "admin_issue_report", name: "แจ้งบัค", color: "#dc2626", icon: "Bug", basePath: "/admin/issue-reports", menus: [{ label: "ทั้งหมด", path: "/admin/issue-reports" }] },
  { id: "issue_report_self", name: "แจ้งบัค", color: "#dc2626", icon: "Bug", basePath: "/issue-reports", menus: [{ label: "ตั๋วของฉัน", path: "/issue-reports" }] },
  {
    id: "maintenance", name: "แจ้งซ่อมบำรุง", color: "#ea580c", icon: "Wrench", basePath: "/maintenance",
    menus: [{ label: "แดชบอร์ด", path: "/maintenance" }, { label: "ใบงาน", path: "/maintenance/work-orders" }, { label: "บ้าน", path: "/maintenance/properties" }],
  },
];

test("จับคู่โมดูล + เมนู จาก pageUrl", () => {
  const s = classifyIssueSource("/maintenance/work-orders", modules);
  assert.equal(s.moduleId, "maintenance");
  assert.equal(s.menuLabel, "ใบงาน");
  assert.equal(s.recordPath, null);
});

test("หน้ารายการเดี่ยว (…/[id]) เก็บ recordPath, หน้า new/edit ไม่ใช่", () => {
  assert.equal(classifyIssueSource("/maintenance/work-orders/abc123", modules).recordPath, "/maintenance/work-orders/abc123");
  assert.equal(classifyIssueSource("/maintenance/work-orders/new", modules).recordPath, null);
  assert.equal(classifyIssueSource("/maintenance/work-orders/abc123/edit", modules).recordPath, null);
});

test("แดชบอร์ด (path = basePath) ตรงเฉพาะหน้าแรกเท่านั้น", () => {
  assert.equal(classifyIssueSource("/maintenance", modules).menuLabel, "แดชบอร์ด");
  assert.equal(classifyIssueSource("/maintenance/unknown-page", modules).menuLabel, null);
  assert.equal(classifyIssueSource("/maintenance/unknown-page", modules).moduleId, "maintenance");
});

test("basePath ที่ยาวกว่าชนะ (แจ้งบัคของ admin ไม่ตกไปเป็นหลังบ้าน)", () => {
  assert.equal(classifyIssueSource("/admin/issue-reports/x/y", modules).moduleId, "admin_issue_report");
  assert.equal(classifyIssueSource("/admin/users", modules).moduleId, "admin");
});

test("พาธเก่า /report-task/issue-reports รวมเข้าหมวดแจ้งบัคเดียวกัน", () => {
  assert.equal(normalizePageUrl("/report-task/issue-reports/abc"), "/issue-reports/abc");
  const old = classifyIssueSource("/report-task/issue-reports", modules);
  const nu = classifyIssueSource("/issue-reports", modules);
  assert.equal(old.moduleId, "admin_issue_report");
  assert.equal(nu.moduleId, "admin_issue_report");
  assert.equal(old.menuLabel, "ตั๋วของฉัน");
});

test("URL เต็ม/query/hash/ช่องว่างท้าย ถูกตัดให้เหลือพาธ", () => {
  assert.equal(normalizePageUrl("https://app.smartboss.in.th/maintenance/work-orders/?a=1#x"), "/maintenance/work-orders");
});

test("หาโมดูลไม่เจอ → อื่น ๆ (หน้าหลักมีเมนูชื่อ 'หน้าหลัก')", () => {
  assert.equal(classifyIssueSource("/somewhere", modules).moduleId, "other");
  assert.equal(classifyIssueSource("/", modules).menuLabel, "หน้าหลัก");
  assert.equal(classifyIssueSource("", modules).moduleId, "other");
});
