"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, RotateCw } from "lucide-react";

/** token ล็อกอินอายุ 60 วินาที — หน้าเก่ากว่านี้ (กดย้อนกลับมา / router cache) ต้องขอลิงก์ใหม่ก่อนโหลด */
const TOKEN_FRESH_MS = 45_000;

/** แถบเครื่องมือบาง ๆ + เว็บปลายทางเต็มพื้นที่ที่เหลือใต้แถบบนของ SmartBoss */
export function EmbeddedApp({
  name,
  host,
  src,
  issuedAt,
  newTabHref,
}: {
  name: string;
  host: string;
  /** ลิงก์ล็อกอินของแอป (มี token) — เปลี่ยนทุกครั้งที่หน้า render ใหม่ */
  src: string;
  issuedAt: number;
  /** ปุ่มสำรอง — เปิดแท็บใหม่ (route ของ SmartBoss เซ็น token ใหม่ตอนกด) */
  newTabHref: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  // หน้าที่ได้มาจาก cache (กดย้อนกลับมา) อาจมี token หมดอายุแล้ว — ยังไม่โหลดกรอบ ขอหน้าใหม่ก่อน
  // (ตอน SSR หน้าเพิ่งสร้าง ค่านี้เป็น false ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ — ไม่เพี้ยนตอน hydrate)
  // ได้ token ใหม่แล้วหน้าแม่ใส่ key ใหม่ คอมโพเนนต์นี้ถูกสร้างใหม่ ค่าเริ่มคำนวณใหม่เอง
  const [stale] = useState(() => Date.now() - issuedAt > TOKEN_FRESH_MS);
  useEffect(() => {
    if (stale) router.refresh();
  }, [stale, router]);

  return (
    // ล้น padding ของ <main> (p-6) ให้เต็มขอบ · สูงเท่าจอลบแถบบน 60px ของ SmartBoss
    <div className="-m-6 flex h-[calc(100dvh-60px)] flex-col bg-(--bg)">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-(--line) px-2 sm:px-3">
        <Link
          href="/sales-marketing"
          className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
          aria-label="กลับไปหน้า ขาย & การตลาด"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">ขาย &amp; การตลาด</span>
        </Link>
        <div className="flex min-w-0 flex-1 items-baseline gap-2 px-1">
          <span className="truncate text-sm font-semibold text-(--ink)">{name}</span>
          <span className="hidden truncate text-xs text-(--ink-soft) sm:inline">{host}</span>
          {(loading || stale) && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin self-center text-(--ink-soft)" aria-label="กำลังโหลด" />}
        </div>
        <button
          type="button"
          onClick={() => {
            // ขอหน้าใหม่ = ได้ token ใหม่ → src เปลี่ยน → กรอบโหลดใหม่ (ล็อกอินใหม่ให้ด้วย)
            setLoading(true);
            router.refresh();
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
          aria-label="โหลดใหม่"
          title="โหลดใหม่"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        {/* สำรอง: เบราว์เซอร์ที่ไม่ยอมให้เว็บในกรอบจำการล็อกอิน (เช่น Safari บางรุ่น) */}
        <a
          href={newTabHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
          title="เปิดในแท็บใหม่"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="hidden sm:inline">เปิดในแท็บใหม่</span>
        </a>
      </div>
      {stale ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <iframe
          // src ใหม่ (token ใหม่) = กรอบใหม่ทั้งอัน
          key={src}
          src={src}
          title={name}
          onLoad={() => setLoading(false)}
          className="min-h-0 w-full flex-1 border-0"
          // autoplay: เสียงแจ้งข้อความใหม่ของ Baanpool-Chat · clipboard: ปุ่มคัดลอกข้อความ
          allow="autoplay; clipboard-read; clipboard-write; fullscreen; camera; microphone"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
