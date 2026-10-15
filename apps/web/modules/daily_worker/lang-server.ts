import "server-only";
import { cookies } from "next/headers";

import { WORKER_ROLE_CODE } from "./permissions";
import { parseWorkerLang, WORKER_LANG_COOKIE, type WorkerLang } from "./i18n";

/**
 * ภาษาหน้าจอของผู้ใช้คนนี้ — คนงาน: ตามคุกกี้ (ไม่เคยเลือก = พม่า) · ผู้ใช้อื่น: ไทยเสมอ
 */
export async function workerLangFor(roles: readonly string[]): Promise<WorkerLang> {
  if (!roles.includes(WORKER_ROLE_CODE)) return "th";
  return parseWorkerLang((await cookies()).get(WORKER_LANG_COOKIE)?.value);
}
