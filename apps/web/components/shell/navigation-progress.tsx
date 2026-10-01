"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * แถบโหลดบาง ๆ ด้านบนจอ — ขึ้นทันทีที่กดลิงก์ไปหน้าอื่น หายเมื่อหน้าใหม่ขึ้น
 *
 * ทุกหน้าเป็น dynamic และลิงก์ปิด prefetch ไว้ (ดู shell.tsx) — กดแล้วต้องรอ
 * เซิร์ฟเวอร์สร้างหน้าใหม่เสร็จก่อนจอถึงจะเปลี่ยน ระหว่างนั้นจอนิ่งสนิท ผู้ใช้
 * รู้สึกว่า "กดไม่ติด/ไม่สมูท" ทั้งที่กำลังโหลดอยู่ ("เวลาคลิกเปลี่ยนหน้ามันดูไม่สมูท")
 *
 * จับเฉพาะการกด <a> ภายในเว็บเดียวกันที่ไปคนละ path/query (ไม่นับแท็บใหม่,
 * ลิงก์ดาวน์โหลด, # ในหน้าเดิม, กดพร้อม Ctrl/Cmd) — เปลี่ยนหน้าด้วย router.push
 * ตรง ๆ จะไม่มีแถบ ซึ่งไม่เสียหายอะไร
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (hide.current) clearTimeout(hide.current);
      if (safety.current) clearTimeout(safety.current);
      setState("loading");
      // หน้าไม่เปลี่ยนจริง (ถูกกันไว้ หรือ error) — อย่าค้างแถบไว้ตลอด
      safety.current = setTimeout(() => setState("idle"), 15_000);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // หน้าใหม่ขึ้นแล้ว (path หรือ query เปลี่ยน) — วิ่งให้สุดแล้วจางหาย
  useEffect(() => {
    if (safety.current) clearTimeout(safety.current);
    setState((s) => (s === "loading" ? "done" : s));
    hide.current = setTimeout(() => setState("idle"), 300);
    return () => {
      if (hide.current) clearTimeout(hide.current);
    };
  }, [pathname, searchParams]);

  if (state === "idle") return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px]"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div
        className="h-full bg-(--brand-green) shadow-[0_0_6px_var(--brand-green)] motion-reduce:transition-none"
        style={{
          width: state === "done" ? "100%" : "85%",
          opacity: state === "done" ? 0 : 1,
          // เริ่ม: ไหลช้า ๆ ไปถึง 85% (ไม่รู้ว่าจะเสร็จเมื่อไหร่) · จบ: ไปสุดเร็ว ๆ แล้วจาง
          transition:
            state === "done"
              ? "width 150ms ease-out, opacity 250ms ease 100ms"
              : "width 8s cubic-bezier(0.1, 0.7, 0.2, 1)",
          animation: state === "loading" ? "nav-progress-start 8s cubic-bezier(0.1, 0.7, 0.2, 1)" : undefined,
        }}
      />
      <style>{`@keyframes nav-progress-start { from { width: 0% } to { width: 85% } }`}</style>
    </div>
  );
}
