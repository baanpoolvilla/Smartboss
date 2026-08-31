import { Prisma } from "@prisma/client";

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  Tenant isolation guard (row-level multi-tenancy safety net)
 * ─────────────────────────────────────────────────────────────────────────
 *  Smartboss เก็บทุกบริษัทไว้ในฐานเดียวกัน แยกกันด้วยคอลัมน์ `orgId` เท่านั้น
 *  (shared-database, row-level tenancy) ความปลอดภัยจึงขึ้นกับ "ทุก query ที่
 *  แตะตารางของบริษัทต้องกรอง orgId เสมอ" ถ้าพลาดที่เดียว = ข้อมูลรั่วข้ามบริษัท
 *
 *  ส่วนขยายนี้เป็น "การ์ด" ชั้นสุดท้าย: ดักทุก query ที่วิ่งเข้าโมเดลที่มี orgId
 *  แล้วถ้าไม่พบเงื่อนไข orgId จะเตือน (หรือ throw เมื่อเปิดโหมดเข้ม) — กันลืม
 *  ไม่ใช่แทนการกรองในโค้ด
 *
 *  โหมด (ผ่าน env TENANT_GUARD):
 *    "off"    = ปิด (ไม่ตรวจ)
 *    "warn"   = ค่าเริ่มต้น — log ข้อผิดพลาดแต่ปล่อย query ผ่าน (ไม่พังของเดิม)
 *    "strict" = throw ทันที — แนะนำเปิดใน dev/CI เพื่อจับจุดที่ลืมกรอง
 *
 *  ⚠ ALLOWLIST ด้านล่างสร้างจากการสแกน prisma schema (โมเดลที่มี orgId) — เพิ่ม
 *  โมเดลใหม่ที่มี orgId ต้องมาต่อรายการนี้ด้วย (มีเทสต์เตือนไว้ใน tenant-guard.test.ts)
 */

/** โมเดล (ชื่อ PascalCase ตามที่ Prisma ส่งใน query extension) ที่ผูกกับ orgId */
export const TENANT_SCOPED_MODELS = new Set<string>([
  // core
  "User", "Role", "Department", "Notification", "OrgModule", "SecuritySetting",
  "PerformanceEvent", "PerformanceSetting", "DocumentCounter", "ExampleItem",
  // report_task
  "ReportTask", "ReportTaskCollection", "ReportTaskStore",
  // chat
  "ChatChannel", "ChatChannelMember", "ChatMessage", "ChatReadState",
  // company_files
  "CompanyFolder", "CompanyFile",
  // maintenance
  "Asset", "Contractor", "ContractorHistory", "EquipmentReturn", "Expense",
  "LineConfig", "LineNotificationLog", "PmSchedule", "Property", "PropertyCategory",
  "PurchaseOrder", "PurchaseOrderComment", "WorkOrder", "WorkOrderComment",
  "WorkOrderExternalPhoto", "WorkOrderUploadLink",
]);

/** operation ที่ "ต้อง" มี where ผูก orgId (list/bulk) — findUnique/update/delete
 * ที่คีย์ด้วย id เดี่ยวไม่ตรวจ เพราะปกติ lookup ด้วย unique key แล้วเช็ค org ในโค้ด
 * ต่อ (การตรวจจะ false-positive) แต่ findFirst ตรวจด้วยเพราะเป็นการอ่านแบบมีเงื่อนไข */
const SCOPED_OPERATIONS = new Set<string>([
  "findMany", "findFirst", "count", "aggregate", "groupBy", "updateMany", "deleteMany",
]);

type GuardMode = "off" | "warn" | "strict";
function mode(): GuardMode {
  const v = (process.env.TENANT_GUARD || "").toLowerCase();
  if (v === "off" || v === "strict") return v;
  if (v === "warn") return "warn";
  // ดีฟอลต์: warn ทุกที่ (ปลอดภัย ไม่พังของเดิม) — ทีมเปิด strict เองใน dev/CI
  return "warn";
}

/** มี orgId อยู่ใน where หรือไม่ (ไล่เข้า AND/OR ด้วย) */
function whereHasOrgId(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  if ("orgId" in w && w.orgId !== undefined && w.orgId !== null) return true;
  for (const key of ["AND", "OR"] as const) {
    const v = w[key];
    if (Array.isArray(v) && v.some((x) => whereHasOrgId(x))) return true;
    if (v && typeof v === "object" && !Array.isArray(v) && whereHasOrgId(v)) return true;
  }
  return false;
}

function dataHasOrgId(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0 && data.every((d) => dataHasOrgId(d));
  if (!data || typeof data !== "object") return false;
  const orgId = (data as Record<string, unknown>).orgId;
  return orgId !== undefined && orgId !== null;
}


function report(model: string, operation: string): void {
  const m = mode();
  if (m === "off") return;
  const msg =
    `[tenant-guard] ${model}.${operation} ไม่มีเงื่อนไข orgId — เสี่ยงข้อมูลข้ามบริษัท ` +
    `(ถ้าตั้งใจ query ข้ามบริษัทจริง ใช้ prisma ที่ไม่ผ่านการ์ด หรือระบุ orgId ให้ครบ)`;
  if (m === "strict") throw new Error(msg);
  console.error(msg);
}

function inspect(model: string, operation: string, args: unknown): void {
  const a = (args ?? {}) as Record<string, unknown>;
  if (operation === "create" || operation === "createMany" || operation === "createManyAndReturn") {
    if (!dataHasOrgId(a.data)) report(model, operation);
    return;
  }
  if (operation === "upsert") {
    if (!dataHasOrgId(a.create)) report(model, operation);
    return;
  }
  if (SCOPED_OPERATIONS.has(operation)) {
    if (!whereHasOrgId(a.where)) report(model, operation);
  }
}

export const tenantGuardExtension = Prisma.defineExtension({
  name: "tenant-org-guard",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (mode() !== "off" && TENANT_SCOPED_MODELS.has(model)) {
          inspect(model, operation, args);
        }
        return query(args);
      },
    },
  },
});
