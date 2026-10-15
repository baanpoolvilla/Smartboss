"use client";

import { useShellOptional } from "@/components/shell/shell-context";
import { tr, type WorkerLang, type WorkerTextKey } from "../i18n";

/**
 * ข้อความบนหน้าจอทั่วไป (เช่นช่องเขียนรีพอต) ตามภาษาของคนงาน — ผู้ใช้อื่น/นอก shell = ไทยเหมือนเดิม
 * ข้อความไทยในตาราง (i18n.ts) ตรงกับของเดิมทุกตัว พนักงานทั่วไปจึงเห็นเหมือนเดิมเป๊ะ
 */
export function useWorkerUi(): { lang: WorkerLang; t: (key: WorkerTextKey, vars?: Record<string, string | number>) => string } {
  const lang = useShellOptional()?.user.workerLang ?? "th";
  return { lang, t: (key, vars) => tr(lang, key, vars) };
}
