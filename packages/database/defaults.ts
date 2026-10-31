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
  // ความปลอดภัยตอน login (ล็อกบัญชีกี่ครั้ง นานเท่าไร) — คนละเรื่องกับสิทธิ์ผู้ใช้
  // จึงแยก permission ไว้ ให้มอบเฉพาะคนที่ควรแตะนโยบายความปลอดภัยได้จริง
  "core.security.setting.manage",
  // แผนก — ของกลาง ใช้ร่วมกันได้ทุกโมดูล (ดู core.prisma: Department/DepartmentHead)
  "core.department.view",
  "core.department.manage",
  // เห็นข้อมูลทั้งบริษัท ข้าม data scope ระดับแผนก (ปกติคือ ADMIN/CEO เท่านั้น)
  "core.data.view_all",
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
  "property.view", "property.manage", "property.archive",
  "asset.view", "asset.manage",
  "pm.view", "pm.manage",
  "expense.view", "expense.manage",
  "contractor.view", "contractor.manage",
  "po.view", "po.create", "po.approve",
  "admin",
].map((s) => `maintenance.${s}`);

/**
 * สิทธิ์ของโมดูลรายงานและงาน — ต้องตรงกับ REPORT_TASK_PERMS ใน
 * apps/web/modules/report_task/permissions.ts (ประกาศซ้ำที่นี่เพราะ
 * packages/database ต้องไม่ import จาก apps/)
 *
 * ⚠ ชุดนี้ **ไม่เคยถูกลงแคตตาล็อกมาก่อน** ทำให้ไม่มีบริษัทไหนมอบสิทธิ์รายงาน
 * และงานให้บทบาทของตัวเองได้ที่ /admin/roles — เห็นโมดูลนี้ได้แค่ SUPER_ADMIN
 * ที่ resolvePermission ปล่อยผ่านให้อยู่แล้ว
 */
export const REPORT_TASK_PERMS = [
  "report_task.access",
  "report_task.task.view",
  "report_task.task.manage",
  "report_task.calendar.view",
  "report_task.calendar.manage",
  "report_task.report.view",
  "report_task.report.submit",
  "report_task.report.manage",
  "report_task.activity.view",
  "report_task.issue.view",
  "report_task.issue.manage",
  "report_task.setting.manage",
];

/** ต้องตรงกับ CHAT_PERMS ใน apps/web/modules/chat/permissions.ts */
export const CHAT_PERMS = ["chat.access", "chat.manage", "chat.sticker.manage"];

/** ต้องตรงกับ COMPANY_FILES_PERMS ใน apps/web/modules/company-files/permissions.ts */
export const COMPANY_FILES_PERMS = ["company_files.access", "company_files.upload", "company_files.manage"];

/**
 * ต้องตรงกับ ADS_PERMS ใน apps/web/modules/ads/permissions.ts — โมดูล Google Ads
 * Report (google-ads-report-module-spec.md §7 สิทธิ์การเข้าถึง)
 *   access          = หน้า 1–3 (แดชบอร์ด / อีเมล / AI วิเคราะห์) ฝ่ายการตลาดและผู้บริหาร
 *   setting.manage  = หน้า 5 เกณฑ์ KPI และกฎ — ผู้ดูแลระบบ + หัวหน้าการตลาด
 *                     (มอบให้หัวหน้าการตลาดเองที่ /admin/roles)
 *   admin           = หน้า 4 การเชื่อมต่อ Google Ads API — ผู้ดูแลระบบ
 * ไม่อยู่ใน BASELINE_PERMS — ข้อมูลงบโฆษณาไม่ใช่ของทุกคน
 */
export const ADS_PERMS = ["ads.access", "ads.setting.manage", "ads.admin"];

/**
 * โมดูลคนงานรายวัน (apps/web/modules/daily_worker/permissions.ts) — อยู่ในแคตตาล็อกใต้โมดูล hr
 * ไม่ให้ ADMIN/CEO ตั้งแต่แรก ("จะได้ไม่รก" ติ๊กเพิ่มเองได้) · ไม่อยู่ใน BASELINE_PERMS
 */
export const DAILY_WORKER_PERMS = ["daily_worker.view", "daily_worker.manage", "daily_worker.override"];
/** ตั้งค่าแรง/% OT คนงาน — แยกจากงานหน้างาน ค่าตั้งต้น HR_OFFICER + CEO (ผู้ดูแลบ้านไม่ได้) */
export const DAILY_WORKER_PAY_PERM = "daily_worker.pay";

/**
 * โมดูลเบิกจ่าย & OT (apps/web/modules/requests/permissions.ts) — อยู่ในแคตตาล็อกใต้โมดูล hr
 * migration 20261021120000_requests_module ให้บริษัทที่มีอยู่แล้วด้วยชุดเดียวกับข้างล่าง
 */
export const REQUESTS_PERMS = [
  "requests.access", "requests.file_others", "requests.approve", "requests.approve_ceo",
  "requests.pay", "requests.petty_cash", "requests.view_all", "requests.settings",
  // เงินสดย่อยแยกจากสิทธิ์ใบเบิก — migration 20261031120000_petty_cash_perms
  "requests.petty_view", "requests.petty_topup", "requests.petty_adjust",
];

/**
 * โมดูลเงินเดือน (apps/web/modules/salary/permissions.ts) — อยู่ในแคตตาล็อกใต้โมดูล hr
 * migration 20261022150000_salary_module ให้บริษัทที่มีอยู่แล้วด้วยชุดเดียวกับข้างล่าง
 * มีแค่ "ดูสลิปของตัวเอง" — คนเห็น/แก้เงินเดือนของคนอื่นคือ CEO + รายชื่อที่ CEO เลือกในตั้งค่าเงินเดือน
 * (ไม่ผูกกับบทบาท ผู้ใช้กำหนด 22/10/2569) ดู apps/web/modules/salary/lib/access.ts
 */
export const SALARY_PERMS = ["salary.access"];

/**
 * สิทธิ์พื้นฐานที่ **ทุกบทบาทได้รับ** — คือคำตอบของกติกา "ทุกคนเห็นและเข้าถึงได้
 * ทุกโมดูล แต่สิทธิ์การใช้งานในแต่ละโมดูลต่างกัน"
 *
 * "เข้าถึงได้" ในที่นี้ = เข้าโมดูลได้ + เห็นข้อมูลระดับ view ที่ใช้ทำงานประจำวัน
 * ส่วนสิทธิ์ที่ไป "เปลี่ยนของคนอื่น" (manage / approve / setting) ยังแยกตามบทบาท
 * อยู่ใน ROLE_EXTRA_GRANTS ข้างล่างเหมือนเดิม
 *
 * สิ่งที่ **จงใจไม่อยู่ในนี้**:
 *   - `core.*` ทั้งหมด → หลังบ้าน /admin คือที่ที่แก้สิทธิ์ของทุกคนได้
 *     ถ้าเปิดให้ทุกบทบาทเข้า กติกาข้อนี้จะถูกแก้ทิ้งโดยใครก็ได้
 *   - `hr.salary.* / hr.payroll.*` → เงินเดือนเป็นข้อมูลส่วนบุคคล
 *   - `maintenance.expense.* / po.view / po.approve` → ตัวเลขจัดซื้อ-การเงิน
 *     ของบริษัท · แต่ `po.create` **อยู่ในชุดพื้นฐาน** ดูเหตุผลตรงรายการข้างล่าง
 *   - `report_task.activity.view` → บันทึกการกระทำของคนทั้งบริษัท
 */
export const BASELINE_PERMS = [
  // รายงานและงาน — ทุกคนต้องส่งรายงานประจำวันของตัวเอง และเห็นงาน/ปฏิทินของทีม
  "report_task.access",
  "report_task.task.view",
  "report_task.calendar.view",
  "report_task.report.view",
  "report_task.report.submit",
  "report_task.issue.view",
  // บุคคล — ปฏิทินวันหยุด สลิปของตัวเอง ทะเบียนพนักงาน (เงินเดือนไม่รวม)
  "hr.access",
  "hr.employee.view",
  // แจ้งซ่อมบำรุง — เห็นใบงาน บ้าน อุปกรณ์ แผน PM และรายชื่อผู้รับเหมา
  "maintenance.access",
  "maintenance.workorder.view",
  "maintenance.property.view",
  "maintenance.asset.view",
  "maintenance.pm.view",
  "maintenance.contractor.view",
  /*
   * ทุกบทบาท "ขอ" ซื้อของได้ — คนที่เจอของพังคือคนหน้างาน (ผู้ดูแลบ้าน ช่าง)
   * ถ้าเปิด PR เองไม่ได้ ต้องไปตามหัวหน้ามากดแทนทุกครั้ง ซึ่งช้ากว่าปัญหาที่
   * เจอ · เดิมมีแค่ ADMIN/CEO/MANAGER ⇒ ผู้ดูแลบ้านเห็นกระดาน PR/PO ได้ (มี
   * po.view) แต่ปุ่ม "เปิด PR" ไม่ขึ้นให้เลย
   *
   * ไม่ใช่การเปิดให้ใครก็สั่งซื้อได้: นี่คือสิทธิ์ "ขอ" อย่างเดียว ใบที่เปิดมา
   * เป็นสถานะ pending รอ CEO อนุมัติเสมอ · การ "เปิด PO เลย" (ข้ามอนุมัติ)
   * ยังต้องมี po.approve ซึ่ง createPoAction บังคับฝั่งเซิร์ฟเวอร์อยู่แล้ว
   * (openPo = wantsPo && canOpenPo) ยิงฟอร์มตรงมาก็ข้ามไม่ได้
   */
  "maintenance.po.create",
  // แชท — เห็นเมนูเฉพาะบริษัทที่เปิดใช้โมดูลนี้ที่ /admin/modules
  "chat.access",
  // ไฟล์บริษัท — ดู/อัปโหลด/แชร์ไฟล์กันได้ทุกคน (เหมือนกัน) ลบ/จัดการของคนอื่น
  // ยังต้องเป็น ADMIN — เห็นเมนูเฉพาะบริษัทที่เปิดใช้โมดูลนี้ที่ /admin/modules
  "company_files.access",
  "company_files.upload",
  // เบิกจ่าย & OT — ทุกคนยื่นเบิกค่าใช้จ่ายของตัวเองได้ (ทางด่วน น้ำมัน ซื้อของ)
  "requests.access",
  // เงินเดือน — ทุกคนดูสลิปของตัวเองได้ (คนงานไม่เห็นเมนู — จ่ายรายวันที่โมดูลคนงาน)
  "salary.access",
];

/**
 * สิทธิ์ "เพิ่มจากพื้นฐาน" ของแต่ละบทบาท — สิทธิ์จริงที่ได้ = BASELINE_PERMS ∪ ชุดนี้
 * (ประกอบร่างใน ROLE_GRANTS ข้างล่าง) บริษัทปรับเองได้ที่ /admin/roles
 */
/**
 * สิทธิ์ฐานเงินเดือน/งวดเงินเดือนรายคน — ให้แค่ CEO (ผู้ใช้กำหนด 22/10/2569 "มีแค่ CEO และหัวหน้า HR")
 * หัวหน้า HR ได้สิทธิ์จากรายชื่อที่ CEO เลือกใน เงินเดือน › ตั้งค่า ไม่ใช่จากบทบาท
 * (apps/web/modules/salary/lib/access.ts · migration 20261022170000_salary_privacy)
 */
const PAY_DATA_PERMS = new Set(["hr.salary.view", "hr.salary.manage", "hr.payroll.view", "hr.payroll.manage", "hr.payroll.approve"]);
const notPayData = (p: string) => !PAY_DATA_PERMS.has(p);

const ROLE_EXTRA_GRANTS: Record<string, string[]> = {
  // อนุมัติ PR/PO เป็นของ CEO คนเดียว (หน้า PR ขึ้น "รอ CEO อนุมัติ") — IT ดูแล/ลบ/ดำเนินการได้
  // ผ่าน maintenance.admin แต่ไม่อนุมัติ และไม่ต้องได้แจ้งเตือน PR ใหม่ทุกใบ
  ADMIN: [...CORE_PERMS, ...HR_PERMS.filter(notPayData), ...MAINT_PERMS.filter((p) => p !== "maintenance.po.approve"), ...REPORT_TASK_PERMS, ...CHAT_PERMS, ...COMPANY_FILES_PERMS, ...ADS_PERMS,
    // เบิกจ่าย & OT: แอดมินลง OT/ค่าช่างให้คนอื่น (ไม่อนุมัติ ไม่จ่าย) · ไม่ดูทุกใบ — migration 20261031180000
    // คนถือเงินสดย่อยตั้งรายคนที่หน้าเงินสดย่อย (requests.petty_holders) ไม่ใช่จากบทบาท
    "requests.file_others"],
  CEO: [
    "core.admin", "core.user.view", "core.role.view", "core.audit.view",
    // ผู้บริหารเป็นคนกำหนดว่าบริษัทนี้ถือว่าอะไรคือ "ทำงานได้ดี"
    "core.performance.view", "core.performance.setting.manage",
    "core.department.view", "core.department.manage", "core.data.view_all",
    // เดิมมีแค่ view/payroll.approve — เห็นข้อมูลได้แต่ตั้งค่าฟีเจอร์ของ HR
    // เองไม่ได้เลย (hr.setting.manage หายไป ⇒ เข้า /hr/settings ไม่ได้ ทั้งที่
    // เกณฑ์ตัดคะแนน/เกรดที่ผูกกับ HR อยู่ในนั้น) ให้เต็มชุดเหมือน MAINT/REPORT_TASK
    // ข้างล่าง — payrollManage ให้พร้อมกับ payrollApprove ได้อย่างปลอดภัย:
    // mapSmartbossRoles ให้สิทธิ์ APPROVER อย่างเดียวเมื่อมี payrollApprove
    // (ไม่ทับกับ PREPARER) กฎแยกหน้าที่จึงยังอยู่ครบ
    ...HR_PERMS,
    ...MAINT_PERMS.filter((p) => p !== "maintenance.admin"),
    ...REPORT_TASK_PERMS,
    // ผู้บริหารดูรายงาน Google Ads (spec §7 หน้า 1–3)
    "ads.access",
    // สติกเกอร์บริษัท: แอดมิน (IT) ได้ผ่าน CHAT_PERMS แล้ว + CEO + การตลาด
    "chat.sticker.manage",
    // คนงานรายวัน: ดูยอดเงิน + ตั้งค่าแรง (ไม่ทำงานหน้างาน) — ผู้ใช้ตกลง 19/10/2569
    "daily_worker.view", DAILY_WORKER_PAY_PERM,
    // เบิกจ่าย & OT: อนุมัติทุกระดับ (เบิกล่วงหน้า + ใบที่ HR ยื่นเอง) — ผู้ใช้กำหนด 21/10/2569
    "requests.file_others", "requests.approve", "requests.approve_ceo", "requests.view_all", "requests.settings",
    "requests.petty_view", "requests.petty_topup",
  ],
  // หัวหน้างานเข้าหลังบ้านได้ แต่ได้แค่ "ดูแลคน" ไม่ใช่ "ตั้งค่าระบบ" —
  // จัดการผู้ใช้และดูบทบาทได้ แต่แก้บทบาท/สิทธิ์ เปิดปิดโมดูล ตั้งค่าบริษัท
  // และนโยบายความปลอดภัย ยังเป็นของฝ่าย IT (บทบาท ADMIN) เท่านั้น
  MANAGER: [
    "core.admin", "core.user.view", "core.user.manage", "core.role.view",
    // หัวหน้างานดูคะแนนลูกทีมได้ แต่แก้เกณฑ์ไม่ได้ — ไม่งั้นแก้เกณฑ์ให้ทีมตัวเองดูดีได้
    "core.performance.view",
    "core.department.view",
    "hr.access", "hr.employee.view", "hr.employee.manage",
    "maintenance.access",
    "maintenance.workorder.view", "maintenance.workorder.manage", "maintenance.workorder.complete",
    "maintenance.property.view", "maintenance.property.manage", "maintenance.property.archive",
    "maintenance.asset.view", "maintenance.asset.manage",
    "maintenance.pm.view", "maintenance.pm.manage",
    "maintenance.expense.view", "maintenance.expense.manage",
    "maintenance.contractor.view", "maintenance.po.create", "maintenance.po.view",
    // หัวหน้างานมอบหมายงาน จัดปฏิทินทีม คุมหัวข้อรายงาน และรับเรื่องแจ้งปัญหาได้
    "report_task.task.manage", "report_task.calendar.manage", "report_task.report.manage",
    "report_task.activity.view", "report_task.issue.manage",
    "requests.file_others",
  ],
  // เจ้าหน้าที่บุคคล = ผู้ "จัดทำ" งวดเงินเดือน — ไม่ได้สิทธิ์อนุมัติ
  // แยกหน้าที่ตามที่ workforce บังคับ: คนเตรียมงวดอนุมัติงวดตัวเองไม่ได้
  // (ถ้าให้ทั้งสองอย่าง mapSmartbossRoles จะมองว่าเป็นผู้อนุมัติ แล้วจะไม่มีใครจัดทำงวดได้เลย)
  HR_OFFICER: [
    ...HR_PERMS.filter(notPayData),
    // วันหยุด/ประเภทการลาบนปฏิทินทีมเป็นงานของฝ่ายบุคคลโดยตรง
    "report_task.calendar.manage",
    ...DAILY_WORKER_PERMS,
    DAILY_WORKER_PAY_PERM,
    // เบิกจ่าย & OT: HR อนุมัติ + จ่ายเงิน + ถือเงินสดย่อย (ใบที่ HR ยื่นเองไป CEO)
    "requests.file_others", "requests.approve", "requests.pay", "requests.petty_cash", "requests.view_all", "requests.settings",
    "requests.petty_view", "requests.petty_topup", "requests.petty_adjust",
  ],
  // งานการเงิน — ตัวเลขจัดซื้อและค่าใช้จ่ายของงานซ่อมบำรุงที่ไม่อยู่ในชุดพื้นฐาน
  ACCOUNTANT: [
    "maintenance.expense.view", "maintenance.expense.manage", "maintenance.po.view",
  ],
  CARETAKER: [
    // ผู้ดูแลบ้านคุมคนงานหน้างาน — ลงวันหยุด/OT ให้คนงาน (โมดูลคนงานรายวัน)
    ...DAILY_WORKER_PERMS,
    // ขอเบิกล่วงหน้า/ลง OT ให้คนงานที่ดูแล
    "requests.file_others",
    "maintenance.workorder.manage", "maintenance.property.archive",
    "maintenance.asset.manage", "maintenance.pm.manage",
    "maintenance.po.view", "maintenance.expense.view",
  ],
  TECHNICIAN: ["maintenance.workorder.complete"],
  // SALE_ADMIN / STAFF ยังไม่มีโมดูลของตัวเอง — ได้ชุดพื้นฐานล้วน
  SALE_ADMIN: [],
  // ฝ่ายการตลาดดูรายงาน Google Ads (spec §7 หน้า 1–3)
  MARKETING: ["ads.access", "chat.sticker.manage"],
  STAFF: [],
};

/**
 * สิทธิ์ที่แต่ละบทบาทได้รับตอนสร้างบริษัท — บริษัทปรับเองได้ที่ /admin/roles
 *
 * ประกอบจาก ORG_ROLES ทุกตัวเสมอ ไม่ใช่เขียนมือทีละบทบาท — บทบาทที่ตกหล่นจาก
 * ตารางนี้คือคนที่ล็อกอินเข้ามาแล้วไม่เห็นโมดูลอะไรเลย (เดิม STAFF / SALE_ADMIN /
 * MARKETING / ACCOUNTANT เป็นแบบนั้นอยู่)
 */
export const ROLE_GRANTS: Record<string, string[]> = Object.fromEntries(
  ORG_ROLES.map((role) => [
    role.code,
    [...new Set([...BASELINE_PERMS, ...(ROLE_EXTRA_GRANTS[role.code] ?? [])])],
  ])
);

/**
 * โมดูลที่เปิดให้บริษัทใหม่ทันที — เฉพาะตัวที่มีโค้ดจริงในระบบ
 * financial / sale_admin / marketing อยู่ในแคตตาล็อกไว้รอ แต่ยังไม่มีหน้าจอ
 * เปิดไปก็ได้แค่เมนูที่กดแล้วไม่มีอะไร
 */
export const ENABLED_MODULES = ["report_task", "hr", "maintenance"];
