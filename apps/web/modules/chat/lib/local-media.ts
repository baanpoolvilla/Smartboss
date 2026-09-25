"use client";

/**
 * ไฟล์ส่วนตัวของผู้ใช้ (เสียงแจ้งเตือน/รูปพื้นหลังแชท) — เก็บใน IndexedDB ของเบราว์เซอร์เครื่องนี้
 * ไม่อัปขึ้นเซิร์ฟเวอร์: คนอื่นไม่เห็น ไม่กินพื้นที่ของบริษัท (แลกกับต้องตั้งทีละเครื่อง)
 */

const DB = "smartboss-chat-media";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export type LocalMediaKey = "sound" | "background";

export function saveLocalMedia(key: LocalMediaKey, blob: Blob): Promise<unknown> {
  return run("readwrite", (s) => s.put(blob, key));
}

export async function loadLocalMedia(key: LocalMediaKey): Promise<Blob | null> {
  try {
    return ((await run("readonly", (s) => s.get(key))) as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}

export function deleteLocalMedia(key: LocalMediaKey): Promise<unknown> {
  return run("readwrite", (s) => s.delete(key)).catch(() => undefined);
}
