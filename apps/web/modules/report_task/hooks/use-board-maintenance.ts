"use client";

import { useEffect, useMemo } from "react";
import { useMaintenanceBoardStore } from "@/modules/report_task/store/maintenance-board-store";
import { matchesMaintenanceFilters } from "@/modules/report_task/lib/maintenance-board";
import type { TaskFilterState } from "@/modules/report_task/lib/task-filter";
import type { Task } from "@/modules/report_task/types";

/**
 * ใบงานซ่อม/สั่งซื้ออุปกรณ์ของหน้างาน — ใช้ร่วมกันทั้ง 3 มุมมอง (บอร์ด/ตาราง/ภาระงาน) ให้ข้อมูล + ตัวกรอง
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

  useEffect(() => {
    setCounts({
      task: filteredTasks.length,
      wo: mxFiltered.filter((i) => i.kind === "wo").length,
      po: mxFiltered.filter((i) => i.kind === "po").length,
    });
  }, [filteredTasks, mxFiltered, setCounts]);

  const shownTasks = useMemo(() => (kinds.task ? filteredTasks : []), [kinds.task, filteredTasks]);
  const shownMx = useMemo(() => mxFiltered.filter((i) => kinds[i.kind]), [mxFiltered, kinds]);
  return { shownTasks, shownMx };
}
