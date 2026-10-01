"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useTaskStore } from "@/modules/report_task/store/task-store";

/**
 * Keeps the currently-open Task Detail Sheet's id mirrored in the `?task=`
 * URL param — `openTaskId` is derived straight from the param (no local
 * state to keep in sync), so a browser Back that changes the URL is picked
 * up for free on the next render, no effect-driven setState needed.
 *
 * `open()` pushes a new history entry, so the browser Back button pops it —
 * closing the sheet first instead of leaving the whole page — and reloading
 * the page (or sharing the link) reopens the same task. `close()` uses
 * `replace` instead of `back()`: it only needs to strip the param from the
 * current entry, not consume a Back step, so pressing X/Escape never causes
 * an extra Back press to do nothing.
 */
export function useTaskSheetParam(initialFallback?: string | null) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramTaskId = searchParams.get("task");
  // เปิดงานด้วย push จากหน้านี้เอง → ปิดด้วยการถอยกลับ (ไม่ใช่ replace) ประวัติจะไม่ค้าง
  // "หน้าบอร์ดซ้ำ" ที่ทำให้กดปุ่มย้อนกลับของมือถือแล้วเหมือนไม่เกิดอะไร
  const pushedRef = useRef(false);

  const open = useCallback(
    (id: string | null) => {
      pushedRef.current = !!id && !paramTaskId;
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("task", id);
      else params.delete("task");
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams, paramTaskId]
  );

  const close = useCallback(() => {
    // ไม่ล้าง pushedRef ตรงนี้ — หน้าต่างอาจเรียก close ซ้ำระหว่างถอย (ปุ่มย้อนกลับปิดหน้าต่างด้วย)
    // ล้างตอน ?task= หายไปจาก URL จริงแทน (effect ข้างล่าง)
    if (pushedRef.current) {
      router.back();
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!paramTaskId) pushedRef.current = false;
  }, [paramTaskId]);

  // One-shot: fold a navigation-intent-sourced initial task (e.g. clicking a
  // dashboard widget that jumps here with "open this task") into the URL too,
  // so Back still closes it — but only when the URL doesn't already carry its
  // own `?task=` (a shared link or a same-page refresh takes priority).
  useEffect(() => {
    if (initialFallback && !paramTaskId) open(initialFallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `?taskTitle=` — แจ้งเตือนรุ่นเก่าที่ไม่ได้เก็บลิงก์ กดจากกระดิ่งนอกหน้างาน (ตอนนั้นยังไม่รู้ id)
  // โหลดงานเสร็จแล้วหาจากชื่อ ชื่อซ้ำเลือกงานล่าสุด แล้วแทนเป็น `?task=<id>` เปิดงานนั้น
  const titleParam = searchParams.get("taskTitle");
  const tasks = useTaskStore((s) => s.tasks);
  const tasksLoaded = useTaskStore((s) => s.loaded);
  useEffect(() => {
    if (!titleParam || !tasksLoaded) return;
    const match = tasks
      .filter((t) => t.title === titleParam)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const params = new URLSearchParams(searchParams.toString());
    params.delete("taskTitle");
    if (match) params.set("task", match.id);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [titleParam, tasksLoaded, tasks, searchParams, pathname, router]);

  return { openTaskId: paramTaskId, open, close };
}
