"use client";

import { useEffect } from "react";

/**
 * รายวันของแต่ละคนพับไว้ (<details data-day-table>) ให้หน้าไม่ยาว — แต่:
 * - พิมพ์/บันทึก PDF: กางทุกคนก่อนพิมพ์ แล้วคืนสภาพหลังพิมพ์ เอกสารเหมือนเดิมทุกอย่าง
 * - กดชื่อในตารางสรุป (#emp-…): กางคนนั้นแล้วเลื่อนไปหา
 */
export function DetailsBehaviour() {
  useEffect(() => {
    const all = () => Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-day-table]"));
    let wasOpen: boolean[] = [];
    const before = () => {
      const list = all();
      // beforeprint ซ้อนกัน (บางเบราว์เซอร์/สั่งพิมพ์ซ้ำ) — จำสภาพครั้งแรกเท่านั้น ไม่งั้นหลังพิมพ์จะกางค้างหมด
      if (wasOpen.length === 0) wasOpen = list.map((d) => d.open);
      for (const d of list) d.open = true;
    };
    const after = () => {
      all().forEach((d, i) => {
        if (wasOpen[i] === false) d.open = false;
      });
      wasOpen = [];
    };
    const openId = (id: string) => {
      if (!id) return;
      const el = document.getElementById(id);
      const details = el?.querySelector<HTMLDetailsElement>("details[data-day-table]");
      if (details && !details.open) {
        details.open = true;
      }
      el?.scrollIntoView({ block: "start" });
    };
    const openHash = () => openId(decodeURIComponent(location.hash.slice(1)));
    // กดลิงก์ชื่อเดิมซ้ำ hash ไม่เปลี่ยน → hashchange ไม่ยิง จึงจับคลิกเองด้วย
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#emp-"]');
      if (!a) return;
      const id = a.getAttribute("href")!.slice(1);
      setTimeout(() => openId(id), 0);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    window.addEventListener("hashchange", openHash);
    document.addEventListener("click", onClick);
    if (location.hash) openHash();
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      window.removeEventListener("hashchange", openHash);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}
