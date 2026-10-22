"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** เรียก server action แล้วรีเฟรชหน้า — กันกดซ้ำระหว่างทำงาน (busy) และแสดงข้อผิดพลาดเป็นภาษาคน */
export function useRun() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: () => Promise<{ ok?: boolean; error?: string } | { ok: true }>, after?: () => void) {
    setError(null);
    start(async () => {
      try {
        const res = (await fn()) as { ok?: boolean; error?: string };
        if (!res.ok) {
          setError(res.error ?? "ทำไม่สำเร็จ");
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError("เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง");
      }
    });
  }
  return { busy, error, run, setError };
}
