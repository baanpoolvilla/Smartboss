"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { currentUrl, recordPop, recordVisit } from "@/lib/nav-stack";

/** บันทึกทุกหน้าที่เข้าในแท็บนี้ ให้ปุ่มย้อนกลับรู้ว่ามาจากไหน (ดู lib/nav-stack.ts) */
export function NavTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  const first = useRef(true);
  useEffect(() => {
    const url = query ? `${pathname}?${query}` : pathname;
    // ถอยแล้วเบราว์เซอร์โหลดหน้าใหม่ทั้งหน้า ไม่มี popstate ให้ฟัง ต้องอ่านชนิดการเปิดหน้าแทน
    const nav = first.current ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined) : undefined;
    first.current = false;
    if (nav?.type === "back_forward") recordPop(url);
    else recordVisit(url);
  }, [pathname, query]);

  useEffect(() => {
    // ถอยด้วยเบราว์เซอร์/ปุ่มมือถือ — ที่อยู่เปลี่ยนแล้วตอน popstate จึงอ่านได้เลย
    const onPop = () => recordPop(currentUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return null;
}
