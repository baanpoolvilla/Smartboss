"use client";

import { createContext, useContext } from "react";

import { tr, type WorkerLang, type WorkerTextKey } from "@/modules/daily_worker/i18n";

/**
 * ภาษาของหน้าลงเวลา — ค่าเริ่มต้นไทย (HR / LINE Mini App ของพนักงานทั่วไปเหมือนเดิม)
 * หน้าลงเวลาของคนงาน (/daily-workers/clock) ครอบด้วยภาษาที่คนงานเลือก (เริ่มต้นพม่า)
 */
const LangContext = createContext<WorkerLang>("th");

export function WorkerLangProvider({ lang, children }: { lang: WorkerLang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useWorkerLang(): WorkerLang {
  return useContext(LangContext);
}

export function useT() {
  const lang = useContext(LangContext);
  return (key: WorkerTextKey, vars?: Record<string, string | number>) => tr(lang, key, vars);
}
