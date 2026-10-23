"use client";

import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";

import { subscribeRealtime } from "@/lib/realtime-client";
import { NOTE_LIMITS } from "@/modules/report_task/lib/notes/types";

/*
 * ตัวเชื่อมเอกสารของหน้าโน้ตกับเซิร์ฟเวอร์ (แทน websocket provider) — ใช้ท่อสด SSE ที่เว็บมีอยู่แล้ว
 *   ขาออก: ชุดแก้ของเรา → รวมทุก 400 มิลลิวินาที → POST (ส่งไม่ได้เก็บไว้ ส่งใหม่เรื่อย ๆ จนกว่าจะได้)
 *   ขาเข้า: "note.update" จากท่อสด → ใส่ในเอกสาร (ของตัวเองข้าม) · ต่อท่อใหม่/กลับมาที่แท็บ → ซิงก์เทียบ state vector
 *   เคอร์เซอร์คนอื่น: y-protocols awareness ผ่าน /presence (ไม่เก็บลงฐานข้อมูล)
 * ส่งซ้ำ/มาไม่ตามลำดับไม่เป็นไร — Yjs ใส่ชุดเดิมซ้ำได้ผลเท่าเดิม
 */

export type NoteSyncStatus = "saved" | "saving" | "offline" | "error";

const b64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const REMOTE = Symbol("remote");
const COLORS = ["#2563eb", "#db2777", "#ea580c", "#16a34a", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];
export const colorFor = (id: string) => COLORS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length]!;

export class NoteProvider {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  readonly clientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  status: NoteSyncStatus = "saved";
  error = "";
  private pending: Uint8Array[] = [];
  /** ชุดที่กำลังส่ง (ยังไม่รู้ผล) — ปิดหน้าตอนนี้ต้องเก็บลงเครื่องด้วย */
  private sending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2000;
  private inFlight = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;
  private listeners = new Set<() => void>();
  private destroyed = false;

  constructor(
    readonly pageId: string,
    readonly topicId: string,
    initialState: string,
    user: { id: string; name: string },
  ) {
    if (initialState) Y.applyUpdate(this.doc, unb64(initialState), REMOTE);
    this.awareness = new Awareness(this.doc);
    // ชุดแก้ที่ค้างจากครั้งก่อน (ออฟไลน์แล้วปิดหน้า) — ใส่กลับเข้าเอกสารแล้วส่งต่อ
    const leftover = readOffline(pageId);
    this.awareness.setLocalStateField("user", { name: user.name, color: colorFor(user.id), cid: this.clientId });

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      this.pending.push(update);
      this.setStatus("saving");
      this.scheduleFlush(400);
    });
    if (leftover) Y.applyUpdate(this.doc, leftover, "offline-restore");
    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === REMOTE) return;
      if (![...added, ...updated, ...removed].includes(this.doc.clientID)) return;
      if (this.awarenessTimer) return;
      this.awarenessTimer = setTimeout(() => {
        this.awarenessTimer = null;
        void this.sendPresence(true);
      }, 250);
    });

    this.unsubscribe = subscribeRealtime((event) => {
      if (event.type === "realtime.reconnected") {
        void this.sync();
        void this.flush();
        return;
      }
      if ((event as { pageId?: string }).pageId !== this.pageId) return;
      const e = event as unknown as { type: string; clientId: string; update?: string; awareness?: string | null };
      if (e.clientId === this.clientId) return;
      if (e.type === "note.update" && e.update) Y.applyUpdate(this.doc, unb64(e.update), REMOTE);
      else if (e.type === "note.presence" && e.awareness) applyAwarenessUpdate(this.awareness, unb64(e.awareness), REMOTE);
      else if (e.type === "note.leave") this.removeClient(e.clientId);
    });

    void this.sendPresence(false).then(() => this.sync());
    this.heartbeat = setInterval(() => void this.sendPresence(false), 20_000);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      document.addEventListener("visibilitychange", this.onVisible);
      window.addEventListener("beforeunload", this.onUnload);
    }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  hasUnsaved(): boolean {
    return this.pending.length > 0 || this.inFlight;
  }
  private unsent(): Uint8Array | null {
    const all = [...this.sending, ...this.pending];
    return all.length ? Y.mergeUpdates(all) : null;
  }

  private setStatus(s: NoteSyncStatus, error = "") {
    this.status = s;
    this.error = error;
    for (const fn of this.listeners) fn();
  }

  private scheduleFlush(ms: number) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), ms);
  }

  private onOnline = () => {
    void this.sync();
    void this.flush();
  };
  private onVisible = () => {
    if (document.visibilityState === "visible") {
      void this.sync();
      void this.flush();
    }
  };
  /** ปิดแท็บตอนยังส่งไม่หมด — ส่งแบบ keepalive และให้เบราว์เซอร์ถามยืนยัน */
  private onUnload = (e: BeforeUnloadEvent) => {
    const update = this.unsent();
    if (!update) return;
    saveOffline(this.pageId, update);
    if (update.length < 60_000) {
      void fetch(`/api/report-task/notes/${this.pageId}`, { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "update", update: b64(update), clientId: this.clientId }) });
    }
    e.preventDefault();
  };

  /** ส่งชุดแก้ที่ค้าง — แบ่งเป็นก้อนไม่เกินขีด (วางข้อความยาว ๆ ทีเดียวไม่ตกทั้งก้อน) */
  async flush(): Promise<void> {
    if (this.inFlight || this.pending.length === 0 || this.destroyed) return;
    this.inFlight = true;
    const batch = this.pending.splice(0, this.pending.length);
    this.sending = batch;
    const chunks: Uint8Array[][] = [[]];
    let size = 0;
    for (const u of batch) {
      if (size + u.length > NOTE_LIMITS.updateBytes * 0.9 && chunks[chunks.length - 1]!.length > 0) {
        chunks.push([]);
        size = 0;
      }
      chunks[chunks.length - 1]!.push(u);
      size += u.length;
    }
    // ก้อนที่เซิร์ฟเวอร์รับแล้ว — ที่เหลือ (รวมก้อนที่ส่งไม่ถึงเพราะเน็ตหลุด/fetch โยน error) ต้องกลับเข้าคิวเสมอ
    let sent = 0;
    let failed = false;
    try {
      for (; sent < chunks.length; sent++) {
        const update = Y.mergeUpdates(chunks[sent]!);
        const res = await fetch(`/api/report-task/notes/${this.pageId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "update", update: b64(update), clientId: this.clientId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.status === 413 || res.status === 409 || res.status === 403 || res.status === 404) {
            // แก้ไม่ได้ด้วยการลองใหม่ — บอกผู้ใช้ (ข้อมูลยังอยู่ในเครื่อง ไม่หาย)
            this.pending.unshift(...chunks.slice(sent).flat());
            saveOffline(this.pageId, Y.mergeUpdates(this.pending));
            this.setStatus("error", body.error ?? "บันทึกไม่ได้");
            return;
          }
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
      }
      this.retryDelay = 2000;
      if (this.pending.length === 0) clearOffline(this.pageId);
      this.setStatus(this.pending.length ? "saving" : "saved");
    } catch {
      failed = true;
      this.pending.unshift(...chunks.slice(sent).flat());
      // เก็บไว้ในเครื่องด้วย — เผื่อปิดหน้า/แอปไปก่อนเน็ตกลับมา
      if (this.pending.length > 0) saveOffline(this.pageId, Y.mergeUpdates(this.pending));
      this.setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saving");
      this.scheduleFlush(this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    } finally {
      this.inFlight = false;
      this.sending = [];
      // ล้มเหลว = รอตามช่วงถอยหลังที่ตั้งไว้แล้ว (ไม่ยิงถี่ตอนเน็ตหลุด) · สำเร็จแต่มีชุดใหม่ระหว่างส่ง = ส่งต่อเลย
      if (!failed && this.pending.length > 0 && this.status !== "error") this.scheduleFlush(400);
    }
  }

  /** ขอส่วนที่เครื่องยังไม่มีจากเซิร์ฟเวอร์ (กันพลาดชุดแก้ระหว่างโหลด/เน็ตหลุด) */
  async sync(): Promise<void> {
    if (this.destroyed) return;
    try {
      const res = await fetch(`/api/report-task/notes/${this.pageId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "sync", stateVector: b64(Y.encodeStateVector(this.doc)) }),
      });
      if (!res.ok) return;
      const { update } = (await res.json()) as { update: string };
      if (update) Y.applyUpdate(this.doc, unb64(update), REMOTE);
    } catch {
      // เน็ตหลุด — รอบหน้าค่อยซิงก์
    }
  }

  private async sendPresence(withAwareness: boolean) {
    if (this.destroyed) return;
    try {
      const res = await fetch("/api/report-task/notes/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topicId: this.topicId,
          pageId: this.pageId,
          clientId: this.clientId,
          awareness: withAwareness ? b64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) : null,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { awareness: { clientId: string; data: string }[] };
      for (const a of data.awareness ?? []) applyAwarenessUpdate(this.awareness, unb64(a.data), REMOTE);
    } catch {
      // ไม่ได้ส่ง — รอบหัวใจถัดไปลองใหม่
    }
  }

  private removeClient(cid: string) {
    const ids: number[] = [];
    this.awareness.getStates().forEach((state, id) => {
      if ((state as { user?: { cid?: string } }).user?.cid === cid) ids.push(id);
    });
    if (ids.length) removeAwarenessStates(this.awareness, ids, REMOTE);
  }

  destroy() {
    if (this.destroyed) return;
    const left = this.unsent();
    if (left) saveOffline(this.pageId, left);
    void this.flush();
    this.destroyed = true;
    this.unsubscribe();
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      document.removeEventListener("visibilitychange", this.onVisible);
      window.removeEventListener("beforeunload", this.onUnload);
    }
    void fetch("/api/report-task/notes/presence", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topicId: this.topicId, pageId: this.pageId, clientId: this.clientId, leave: true }),
    }).catch(() => undefined);
    this.awareness.destroy();
  }
}

/* ชุดแก้ที่ยังส่งไม่ได้ เก็บในเครื่อง (ต่อหน้า) — กันหายตอนออฟไลน์แล้วปิดหน้า · เกิน ~3 MB ไม่เก็บ (เต็มพื้นที่เบราว์เซอร์) */
const offlineKey = (pageId: string) => `note-pending:${pageId}`;
function saveOffline(pageId: string, update: Uint8Array) {
  try {
    if (update.length > 3_000_000) return;
    localStorage.setItem(offlineKey(pageId), b64(update));
  } catch {
    // โหมดส่วนตัว/พื้นที่เต็ม — ยังมีชุดในหน่วยความจำ
  }
}
function readOffline(pageId: string): Uint8Array | null {
  try {
    const v = localStorage.getItem(offlineKey(pageId));
    if (!v) return null;
    localStorage.removeItem(offlineKey(pageId));
    return unb64(v);
  } catch {
    return null;
  }
}
function clearOffline(pageId: string) {
  try {
    localStorage.removeItem(offlineKey(pageId));
  } catch {
    // ไม่เป็นไร
  }
}

export { b64 as noteB64, unb64 as noteUnb64 };
