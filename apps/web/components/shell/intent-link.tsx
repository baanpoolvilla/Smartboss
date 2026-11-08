"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps } from "react";

/**
 * ลิงก์ที่โหลดหน้าปลายทางรอไว้ "ตอนผู้ใช้ส่อว่าจะกด" — เมาส์ชี้ค้าง ~80ms / เริ่มแตะ (มือถือ) / โฟกัสด้วยคีย์บอร์ด
 * ผู้ใช้ 8/11/2569 "กดเมนูแล้วหน่วง"
 *
 * แบบเดียวกับ instant.page และที่ Next.js แนะนำ (prefetch เมื่อมี intent): เดิมปิด prefetch ทุกเมนู (a9523c7)
 * เพราะค่าเริ่มต้นของ Next โหลด "ทุกลิงก์ที่มองเห็น" พร้อมกัน สิบกว่าหน้า ชน DB pool บน VM 2 core — ตรงนี้โหลดทีละ
 * ลิงก์ที่กำลังจะกดจริงเท่านั้น (ชี้ผ่านเร็ว ๆ ไม่นับ) ช่วงที่ได้คือเวลาระหว่างชี้/แตะ ถึงตอนปล่อยนิ้ว (~100–300ms)
 *
 * ข้อมูลที่โหลดรอไว้เก่าได้: ชี้แล้วไม่กด แล้วกลับมากดทีหลัง Next จะใช้ชุดที่โหลดไว้ (เก็บ ~5 นาที)
 * จึงจดเวลาไว้ ถ้าเกิน FRESH_MS ตอนเข้าหน้า LiveRefresh ดึงใหม่ทันที (consumeStalePrefetch)
 */
const HOVER_DELAY_MS = 80;
const FRESH_MS = 15_000;
// ปิดกลับหลังโหลดแล้ว — เปิดค้างไว้ Next จะโหลดซ้ำเองทุกครั้งที่ชุดเดิมหมดอายุตราบที่ลิงก์ยังอยู่บนจอ
const DISARM_MS = 20_000;

const prefetchedAt = new Map<string, number>();

/** เข้าหน้านี้แล้ว — หน้าที่ได้มาจากชุดที่โหลดรอไว้นานเกิน FRESH_MS ควรดึงใหม่ (true) */
export function consumeStalePrefetch(pathname: string): boolean {
  const at = prefetchedAt.get(pathname);
  if (at === undefined) return false;
  prefetchedAt.delete(pathname);
  return Date.now() - at > FRESH_MS;
}

function pathOf(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string };

export function IntentLink({ href, onMouseEnter, onMouseLeave, onTouchStart, onFocus, ...rest }: Props) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const arm = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const key = pathOf(href);
    if (!prefetchedAt.has(key)) prefetchedAt.set(key, Date.now());
    setArmed(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setArmed(false);
    }, DISARM_MS);
  };

  return (
    <Link
      href={href}
      // false จนกว่าจะส่อว่าจะกด แล้วค่อยเปิด (true = โหลดทั้งหน้ารวมข้อมูล) — Next เริ่มโหลดทันทีที่เปลี่ยนค่า
      prefetch={armed}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        if (armed || timer.current) return;
        timer.current = setTimeout(arm, HOVER_DELAY_MS);
      }}
      onMouseLeave={(e) => {
        onMouseLeave?.(e);
        if (timer.current && !armed) {
          clearTimeout(timer.current);
          timer.current = null;
        }
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        if (!armed) arm();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        if (!armed && e.currentTarget.matches(":focus-visible")) arm();
      }}
      {...rest}
    />
  );
}
