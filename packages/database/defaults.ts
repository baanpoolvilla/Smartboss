/**
 * แม่แบบของ "บริษัทใหม่" — บทบาท สิทธิ์ และโมดูลที่ได้ตั้งแต่วันแรก
 *
 * อยู่ที่นี่เพราะมีคนใช้สองที่ และ **ต้องเหมือนกันเสมอ**:
 *   1. `seed.ts`            — บริษัทแรกตอนติดตั้งระบบ
 *   2. `createOrganizationAction` — ทุกบริษัทที่ SUPER_ADMIN สร้างเพิ่มทีหลัง
 *
 * ถ้าแยกกันเขียนสองที่ วันหนึ่งบริษัทที่สร้างจากหน้าเว็บจะได้สิทธิ์ไม่เท่าบริษัทแรก
 * แล้วไล่หาสาเหตุยากมาก เพราะไม่มี error ให้เห็น
 *
 * ⚠ นี่คือ "ค่าตั้งต้น" ไม่ใช่กฎตายตัว — ทุกบริษัทแก้บทบาทและสิทธิ์ของตัวเองได้
 * ที่ /admin/roles หลังสร้างเสร็จ
 */

/** บทบาทตั้งต้นที่โคลนให้ทุกบริษัท */
export const ORG_ROLES: { code: string; name: string; description: string }[] = [
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
 * สิทธิ์ระดับ core (หลังบ้าน /admin) — ไม่ผูกกับโมดูลธุรกิจ moduleId = null
 *
 * ⚠ `core.org.create` **ไม่อยู่ในนี้โดยตั้งใจ** เพราะรายการนี้ถูกมอบให้ ADMIN
 * ของทุกบริษัท — ถ้าใส่เข้าไป แอดมินของลูกค้ารายหนึ่งจะสร้างบริษัทใหม่ได้
 * การสร้างบริษัทเป็นอำนาจระดับแพลตฟอร์ม ของ SUPER_ADMIN เท่านั้น
 */
export const CORE_PERMS = [
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
  // แผนก/ตำแหน่ง — ของกลาง ใช้ร่วมกันได้ทุกโมดูล (ดู core.prisma: Department/Position)
  "core.department.view",
  "core.department.manage",
  "core.position.view",
  "core.position.manage",
];

/** สิทธิ์ระดับแพลตฟอร์ม — ไม่มอบให้บทบาทของบริษัทใด SUPER_ADMIN ผ่านเองอยู่แล้ว */
export const PLATFORM_PERMS = ["core.org.create"];

export const HR_PERMS = [
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

export const MAINT_PERMS = [
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

/** สิทธิ์ที่แต่ละบทบาทได้รับตอนสร้างบริษัท — บริษัทปรับเองได้ที่ /admin/roles */
export const ROLE_GRANTS: Record<string, string[]> = {
  ADMIN: [...CORE_PERMS, ...HR_PERMS, ...MAINT_PERMS],
  CEO: [
    "core.admin", "core.user.view", "core.role.view", "core.audit.view",
    // ผู้บริหารเป็นคนกำหนดว่าบริษัทนี้ถือว่าอะไรคือ "ทำงานได้ดี"
    "core.performance.view", "core.performance.setting.manage",
    "core.department.view", "core.department.manage", "core.position.view", "core.position.manage",
    "hr.access", "hr.employee.view", "hr.salary.view", "hr.payroll.view", "hr.payroll.approve",
    ...MAINT_PERMS.filter((p) => p !== "maintenance.admin"),
  ],
  MANAGER: [
    "core.admin", "core.user.view", "core.user.manage", "core.role.view",
    // หัวหน้างานดูคะแนนลูกทีมได้ แต่แก้เกณฑ์ไม่ได้ — ไม่งั้นแก้เกณฑ์ให้ทีมตัวเองดูดีได้
    "core.performance.view",
    "core.department.view", "core.position.view",
    "hr.access", "hr.employee.view", "hr.employee.manage", "hr.payroll.view",
    "maintenance.access",
    "maintenance.workorder.view", "maintenance.workorder.manage", "maintenance.workorder.complete",
    "maintenance.property.view", "maintenance.property.manage",
    "maintenance.asset.view", "maintenance.asset.manage",
    "maintenance.pm.view", "maintenance.pm.manage",
    "maintenance.expense.view", "maintenance.expense.manage",
    "maintenance.contractor.view", "maintenance.po.create", "maintenance.po.view",
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

/**
 * โมดูลที่เปิดให้บริษัทใหม่ทันที — เฉพาะตัวที่มีโค้ดจริงในระบบ
 * financial / sale_admin / marketing อยู่ในแคตตาล็อกไว้รอ แต่ยังไม่มีหน้าจอ
 * เปิดไปก็ได้แค่เมนูที่กดแล้วไม่มีอะไร
 */
export const ENABLED_MODULES = ["report_task", "hr", "maintenance"];
