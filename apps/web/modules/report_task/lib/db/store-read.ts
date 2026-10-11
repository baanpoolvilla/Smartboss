import "server-only";

import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";
import { listDepartmentsWithOverlay } from "@/modules/report_task/lib/db/departments";
import { ownNotifications, readStore } from "@/modules/report_task/lib/db/org-store";
import {
  listHolidayEvents,
  listLeaveEvents,
  listLeaveTypeCatalog,
  listOvertimeEvents,
} from "@/modules/report_task/lib/db/workforce-calendar";

/*
 * อ่าน store หนึ่งคีย์ในรูปที่ส่งให้ client — ใช้ร่วมกันระหว่าง GET /api/report-task/store/[key]
 * กับ GET /api/report-task/stores (อ่านหลายคีย์ในคำขอเดียวตอนเข้าโมดูล) จะได้ไม่มีสองชุดที่วันหนึ่งไม่ตรงกัน
 * ผู้เรียกตรวจ isValidStoreKey + session มาแล้ว
 */

/*
 * "employees" ไม่ได้เก็บเป็นก้อนเหมือนคีย์อื่น — สร้างจาก core.users ทุกครั้ง
 * เพื่อให้คนในโมดูลนี้เป็นคนเดียวกับที่ล็อกอิน (ดู employee-directory.ts)
 * version คงที่ 1 เพราะไม่มีการชนกันของสองแท็บ — ตัวจริงอยู่ที่ core.users
 */
export const DIRECTORY_KEY = "employees";

/*
 * "departments" ก็เช่นกัน — ชื่อ/การมีอยู่จริงมาจาก core.departments (จัดการที่
 * /admin/departments) ส่วนสี/หัวหน้าแผนกยังเป็นของโมดูลนี้เอง (ดู lib/db/departments.ts)
 */
export const DEPARTMENTS_KEY = "departments";

/** แจ้งเตือน — ส่ง/รับเฉพาะของเจ้าของเครื่อง (ดู ownNotifications / writeOwnNotifications) */
export const NOTIFICATIONS_KEY = "notifications";

/*
 * การลากับวันหยุดเป็นของโมดูลบุคคล (workforce) — อ่านอย่างเดียวที่นี่
 *
 * เดิมโมดูลนี้เก็บของตัวเอง ทำให้มีข้อมูลการลาสองชุด และเงินเดือนคำนวณจาก
 * ชุดของ workforce เท่านั้น ⇒ ปฏิทินกับสลิปไม่ตรงกันโดยไม่มีอะไรเตือน
 */
export const WORKFORCE_KEYS = new Set(["leaves", "holidays", "overtime"]);

/** ชื่อประเภทลาทั้งหมด — ไม่ต้องใช้ช่วงวันที่เหมือนสองคีย์ข้างบน */
export const LEAVE_TYPE_CATALOG_KEY = "leave-type-catalog";

/** คีย์ที่ version คงที่ 1 (สร้างจากที่อื่นทุกครั้ง ไม่ได้เก็บเป็นก้อน) */
export function isFixedVersionKey(key: string): boolean {
  return key === DIRECTORY_KEY || key === DEPARTMENTS_KEY || key === LEAVE_TYPE_CATALOG_KEY || WORKFORCE_KEYS.has(key);
}

/** ช่วงที่ปฏิทินขอมาโดยปริยาย — กว้างพอครอบคลุมมุมมองปีของ FullCalendar */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - 6);
  const to = new Date(now);
  to.setMonth(to.getMonth() + 12);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export async function readStorePayload(
  orgId: string,
  userId: string,
  key: string
): Promise<{ payload: unknown; version: number }> {
  if (key === DIRECTORY_KEY) return { payload: await listDirectory(orgId), version: 1 };
  if (key === DEPARTMENTS_KEY) return { payload: await listDepartmentsWithOverlay(orgId), version: 1 };
  if (key === LEAVE_TYPE_CATALOG_KEY) return { payload: await listLeaveTypeCatalog(orgId), version: 1 };

  if (WORKFORCE_KEYS.has(key)) {
    const { from, to } = defaultRange();
    const events =
      key === "leaves"
        ? await listLeaveEvents(orgId, from, to)
        : key === "overtime"
          ? await listOvertimeEvents(orgId, from, to)
          : await listHolidayEvents(orgId, from, to);
    // holidays store เก็บเป็น { holidays, selectedByUser } ส่วน leaves/overtime เป็นอาร์เรย์ตรง ๆ
    return { payload: key === "holidays" ? { holidays: events, selectedByUser: {} } : events, version: 1 };
  }

  const { data, version } = await readStore<unknown>(orgId, key);
  // แจ้งเตือนเก็บรวมทั้งบริษัท แต่ส่งให้แต่ละคนเฉพาะของตัวเอง — เดิมทุกเครื่องได้ทั้งก้อน
  // (ของคนอื่นถูกซ่อนแค่ที่หน้าจอ แต่เปิด DevTools ก็อ่านได้ และโหลด 1.6 MB ทุกครั้ง)
  return { payload: key === NOTIFICATIONS_KEY ? ownNotifications(data, userId) : data, version };
}
