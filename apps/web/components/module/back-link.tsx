"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { whenHistorySettled } from "@/lib/back-to-close";
import { takeBackTarget } from "@/lib/nav-stack";

/**
 * ลิงก์ย้อนกลับ — กลับไปหน้าที่เพิ่งมาจริง
 * `href` เป็นปลายทางสำรอง ใช้เมื่อไม่มีประวัติ เช่น เปิดจากลิงก์แจ้งเตือนหรือแท็บใหม่
 * กดปกติเท่านั้นที่ย้อนตามประวัติ กดเปิดแท็บใหม่ยังไปตาม href
 */
export function BackLink({
  href,
  className,
  label = "ย้อนกลับ",
  children,
}: {
  href: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const target = takeBackTarget();
        if (!target) return;
        e.preventDefault();
        whenHistorySettled(() => {
          if (target.direct) router.back();
          else router.push(target.url);
        });
      }}
    >
      {children}
    </Link>
  );
}
