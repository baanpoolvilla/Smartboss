"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, RotateCw } from "lucide-react";

/** แถบเครื่องมือบาง ๆ + เว็บปลายทางเต็มพื้นที่ที่เหลือใต้แถบบนของ SmartBoss */
export function EmbeddedApp({ name, host, src }: { name: string; host: string; src: string }) {
  // เปลี่ยน key = โหลด iframe ใหม่ (ปุ่มรีเฟรช — ล็อกอินใหม่ผ่าน SSO ให้ด้วย)
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);

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
          {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin self-center text-(--ink-soft)" aria-label="กำลังโหลด" />}
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setReloadKey((k) => k + 1);
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
          aria-label="โหลดใหม่"
          title="โหลดใหม่"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        {/* สำรอง: เว็บปลายทางล็อกอินในกรอบไม่ได้ (บางเบราว์เซอร์ เช่น Safari บล็อก cookie ในกรอบ) */}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
          title="เปิดในแท็บใหม่"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="hidden sm:inline">เปิดในแท็บใหม่</span>
        </a>
      </div>
      <iframe
        key={reloadKey}
        src={src}
        title={name}
        onLoad={() => setLoading(false)}
        className="min-h-0 w-full flex-1 border-0"
        allow="clipboard-read; clipboard-write; fullscreen; camera; microphone; geolocation"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
