import "server-only";
import { prisma } from "@smartboss/database";

import { readStore, writeStore } from "./org-store";
import type { Department } from "@/modules/report_task/types";

/**
 * แผนกของโมดูล — สร้างจาก `core.departments` (ของกลาง จัดการที่ /admin/departments
 * ใช้ร่วมกับทุกโมดูล) ไม่ใช่รายชื่อแยกของตัวเองอีกต่อไป
 *
 * สี/หัวหน้าแผนกไม่มีที่อยู่ใน core (ไม่ใช่แนวคิดร่วมข้ามโมดูล) — เก็บทับไว้เอง
 * ที่คีย์ "department-overlay" ผูกด้วย core.departments.id เดียวกับที่
 * employee-directory.ts ทำกับ "employee-profiles"
 *
 * ผลคือสร้าง/ลบแผนกที่ /admin แล้วโผล่/หายในโมดูลนี้ทันที ส่วนสีกับหัวหน้าแผนก
 * ยังปรับได้เองที่หน้าตั้งค่าของโมดูลตามเดิม
 */
interface DepartmentOverlay {
  color?: string;
  headId?: string;
}
type OverlayMap = Record<string, DepartmentOverlay>;
const OVERLAY_KEY = "department-overlay";

// สีตั้งต้นสำหรับแผนกที่ยังไม่เคยเลือกสีเอง — วนตามลำดับชื่อ ไม่ใช่สุ่ม
// เพื่อให้สีเดิมของแผนกเดิมไม่กระโดดไปมาระหว่างโหลดแต่ละครั้ง
const FALLBACK_COLORS = [
  "#3B82F6", "#8B5CF6", "#EC4899", "#22C55E",
  "#F97316", "#F59E0B", "#EF4444", "#6B7280",
];
function fallbackColor(index: number): string {
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]!;
}

export async function listDepartmentsWithOverlay(orgId: string): Promise<Department[]> {
  const [departments, overlay] = await Promise.all([
    prisma.department.findMany({ where: { orgId }, orderBy: { name: "asc" } }),
    readStore<OverlayMap>(orgId, OVERLAY_KEY),
  ]);

  const map = overlay.data ?? {};

  return departments.map((d, index) => ({
    id: d.id,
    name: d.name,
    color: map[d.id]?.color ?? fallbackColor(index),
    headId: map[d.id]?.headId ?? "",
  }));
}

/**
 * บันทึกเฉพาะส่วนที่โมดูลเป็นเจ้าของ (สี/หัวหน้าแผนก)
 *
 * ชื่อ/การสร้าง/การลบแผนกที่ client ส่งมาจะถูกทิ้ง — แก้ได้ที่ /admin/departments
 * เท่านั้น ไม่งั้นจะมีชุดแผนกสองชุดที่ไม่ตรงกัน
 */
export async function saveDepartmentOverlay(
  orgId: string,
  incoming: Department[],
  updatedBy?: string
): Promise<void> {
  const valid = new Set(
    (await prisma.department.findMany({ where: { orgId }, select: { id: true } })).map((d) => d.id)
  );

  const map: OverlayMap = {};
  for (const d of incoming) {
    if (!valid.has(d.id)) continue; // id ที่ไม่ใช่แผนกจริงของบริษัทนี้ (เช่น สร้างจากฝั่ง client) — ทิ้ง
    map[d.id] = {
      ...(d.color ? { color: d.color } : {}),
      ...(d.headId ? { headId: d.headId } : {}),
    };
  }

  const current = await readStore<OverlayMap>(orgId, OVERLAY_KEY);
  await writeStore(orgId, OVERLAY_KEY, map, current.version, updatedBy);
}
