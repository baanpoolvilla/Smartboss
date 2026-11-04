"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { currentUrl, recordPop, recordVisit } from "@/lib/nav-stack";

/** บันทึกทุกหน้าที่เข้าในแท็บนี้ ให้ปุ่มย้อนกลับรู้ว่ามาจากไหน (ดู lib/nav-stack.ts) */
export function NavTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    recordVisit(query ? `${pathname}?${query}` : pathname);
  }, [pathname, query]);

  useEffect(() => {
    // ถอยด้วยเบราว์เซอร์/ปุ่มมือถือ — ที่อยู่เปลี่ยนแล้วตอน popstate จึงอ่านได้เลย
    const onPop = () => recordPop(currentUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return null;
}
