import "server-only";

import { diffSlice, type StoreDelta } from "@/modules/report_task/lib/store-delta";

/**
 * บันทึกการเปลี่ยนแปลงของฟีดรายงาน (เรียงตามเลขเวอร์ชัน) — ให้เครื่องที่ถือเวอร์ชันเก่าได้เฉพาะส่วนที่เปลี่ยน
 * (ดู lib/store-delta.ts) · เก็บในหน่วยความจำของ next-server ตัวเดียวบน prod (smartboss-web.service)
 *
 * - snapshot: ข้อมูลล่าสุดที่รู้ + เวอร์ชัน — ใช้คำนวณ delta ตอนมีการบันทึก และใช้แทนการอ่านฐานข้อมูลก้อนใหญ่
 *   ตอนเครื่องส่ง "เฉพาะส่วนที่เปลี่ยน" ขึ้นมา
 * - log: delta ของเวอร์ชันล่าสุด ๆ · ต้องต่อกันไม่ขาดจากเวอร์ชันที่เครื่องถือถึงปัจจุบันเท่านั้นถึงใช้ได้
 *   รีสตาร์ต/มีทางบันทึกที่ไม่ผ่านที่นี่ = ขาดช่วง → เครื่องโหลดเต็มแบบเดิม
 *
 * ข้อตกลง: ข้อมูลที่ส่งเข้า writeStore ห้ามถูกแก้ไขภายหลัง (เก็บเป็น snapshot โดยไม่ copy)
 */
export const DELTA_KEYS = new Set<string>(["report-feed"]);
const MAX_LOG = 300;

type Entry = { version: number; delta: StoreDelta };
type State = { snap: { version: number; data: unknown } | null; log: Entry[] };

const g = globalThis as unknown as { __storeDeltaLog?: Map<string, State> };
const states = (g.__storeDeltaLog ??= new Map<string, State>());

function stateFor(orgId: string, key: string): State {
  const id = `${orgId}:${key}`;
  let s = states.get(id);
  if (!s) {
    s = { snap: null, log: [] };
    states.set(id, s);
  }
  return s;
}

/** อ่านเต็มจากฐานข้อมูลมาแล้ว — จำไว้เป็นจุดตั้งต้นของ delta ถัดไป */
export function rememberSnapshot(orgId: string, key: string, version: number, data: unknown) {
  if (!DELTA_KEYS.has(key) || data == null) return;
  const s = stateFor(orgId, key);
  if (s.snap && s.snap.version > version) return;
  if (s.snap && s.snap.version === version) return;
  s.snap = { version, data };
  // ข้ามจากเวอร์ชันที่ไม่รู้มาถึงตรงนี้ — log เดิมยังต่อกันได้ถึงแค่ก่อนช่วงที่ขาด ล้างทิ้งให้ง่าย
  if (s.log.length && s.log[s.log.length - 1]?.version !== version) s.log = [];
}

/** บันทึกสำเร็จแล้ว (ทุกทางที่ผ่าน writeStore) — คำนวณ delta จาก snapshot ถ้าเป็นเวอร์ชันก่อนหน้าพอดี */
export function recordWrite(orgId: string, key: string, version: number, data: unknown) {
  if (!DELTA_KEYS.has(key)) return;
  const s = stateFor(orgId, key);
  if (s.snap && s.snap.version >= version) return; // คำตอบมาช้ากว่าการบันทึกที่ใหม่กว่า
  let delta: StoreDelta | null = null;
  if (s.snap && s.snap.version === version - 1) {
    try {
      delta = diffSlice(s.snap.data, data);
    } catch {
      delta = null;
    }
  }
  if (delta) {
    s.log.push({ version, delta });
    if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
  } else {
    s.log = [];
  }
  s.snap = { version, data };
}

/** delta ทั้งหมดจาก known ถึง current ต่อกันครบ · ไม่ครบ = null (ให้ส่งเต็ม) */
export function deltasSince(orgId: string, key: string, known: number, current: number): StoreDelta[] | null {
  if (!DELTA_KEYS.has(key) || known >= current) return null;
  const s = states.get(`${orgId}:${key}`);
  if (!s) return null;
  const from = s.log.findIndex((e) => e.version === known + 1);
  if (from < 0) return null;
  const out: StoreDelta[] = [];
  let expect = known + 1;
  for (let i = from; i < s.log.length && expect <= current; i++, expect++) {
    const entry = s.log[i];
    if (!entry || entry.version !== expect) return null;
    out.push(entry.delta);
  }
  return expect === current + 1 ? out : null;
}

/** ข้อมูลของเวอร์ชันนี้ ถ้ายังจำได้ (ไม่ต้องอ่านก้อนใหญ่จากฐานข้อมูล) */
export function snapshotAt(orgId: string, key: string, version: number): unknown | undefined {
  const s = states.get(`${orgId}:${key}`);
  return s?.snap && s.snap.version === version ? s.snap.data : undefined;
}

/** ล้างคีย์ทิ้ง (รีเซ็ตข้อมูล) — เลขเวอร์ชันเริ่มนับใหม่ ของที่จำไว้ใช้ไม่ได้แล้ว */
export function forgetDeltas(orgId: string, key: string) {
  states.delete(`${orgId}:${key}`);
}
