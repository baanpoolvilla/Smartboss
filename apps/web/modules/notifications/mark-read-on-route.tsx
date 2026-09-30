"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { useUnifiedNotifications } from "./use-unified-notifications";

/**
 * อยู่ที่หน้าไหน = อ่านแจ้งเตือนที่ชี้มาหน้านั้นแล้ว — ทุกโมดูล (แชท, งาน, ห้องรายงาน, HR, งานซ่อม)
 *
 * เดิมแจ้งเตือนในกระดิ่งหายเฉพาะตอนกดจากกระดิ่งเอง (หรือ "อ่านทั้งหมด") เปิดเรื่องนั้นเองจากเมนู
 * ซ้าย จุดแดงที่เมนูหาย แต่กระดิ่ง (และจุดบนไอคอนแอป) ยังค้าง ("เปิดอันนั้นดูไปแล้ว ต้องไปกด
 * อ่านทั้งหมดถึงจะหาย") วางครั้งเดียวที่ Shell
 *
 * เทียบ path ตรงกัน + พารามิเตอร์ที่ "ระบุเรื่อง" (ห้องแชท, งาน, ห้องรายงาน, แท็บ, วันที่) ต้องตรงด้วย
 * พารามิเตอร์ที่เจาะลึกกว่านั้น (post=, reply=) ไม่ต้องตรง — เปิดห้องนั้นก็ถือว่าเห็นแล้ว
 * แจ้งเตือนที่มาระหว่างเปิดหน้านั้นอยู่ก็อ่านทันที (เห็นอยู่ตรงหน้า)
 */
const IDENTITY_PARAMS = ["c", "task", "topic", "tab", "date"] as const;
/** หน้ารวม — เปิดแล้วไม่ใช่ว่าอ่านทุกอันที่ลิงก์มาที่นี่ */
const NEVER_MATCH = new Set(["/", "/notifications"]);

function pointsHere(link: string, pathname: string, search: URLSearchParams): boolean {
  let target: URL;
  try {
    target = new URL(link, "https://x.invalid");
  } catch {
    return false;
  }
  if (NEVER_MATCH.has(target.pathname) || target.pathname !== pathname) return false;
  return IDENTITY_PARAMS.every((k) => !target.searchParams.has(k) || target.searchParams.get(k) === search.get(k));
}

export function MarkReadOnRoute() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { items, markRead } = useUnifiedNotifications();
  // กันยิงซ้ำระหว่างรอ store อัปเดต
  const sent = useRef(new Set<string>());

  useEffect(() => {
    const search = new URLSearchParams(searchParams.toString());
    for (const n of items) {
      if (n.read || n.scope === "org" || !n.link || sent.current.has(n.id)) continue;
      if (!pointsHere(n.link, pathname, search)) continue;
      sent.current.add(n.id);
      markRead(n.id);
    }
    // markRead เปลี่ยน reference ทุก render — ไม่ใส่ ไม่งั้นวนเอง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, pathname, searchParams]);

  return null;
}
