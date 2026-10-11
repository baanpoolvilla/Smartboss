"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * โครงหน้าแบบ Facebook / IG / LINE ระหว่างเปลี่ยนหน้า — กดแล้วพื้นที่เนื้อหากลายเป็นแท่งเทาวิบวับทันที
 * แล้วหน้าจริงค่อย ๆ จางขึ้นมาแทน ("อยากได้แบบเจ้าใหญ่ ๆ ที่ดูสบายตา ไม่เอ๊ะ ไม่สงสัย")
 *
 * เดิมกดแล้วจอค้างหน้าเก่าจนเซิร์ฟเวอร์สร้างหน้าใหม่เสร็จ (โมดูลส่วนใหญ่วาดแถบบน/เมนูในตัวหน้าเอง
 * หลังโหลดข้อมูลครบ) เห็นแค่แถบเขียวบาง ๆ ด้านบน แล้วหน้าใหม่เด้งขึ้นทีเดียว
 *
 * ทำฝั่งเครื่องล้วน ๆ — ไม่ใช้ loading.tsx ของ Next เพราะนั่นทำให้ลิงก์ในหน้าเริ่ม prefetch เองอัตโนมัติ
 * (สิ่งที่เคยทำเซิร์ฟเวอร์ 2 core ล่ม) · สถานะ "กำลังเปลี่ยนหน้า" มาจาก NavigationProgress
 */
let pending = false;
const listeners = new Set<() => void>();

export function setNavPending(next: boolean): void {
  if (pending === next) return;
  pending = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** หน้าที่มาเร็วกว่านี้ไม่ต้องเห็นโครงเลย (กันกระพริบ) */
const SHOW_AFTER_MS = 120;
/** โครงจางออกเผยหน้าจริง */
const FADE_MS = 200;

export function NavSkeleton({ variant }: { variant: "module" | "launcher" }) {
  const isPending = useSyncExternalStore(subscribe, () => pending, () => false);
  const [phase, setPhase] = useState<"hidden" | "shown" | "fading">("hidden");

  useEffect(() => {
    if (isPending) {
      const t = setTimeout(() => setPhase("shown"), SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    setPhase((p) => (p === "shown" ? "fading" : "hidden"));
    const t = setTimeout(() => setPhase("hidden"), FADE_MS);
    return () => clearTimeout(t);
  }, [isPending]);

  if (phase === "hidden") return null;

  return (
    <div
      aria-busy="true"
      aria-label="กำลังโหลด"
      // เว้นแถบล่างบนมือถือ (68px) และราง/หัวที่อยู่นอกพื้นที่เนื้อหา — ยังกดเมนูอื่นได้ระหว่างรอ
      className={`fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom,0px))] z-20 overflow-hidden bg-(--bg-soft) lg:bottom-0 ${
        variant === "module" ? "top-0 lg:left-[200px]" : "top-[60px]"
      }`}
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      {variant === "module" && (
        <div className="flex h-[60px] items-center justify-center border-b border-(--line) bg-(--bg)">
          <Bone className="h-5 w-36" />
        </div>
      )}
      <div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-5 sm:px-6">
        <Bone className="h-4 w-2/5" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-(--line) bg-(--bg) p-4">
            <Bone className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bone className={`h-3.5 ${i % 2 ? "w-1/2" : "w-2/3"}`} />
              <Bone className={`h-3 ${i % 2 ? "w-4/5" : "w-3/5"}`} />
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes nav-skeleton-shimmer { from { background-position: 150% 0 } to { background-position: -50% 0 } }
        .nav-skeleton-bone {
          background: linear-gradient(90deg, var(--line) 0%, color-mix(in srgb, var(--line) 45%, var(--bg)) 50%, var(--line) 100%);
          background-size: 200% 100%;
          animation: nav-skeleton-shimmer 1.2s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) { .nav-skeleton-bone { animation: none } }
      `}</style>
    </div>
  );
}

function Bone({ className }: { className: string }) {
  return <div className={`nav-skeleton-bone rounded-md ${className}`} />;
}
