/**
 * ส่ง/รับ "เฉพาะส่วนที่เปลี่ยน" ของ store ก้อนใหญ่ (ใช้กับฟีดรายงาน) — ใช้ร่วมกันทั้งเบราว์เซอร์และเซิร์ฟเวอร์
 *
 * ผู้ใช้ 8/11/2569: ฟีดรายงานหลาย MB เดิมใครโพสต์ 1 โพสต์ เครื่องนั้นส่งขึ้นทั้งก้อน และทุกเครื่องที่เปิดค้างไว้
 * ดึงลงทั้งก้อน (prod p90 8 วิ สูงสุด 47 วิ CPU เซิร์ฟเวอร์เต็มจนโมดูลอื่นหน่วง)
 *
 * แบบเดียวกับที่ Linear / Slack ทำ: ข้อมูลมีเลขเวอร์ชันเรียงกัน เครื่องบอกเลขที่ถืออยู่ แล้วได้เฉพาะรายการที่
 * เปลี่ยนหลังเลขนั้น · เลขขาดช่วง/คำนวณไม่ได้ = โหลดเต็มแบบเดิม (ไม่มีทางได้ข้อมูลผิด แค่ช้าเท่าเดิม)
 *
 * รูปของ delta (เฉพาะ slice ที่เป็น object):
 *   arrays[k] — ช่องที่เป็นอาร์เรย์ของ { id } : รายการที่เพิ่ม/แก้ (upsert) · id ที่ลบ (remove) · ลำดับใหม่ถ้าเปลี่ยน (order)
 *   set[k]    — ช่องอื่นที่เปลี่ยน ส่งค่าใหม่ทั้งช่อง
 *   unset     — ช่องที่หายไป
 */

export type ArrayPatch = { upsert: unknown[]; remove: string[]; order?: string[] };
export type StoreDelta = { arrays: Record<string, ArrayPatch>; set: Record<string, unknown>; unset: string[] };

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** เทียบค่าแบบลึก ไม่สนลำดับคีย์ (ข้อมูลจาก Postgres jsonb เรียงคีย์ต่างจากที่เบราว์เซอร์ส่งมา) */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Obj;
  const bo = b as Obj;
  // undefined = ไม่มีช่องนั้น (JSON / jsonb ทิ้งช่อง undefined อยู่แล้ว)
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

function idOf(v: unknown): string | null {
  return isPlainObject(v) && typeof v.id === "string" ? v.id : null;
}

/** อาร์เรย์ของ object ที่มี id ไม่ซ้ำกันทุกตัว (ว่างก็นับ) */
function isIdArray(v: unknown): v is Obj[] {
  if (!Array.isArray(v)) return false;
  const seen = new Set<string>();
  for (const item of v) {
    const id = idOf(item);
    if (id === null || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function applyArray(cur: unknown, patch: ArrayPatch): Obj[] {
  if (!isIdArray(cur)) throw new Error("delta: not an id array");
  const removed = new Set(patch.remove);
  const up = new Map<string, unknown>();
  for (const item of patch.upsert) {
    const id = idOf(item);
    if (id === null) throw new Error("delta: upsert without id");
    up.set(id, item);
  }
  const present = new Set<string>();
  const out: Obj[] = [];
  for (const item of cur) {
    const id = item.id as string;
    if (removed.has(id)) continue;
    present.add(id);
    out.push((up.get(id) as Obj | undefined) ?? item);
  }
  for (const [id, item] of up) if (!present.has(id) && !removed.has(id)) out.push(item as Obj);
  if (!patch.order) return out;
  const rank = new Map(patch.order.map((id, i) => [id, i]));
  return out
    .map((item, i) => ({ item, i }))
    .sort((x, y) => (rank.get(x.item.id as string) ?? patch.order!.length + x.i) - (rank.get(y.item.id as string) ?? patch.order!.length + y.i))
    .map((x) => x.item);
}

function diffArray(base: Obj[], next: Obj[]): ArrayPatch | null {
  const byId = new Map(base.map((item) => [item.id as string, item]));
  const nextIds = new Set<string>();
  const upsert: unknown[] = [];
  for (const item of next) {
    const id = item.id as string;
    nextIds.add(id);
    const old = byId.get(id);
    if (old === undefined || (old !== item && !deepEqual(old, item))) upsert.push(item);
  }
  const remove = base.map((item) => item.id as string).filter((id) => !nextIds.has(id));
  const patch: ArrayPatch = { upsert, remove };
  const simulated = applyArray(base, patch);
  if (simulated.length !== next.length || simulated.some((item, i) => item.id !== next[i]?.id)) {
    patch.order = next.map((item) => item.id as string);
  }
  if (upsert.length === 0 && remove.length === 0 && !patch.order) return null;
  return patch;
}

/** ส่วนที่เปลี่ยนจาก base ไป next · null = คำนวณไม่ได้ (ไม่ใช่ object) ให้ส่งทั้งก้อน */
export function diffSlice(base: unknown, next: unknown): StoreDelta | null {
  if (!isPlainObject(base) || !isPlainObject(next)) return null;
  const delta: StoreDelta = { arrays: {}, set: {}, unset: [] };
  for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const b = base[k];
    const n = next[k];
    if (b === n) continue;
    if (n === undefined) {
      delta.unset.push(k);
      continue;
    }
    if (isIdArray(b) && isIdArray(n)) {
      const patch = diffArray(b, n);
      if (patch) delta.arrays[k] = patch;
      continue;
    }
    if (!deepEqual(b, n)) delta.set[k] = n;
  }
  return delta;
}

export function isEmptyDelta(d: StoreDelta): boolean {
  return Object.keys(d.arrays).length === 0 && Object.keys(d.set).length === 0 && d.unset.length === 0;
}

/** ใส่ delta ลงบน base (ต้องเป็นเวอร์ชันเดียวกับที่ใช้คำนวณ) · รูปไม่ตรง = throw ให้ผู้เรียกโหลด/ส่งเต็มแทน */
export function applyDelta<S>(base: S, delta: StoreDelta): S {
  if (!isPlainObject(base) || !isPlainObject(delta) || !isPlainObject(delta.arrays) || !isPlainObject(delta.set) || !Array.isArray(delta.unset)) {
    throw new Error("delta: bad shape");
  }
  const out: Obj = { ...base, ...delta.set };
  for (const k of delta.unset) delete out[k];
  for (const [k, patch] of Object.entries(delta.arrays)) {
    if (!patch || !Array.isArray(patch.upsert) || !Array.isArray(patch.remove)) throw new Error("delta: bad patch");
    out[k] = applyArray(base[k], patch);
  }
  return out as S;
}
