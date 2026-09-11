import { AsyncLocalStorage } from "node:async_hooks";

/**
 * ทางออกเดียวที่ทำให้ query ข้ามบริษัทได้โดยไม่โดน tenant-guard.ts เตือน/บล็อก
 *
 * หลักการ 4 ข้อ (ตัดสินใจไว้ก่อนสร้างไฟล์นี้ — อย่าออกแบบใหม่โดยไม่คุยกันก่อน):
 *   1. ต้อง grep เจอที่ query จริง — ห่อทีละ query ด้วย `crossOrg(reason, fn)`
 *      ตรงจุดนั้นเลย ห้ามเป็น exemption เงียบ ๆ ราย-model หรือ client แยกที่
 *      bypass ทั้งไฟล์/ทั้งโมดูล — จุดประสงค์คือทำให้ "เจตนาข้ามบริษัท" ดัง
 *      พอที่จะแยกออกจาก "ลืมกรอง orgId" ได้ที่หน้างานจริง ไม่ใช่ต้องไปเดา
 *   2. แคบที่สุด — ครอบเฉพาะ query เดียวในคอลแบ็ก ไม่ใช่ทั้งฟังก์ชัน/ทั้งไฟล์
 *   3. บังคับเหตุผล — ต้องเป็นสมาชิกของ CROSS_ORG_REASONS (TS บังคับตอน
 *      compile) เพิ่มเหตุผลใหม่ = ต้องมาแก้ไฟล์นี้ + อัปเดต test ที่ snapshot
 *      รายการนี้ไว้ใน tenant-guard.test.ts ไม่ใช่พิมพ์ string อะไรก็ได้ที่
 *      call site แล้วผ่านเลย
 *   4. รายการต้องน้อยที่สุด — ก่อนเพิ่มเหตุผลใหม่ ให้ถามก่อนเสมอว่า "เติม
 *      orgId เข้า where/data ตรง ๆ ได้ไหม" (whereHasOrgId/dataHasOrgId ใน
 *      tenant-guard.ts รองรับ `orgId: null` แล้ว สำหรับแถวระดับแพลตฟอร์ม)
 *      escape hatch นี้มีไว้สำหรับ query ที่ "เติม orgId ไม่ได้จริง ๆ" เท่านั้น
 *      — ยังไม่รู้ orgId เลย (pre-login), ตั้งใจวิ่งข้ามทุกบริษัท (cron
 *      ระดับแพลตฟอร์ม), หรือ orgId ของโมเดลนั้นเป็นคนละความหมายกับเส้นแบ่ง
 *      การเข้าถึงจริง (Notification.orgId เป็น metadata ของเรื่อง ไม่ใช่ตัว
 *      กำหนดว่าใครเห็นได้ — userId ที่ query ผูกไว้อยู่แล้วต่างหากคือเส้นแบ่ง)
 *
 * ⚠ ข้อควรระวัง (ไม่มีอะไรบังคับเชิงโครงสร้าง ต้องมีวินัยเอง): AsyncLocalStorage
 * ครอบทุกคำสั่งที่รันอยู่ใน callback ไม่ใช่แค่คำสั่งเดียว — เขียน
 * `crossOrg(reason, async () => { await a(); await b(); })` แล้วทั้ง a และ b
 * จะข้ามการ์ดพร้อมกัน แม้ b จะไม่ได้ตั้งใจข้ามบริษัทเลยก็ตาม — 1 crossOrg()
 * ต่อ 1 query เท่านั้น อย่าใส่ query อื่นที่ไม่เกี่ยวเข้าไปใน callback เดียวกัน
 */

/** เหตุผลที่อนุญาตให้ข้ามบริษัทได้ — รายการนี้คือ allowlist ตัวจริง ไม่ใช่แค่
 * เอกสารประกอบ ดูการใช้งานจริงแต่ละอันได้จาก grep `crossOrg("<reason>"` */
export const CROSS_ORG_REASONS = [
  // apps/web/modules/maintenance/data/cron.ts — งาน cron ที่ตั้งใจวิ่งข้าม
  // ทุกบริษัทในรอบเดียว (แจ้งเตือน PM/ค่าใช้จ่ายที่เลยกำหนดทั้งระบบ) แต่ละแถว
  // resolve orgId ของตัวเองไปกลุ่มทีหลัง ไม่ใช่คืนข้อมูลข้ามบริษัทให้ผู้ใช้เห็น
  "cron:platform-job-resolves-org-per-row",
  // ค้นหาแถวด้วย id ภายนอกที่ unique ทั้งระบบ (ไม่ใช่แค่ unique ในบริษัทเดียว)
  // ตอนที่ยังไม่รู้ orgId เลย — orgId คือ "คำตอบ" ที่ query นี้กำลังหา ไม่ใช่
  // เงื่อนไขกรอง: apps/web/app/api/auth/line/*.ts (lineUserId, ก่อนล็อกอิน)
  // และ discord/config.ts findChannel() (discordChannelId, webhook ขาเข้า
  // ไม่ใช่ล็อกอิน แต่หลักการเดียวกัน)
  "auth:lookup-by-globally-unique-external-id",
  // apps/web/modules/maintenance/data/notify.ts — Notification.orgId เป็น
  // metadata ว่า "เรื่องนี้เกี่ยวกับบริษัทไหน" ไม่ใช่เส้นแบ่งว่าใครอ่านได้ —
  // เส้นแบ่งจริงคือ userId ที่ query ผูกไว้แล้ว (ผู้รับคนเดียว = บริษัทเดียว
  // อยู่แล้วโดยไม่ต้องเช็คซ้ำ, ยกเว้น platform user ที่ userId ไม่มี orgId
  // ผูกเลย ซึ่งเป็นเหตุผลที่ห้ามกรองด้วย orgId ของผู้รับตรง ๆ)
  "notification:recipient-scoped-not-org-scoped",
] as const;

export type CrossOrgReason = (typeof CROSS_ORG_REASONS)[number];

const storage = new AsyncLocalStorage<{ reason: CrossOrgReason }>();

/** อ่านจาก tenant-guard.ts เท่านั้น — ไม่ export ให้โค้ดแอปเรียกตรง ๆ */
export function activeCrossOrgReason(): string | undefined {
  return storage.getStore()?.reason;
}

/**
 * ห่อ query เดียวที่ตั้งใจข้ามบริษัทจริง ๆ — วางแนบชิดกับตัว prisma call ที่
 * จุดนั้นเลย (หลักการข้อ 1-2 ด้านบน) ตัวอย่าง:
 *
 *   const due = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
 *     prisma.pmSchedule.findMany({ where: { isActive: true } })
 *   );
 */
export function crossOrg<T>(reason: CrossOrgReason, run: () => Promise<T>): Promise<T> {
  return storage.run({ reason }, run);
}
