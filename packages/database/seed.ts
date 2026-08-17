import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import {
  CORE_PERMS,
  ENABLED_MODULES,
  HR_PERMS,
  MAINT_PERMS,
  ORG_ROLES,
  PLATFORM_PERMS,
  ROLE_GRANTS,
} from "./defaults";

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

const MODULES: { code: string; name: string; color: string; sortOrder: number }[] = [
  { code: "report_task", name: "รายงานและงาน", color: "#64748B", sortOrder: 1 },
  { code: "hr", name: "ระบบบุคคล", color: "#3B82F6", sortOrder: 2 },
  { code: "financial", name: "การเงิน", color: "#8B5CF6", sortOrder: 3 },
  { code: "maintenance", name: "แจ้งซ่อมบำรุง", color: "#0D9488", sortOrder: 4 },
  { code: "sale_admin", name: "งานขาย", color: "#EC4899", sortOrder: 5 },
  { code: "marketing", name: "การตลาด", color: "#F97316", sortOrder: 6 },
];

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

  // รหัสบริษัทให้คนอ่าน (SM0001) — seed สร้างบริษัทแรกจึงเป็นเลข 1 เสมอ
  // แล้วตั้งตัวนับให้บริษัทถัดไปที่สร้างจากหน้าเว็บเดินเลขต่อได้ถูก
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: { name: orgName, isActive: true },
    create: {
      code: "SM0001",
      slug: orgSlug,
      name: orgName,
      isActive: true,
      planCode: "PRO",
    },
  });
  await prisma.$executeRaw`
    INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
    VALUES ('', 'ORG', '-', 2)
    ON CONFLICT (org_id, doc_type, period) DO NOTHING
  `;
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
  // PLATFORM_PERMS ลงแคตตาล็อกด้วย แต่ **ไม่มอบให้บทบาทไหน** — SUPER_ADMIN
  // ผ่านเองอยู่แล้ว การมีในแคตตาล็อกทำให้มอบต่อได้ทีหลังถ้าต้องการ
  for (const code of [...CORE_PERMS, ...PLATFORM_PERMS]) {
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

  // โมดูลแชท (MVP ข้อความ+รูป/ไฟล์แนบ) — เช่นเดียวกับโมดูลตัวอย่าง: อยู่ในแคตตาล็อก
  // แต่ **ไม่เปิดใช้** ให้บริษัทไหนโดยอัตโนมัติ (ไม่อยู่ใน ENABLED_MODULES) เปิดทีละ
  // บริษัทได้ที่ /admin/modules เพื่อทดสอบก่อนปล่อยใช้จริงทั้งระบบ
  const chatModule = await prisma.module.upsert({
    where: { code: "chat" },
    update: { name: "แชท", color: "#22C55E", isEnabled: false, sortOrder: 7 },
    create: { code: "chat", name: "แชท", color: "#22C55E", isEnabled: false, sortOrder: 7 },
  });
  moduleIdByCode.set("chat", chatModule.id);

  await registerModulePerms("example", ["example.view", "example.manage"]);
  await registerModulePerms("maintenance", MAINT_PERMS);
  await registerModulePerms("hr", HR_PERMS);
  await registerModulePerms("chat", ["chat.access", "chat.manage"]);
  console.log(
    `✔ Permissions: ${CORE_PERMS.length} core + ${HR_PERMS.length} hr + ${MAINT_PERMS.length} maintenance + 2 chat`
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
