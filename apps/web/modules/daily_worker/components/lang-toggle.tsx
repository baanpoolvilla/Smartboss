"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";

import { WORKER_LANG_COOKIE, WORKER_LANGS, type WorkerLang } from "../i18n";

/**
 * เลือกภาษาที่มุมขวาบน — เฉพาะบัญชีคนงาน (บทบาท WORKER) · เริ่มต้นพม่า สลับไทย/อังกฤษได้
 * จำในเครื่อง (คุกกี้ 1 ปี) แล้วโหลดหน้าใหม่ให้ข้อความเปลี่ยนทั้งหน้า
 */
export function WorkerLangToggle({ lang }: { lang: WorkerLang }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="relative inline-flex items-center gap-1 rounded-full border border-(--line) bg-(--bg) py-1 pl-2.5 pr-1 text-sm text-(--ink)">
      <Languages className="h-4 w-4 text-(--ink-soft)" aria-hidden />
      <select
        id="worker-lang"
        value={lang}
        disabled={pending}
        aria-label="Language / ဘာသာ / ภาษา"
        onChange={(e) => {
          const next = e.target.value as WorkerLang;
          document.cookie = `${WORKER_LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
          startTransition(() => router.refresh());
        }}
        className="cursor-pointer appearance-none bg-transparent pr-1 font-semibold outline-none"
      >
        {WORKER_LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
