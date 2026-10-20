"use client";

import { useEffect, useMemo } from "react";
import { useMaintenanceBoardStore } from "@/modules/report_task/store/maintenance-board-store";
import { matchesMaintenanceFilters, WO_TYPES, woTypesOf, type WoType } from "@/modules/report_task/lib/maintenance-board";
import type { TaskFilterState } from "@/modules/report_task/lib/task-filter";
import type { Task } from "@/modules/report_task/types";

/**
 * ใบงานซ่อมของหน้างาน — ใช้ร่วมกันทั้ง 3 มุมมอง (บอร์ด/ตาราง/ภาระงาน) ให้ข้อมูล + ตัวกรอง
 * + ติ๊ก "แสดงบนบอร์ด" เป็นชุดเดียวกัน ("มันคืองานเดียวกัน ... ฟิลเตอร์อะไรให้มันลิ้งกันให้หมด")
 *
 * ดึงตอนเปิด + ทุก 2 นาที + ตอนสลับกลับมาที่แอป · คัดด้วยตัวกรองเดิมของบอร์ด (matchesMaintenanceFilters)
 * แล้วตั้งตัวเลขในเมนู "แสดงบนบอร์ด" จาก filteredTasks ที่มุมมองนั้นส่งมา (มีมุมมองเดียวเปิดอยู่ทีละอัน)
 *
 * คืน shownTasks / shownMx = ที่เหลือหลังติ๊กประเภทออก — มุมมองเอาไปแสดงต่อได้เลย
 */
export function useBoardMaintenance(filteredTasks: Task[], filters: TaskFilterState) {
  const mxItems = useMaintenanceBoardStore((s) => s.items);
  const kinds = useMaintenanceBoardStore((s) => s.kinds);
  const load = useMaintenanceBoardStore((s) => s.load);
  const setCounts = useMaintenanceBoardStore((s) => s.setCounts);
  const woTypes = useMaintenanceBoardStore((s) => s.woTypes);
  const setWoTypeCounts = useMaintenanceBoardStore((s) => s.setWoTypeCounts);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 120_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const mxFiltered = useMemo(() => mxItems.filter((i) => matchesMaintenanceFilters(i, filters)), [mxItems, filters]);
  // ประเภทย่อยของใบงานซ่อม (ซ่อมทั่วไป/PM/อัตโนมัติ/มี PO) — ใบที่มีหลายแบบ ขึ้นถ้าติ๊กแบบใดแบบหนึ่งไว้
  const mxTyped = useMemo(
    () => mxFiltered.filter((i) => i.kind !== "wo" || woTypesOf(i).some((t) => woTypes[t])),
    [mxFiltered, woTypes]
  );

  useEffect(() => {
    setCounts({
      task: filteredTasks.length,
      wo: mxTyped.length,
    });
    const typeCounts = Object.fromEntries(WO_TYPES.map((t) => [t.id, 0])) as Record<WoType, number>;
    for (const i of mxFiltered) for (const t of woTypesOf(i)) typeCounts[t] += 1;
    setWoTypeCounts(typeCounts);
  }, [filteredTasks, mxFiltered, mxTyped, setCounts, setWoTypeCounts]);

  const shownTasks = useMemo(() => (kinds.task ? filteredTasks : []), [kinds.task, filteredTasks]);
  const shownMx = useMemo(() => mxTyped.filter((i) => kinds[i.kind]), [mxTyped, kinds]);
  return { shownTasks, shownMx };
}
