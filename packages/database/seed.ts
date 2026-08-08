import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

// โหลด .env จาก root ของ monorepo
config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** role ระบบ — org_id = null ทุกบริษัทเห็น แต่แก้ไม่ได้ */
const SYSTEM_ROLE = {
  code: "SUPER_ADMIN",
  name: "ผู้ดูแลระบบสูงสุด",
  description: "เข้าถึงได้ทุกส่วนของทุกบริษัท",
};

/** role ตั้งต้นที่ "โคลนให้แต่ละบริษัท" ตอนเปิดใช้งาน — บริษัทแก้สิทธิ์เองได้ */
const ORG_ROLES: { code: string; name: string; description: string }[] = [
  { code: "ADMIN", name: "ผู้ดูแลบริษัท", description: "จัดการผู้ใช้ สิทธิ์ และโมดูลของบริษัท" },
  { code: "MANAGER", name: "ผู้จัดการ", description: "ดูแลภาพรวมและอนุมัติ" },
  { code: "HR_OFFICER", name: "เจ้าหน้าที่บุคคล", description: "งานทรัพยากรบุคคลและเงินเดือน" },
  { code: "ACCOUNTANT", name: "นักบัญชี", description: "งานการเงินและบัญชี" },
  { code: "SALE_ADMIN", name: "แอดมินฝ่ายขาย", description: "งานขายและลูกค้า" },
  { code: "MARKETING", name: "การตลาด", description: "งานการตลาด" },
  { code: "CEO", name: "ซีอีโอ", description: "ผู้บริหารสูงสุด อนุมัติการจัดซื้อ" },
  { code: "TECHNICIAN", name: "ช่างเทคนิค", description: "งานซ่อมบำรุง" },
  { code: "CARETAKER", name: "ผู้ดูแลบ้าน", description: "ดูแลทรัพย์สินที่รับผิดชอบ" },
  { code: "STAFF", name: "พนักงานทั่วไป", description: "สิทธิ์พื้นฐาน" },
];

/**
 * โมดูลที่เปิดให้บริษัทแรกทันที — เฉพาะตัวที่มีโค้ดจริงในระบบ
 * financial / sale_admin / marketing อยู่ในแคตตาล็อกไว้รอ แต่ยังไม่มีหน้าจอ
 * เปิดไปก็ได้แค่เมนูที่กดแล้วไม่มีอะไร
 */
const ENABLED_MODULES = ["report_task", "hr", "maintenance"];

const MODULES: { code: string; name: string; color: string; sortOrder: number }[] = [
  { code: "report_task", name: "รายงานและงาน", color: "#64748B", sortOrder: 1 },
  { code: "hr", name: "ระบบบุคคล", color: "#3B82F6", sortOrder: 2 },
  { code: "financial", name: "การเงิน", color: "#8B5CF6", sortOrder: 3 },
  { code: "maintenance", name: "แจ้งซ่อมบำรุง", color: "#0D9488", sortOrder: 4 },
  { code: "sale_admin", name: "งานขาย", color: "#EC4899", sortOrder: 5 },
  { code: "marketing", name: "การตลาด", color: "#F97316", sortOrder: 6 },
];

/** สิทธิ์ระดับ core (หลังบ้าน /admin) — ไม่ผูกกับโมดูลธุรกิจ moduleId = null */
const CORE_PERMS = [
  "core.admin",
  "core.user.view",
  "core.user.manage",
  "core.role.view",
  "core.role.manage",
  "core.module.manage",
  "core.org.manage",
  "core.audit.view",
  // คะแนนผลงานรวมข้ามโมดูล — อยู่ระดับ core เพราะกินข้อมูลจากทุกโมดูล
  "core.performance.view",
  "core.performance.setting.manage",
];

const HR_PERMS = [
  "hr.access",
  "hr.employee.view",
  "hr.employee.manage",
  "hr.salary.view",
  "hr.salary.manage",
  "hr.payroll.view",
  "hr.payroll.manage",
  "hr.payroll.approve",
  "hr.setting.manage",
];

const MAINT_PERMS = [
  "access",
  "workorder.view", "workorder.manage", "workorder.complete",
  "property.view", "property.manage",
  "asset.view", "asset.manage",
  "pm.view", "pm.manage",
  "expense.view", "expense.manage",
  "contractor.view", "contractor.manage",
  "po.view", "po.create", "po.approve",
  "admin",
].map((s) => `maintenance.${s}`);

/** สิทธิ์ที่ role ของบริษัทได้รับตอน seed — บริษัทปรับเองได้ทีหลังที่ /admin/roles */
const ROLE_GRANTS: Record<string, string[]> = {
  ADMIN: [...CORE_PERMS, ...HR_PERMS, ...MAINT_PERMS],
  CEO: [
    "core.admin", "core.user.view", "core.role.view", "core.audit.view",
    // ผู้บริหารเป็นคนกำหนดว่าบริษัทนี้ถือว่าอะไรคือ "ทำงานได้ดี"
    "core.performance.view", "core.performance.setting.manage",
    "hr.access", "hr.employee.view", "hr.salary.view", "hr.payroll.view", "hr.payroll.approve",
    ...MAINT_PERMS.filter((p) => p !== "maintenance.admin"),
  ],
  MANAGER: [
    "core.admin", "core.user.view", "core.user.manage", "core.role.view",
    // หัวหน้างานดูคะแนนลูกทีมได้ แต่แก้เกณฑ์ไม่ได้ — ไม่งั้นแก้เกณฑ์ให้ทีมตัวเองดูดีได้
    "core.performance.view",
    "hr.access", "hr.employee.view", "hr.employee.manage", "hr.payroll.view",
    "maintenance.access",
    "maintenance.workorder.view", "maintenance.workorder.manage", "maintenance.workorder.complete",
    "maintenance.property.view", "maintenance.property.manage",
    "maintenance.asset.view", "maintenance.asset.manage",
    "maintenance.pm.view", "maintenance.pm.manage",
    "maintenance.expense.view", "maintenance.expense.manage",
    "maintenance.contractor.view", "maintenance.contractor.manage",
    "maintenance.po.view", "maintenance.po.create",
  ],
  // เจ้าหน้าที่บุคคล = ผู้ "จัดทำ" งวดเงินเดือน — ไม่ได้สิทธิ์อนุมัติ
  // แยกหน้าที่ตามที่ workforce บังคับ: คนเตรียมงวดอนุมัติงวดตัวเองไม่ได้
  // (ถ้าให้ทั้งสองอย่าง mapSmartbossRoles จะมองว่าเป็นผู้อนุมัติ แล้วจะไม่มีใครจัดทำงวดได้เลย)
  HR_OFFICER: HR_PERMS.filter((p) => p !== "hr.payroll.approve"),
  CARETAKER: [
    "maintenance.access", "maintenance.workorder.view", "maintenance.workorder.manage",
    "maintenance.property.view", "maintenance.asset.view", "maintenance.asset.manage",
    "maintenance.pm.view", "maintenance.pm.manage",
    "maintenance.contractor.view", "maintenance.po.view", "maintenance.expense.view",
  ],
  TECHNICIAN: [
    "maintenance.access", "maintenance.workorder.view", "maintenance.workorder.complete",
  ],
};

async function main() {
  console.log("🌱 Seeding Smartboss core data...");

  // ── 1) Role ระบบ ──────────────────────────────────────────
  // orgId = null ทำให้ใช้ compound unique ใน upsert ไม่ได้ → หาเองก่อน
  const existingSystemRole = await prisma.role.findFirst({
    where: { orgId: null, code: SYSTEM_ROLE.code },
  });
  const superAdminRole = existingSystemRole
    ? await prisma.role.update({
        where: { id: existingSystemRole.id },
        data: { name: SYSTEM_ROLE.name, isSystem: true },
      })
    : await prisma.role.create({ data: { ...SYSTEM_ROLE, isSystem: true } });
  console.log(`✔ System role: ${superAdminRole.code}`);

  // ── 2) แคตตาล็อกโมดูล ─────────────────────────────────────
  for (const mod of MODULES) {
    await prisma.module.upsert({
      where: { code: mod.code },
      update: { name: mod.name, color: mod.color, sortOrder: mod.sortOrder },
      create: { ...mod, isEnabled: false },
    });
  }
  console.log(`✔ Modules: ${MODULES.length}`);

  // ── 3) บริษัทของเจ้าของระบบ ───────────────────────────────
  // ตั้งชื่อผ่าน env ได้ ไม่ hard code ชื่อบริษัทไหนไว้ในโค้ด
  const orgSlug = (process.env.SEED_ORG_SLUG ?? "main").trim();
  const orgName = (process.env.SEED_ORG_NAME ?? "บริษัทของฉัน").trim();

  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: { name: orgName, isActive: true },
    create: { slug: orgSlug, name: orgName, isActive: true, planCode: "PRO" },
  });
  console.log(`✔ Organization: ${org.name} (${org.slug})`);

  // ── 4) Role ของบริษัท ─────────────────────────────────────
  // สร้างครบทั้ง 10 ตัวไว้ตั้งแต่ต้น เพราะเป็น "แม่แบบสิทธิ์" ไม่ใช่ข้อมูลทดสอบ
  // ตอนเพิ่มพนักงานจริงจะได้เลือกบทบาทได้เลย ไม่ต้องมานั่งตั้งเอง
  for (const role of ORG_ROLES) {
    await prisma.role.upsert({
      where: { orgId_code: { orgId: org.id, code: role.code } },
      update: { name: role.name, description: role.description },
      create: { ...role, orgId: org.id, isSystem: false },
    });
  }
  console.log(`✔ Org roles: ${ORG_ROLES.length}`);

  // ── 5) แคตตาล็อกสิทธิ์ ────────────────────────────────────
  for (const code of CORE_PERMS) {
    await prisma.permission.upsert({
      where: { code },
      update: { moduleId: null },
      create: { code },
    });
  }

  const moduleIdByCode = new Map<string, string>();
  for (const mod of await prisma.module.findMany()) {
    moduleIdByCode.set(mod.code, mod.id);
  }

  async function registerModulePerms(moduleCode: string, perms: string[]) {
    const moduleId = moduleIdByCode.get(moduleCode) ?? null;
    for (const code of perms) {
      await prisma.permission.upsert({
        where: { code },
        update: { moduleId },
        create: { code, moduleId },
      });
    }
  }

  // โมดูลตัวอย่างเป็นแม่แบบสำหรับนักพัฒนา — มีในแคตตาล็อกแต่ **ไม่เปิดใช้**
  // ให้บริษัทไหน ไม่งั้นจะมีเมนูที่ไม่มีประโยชน์โผล่ในระบบจริง
  const exampleModule = await prisma.module.upsert({
    where: { code: "example" },
    update: { name: "โมดูลตัวอย่าง", color: "#4CB93F", isEnabled: false, sortOrder: 99 },
    create: { code: "example", name: "โมดูลตัวอย่าง", color: "#4CB93F", isEnabled: false, sortOrder: 99 },
  });
  moduleIdByCode.set("example", exampleModule.id);
  await registerModulePerms("example", ["example.view", "example.manage"]);
  await registerModulePerms("maintenance", MAINT_PERMS);
  await registerModulePerms("hr", HR_PERMS);
  console.log(
    `✔ Permissions: ${CORE_PERMS.length} core + ${HR_PERMS.length} hr + ${MAINT_PERMS.length} maintenance`
  );

  // ── 6) เปิดโมดูลที่มีโค้ดจริงให้บริษัทนี้ ───────────────────
  // financial / sale_admin / marketing ยังไม่มีโค้ด จึงไม่เปิด
  for (const code of ENABLED_MODULES) {
    const mod = await prisma.module.update({
      where: { code },
      data: { isEnabled: true },
    });
    await prisma.orgModule.upsert({
      where: { orgId_moduleId: { orgId: org.id, moduleId: mod.id } },
      update: { isEnabled: true },
      create: { orgId: org.id, moduleId: mod.id, isEnabled: true },
    });
  }
  console.log(`✔ Subscriptions: ${ENABLED_MODULES.join(", ")}`);

  // ── 7) ผูกสิทธิ์เข้ากับ role ของบริษัท ────────────────────
  for (const [roleCode, perms] of Object.entries(ROLE_GRANTS)) {
    const role = await prisma.role.findUnique({
      where: { orgId_code: { orgId: org.id, code: roleCode } },
    });
    if (!role) continue;
    for (const code of perms) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log("✔ Role grants");

  // ── 8) ผู้ใช้ — **คนเดียวเท่านั้น** ────────────────────────
  //
  // ไม่สร้างผู้ใช้ตัวอย่างใด ๆ ทั้งสิ้น พนักงานจริงเพิ่มเองที่ /admin/users
  // (เดิม seed สร้าง staff/hr/ceo/manager/caretaker/tech ไว้ 6 คน — เป็นข้อมูล
  //  ทดสอบที่ไม่ควรอยู่บนระบบจริง บัญชีที่ไม่มีคนใช้คือบัญชีที่ไม่มีคนดูแล)
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@smartboss.app")
    .trim()
    .toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error(
      "SEED_ADMIN_PASSWORD ต้องถูกกำหนดใน env และยาวอย่างน้อย 12 ตัวอักษร"
    );
  }

  await upsertUser({
    email: adminEmail,
    name: process.env.SEED_ADMIN_NAME ?? "ผู้ดูแลระบบสูงสุด",
    password: adminPassword,
    roleId: superAdminRole.id,
    orgId: org.id,
  });

  console.log(`✔ ผู้ใช้: ${adminEmail} (SUPER_ADMIN) — คนเดียว`);
  console.log("\n✅ Seed completed.");
  console.log("ℹ  โมดูลบุคคล/เงินเดือน: รัน pnpm wf:migrate แล้ว pnpm wf:sync ต่อ");
  console.log("ℹ  เปลี่ยนรหัสผ่านทันทีหลัง login ครั้งแรก แล้วลบ SEED_ADMIN_PASSWORD ออกจาก env");
  console.log(
    "\n⚠ SUPER_ADMIN ถูกกันไม่ให้เห็นข้อมูลเงินเดือนรายบุคคลโดยตั้งใจ —\n" +
      "  ตอนจะทำเงินเดือน ต้องเพิ่มผู้ใช้ที่ถือบทบาท HR_OFFICER ที่ /admin/users ก่อน"
  );
}

async function upsertUser(input: {
  email: string;
  name: string;
  password: string;
  roleId: string;
  orgId?: string;
}) {
  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: { name: input.name, passwordHash, isActive: true, orgId: input.orgId },
    create: {
      email: input.email,
      name: input.name,
      passwordHash,
      isActive: true,
      orgId: input.orgId,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: input.roleId } },
    update: {},
    create: { userId: user.id, roleId: input.roleId },
  });
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
