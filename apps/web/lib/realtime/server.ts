import "server-only";
import { EventEmitter } from "node:events";
import Redis from "ioredis";

/**
 * ท่อสด (realtime) ฝั่งเซิร์ฟเวอร์ — ส่งเหตุการณ์ถึง "ผู้ใช้" ที่เปิดเว็บค้างอยู่ผ่าน
 * SSE (/api/realtime) แทนการให้ทุกเครื่องถามเซิร์ฟเวอร์ทุก 5 วิ
 *
 * ทำไมใช้ Redis pub/sub: เว็บอาจรันหลายโปรเซส/หลายเครื่องในอนาคต คนส่งกับคนรับ
 * อาจต่ออยู่คนละโปรเซส — Redis เป็นตัวกลางกระจายให้ทุกโปรเซส (มีอยู่แล้วใน
 * deploy/docker-compose.yml, REDIS_URL ใน smartboss.env)
 *
 * ไม่มี REDIS_URL หรือต่อไม่ติด (เครื่อง dev) → ถอยไปใช้ EventEmitter ในโปรเซสเดียว
 * ทำงานได้ครบตราบใดที่รันโปรเซสเดียว (ซึ่งตรงกับ `next start` ปัจจุบัน)
 *
 * ช่องแยกต่อผู้ใช้ (`rt:u:<userId>`) และต่อบริษัท (`rt:o:<orgId>` — ใช้กับห้องรวม
 * ทั้งบริษัท แทนการยิงทีละคนเป็นพันครั้ง) — id เป็น uuid ไม่ซ้ำข้ามบริษัท และทุก
 * publish มาจากโค้ดที่เช็คสิทธิ์ห้อง/บริษัทแล้ว ⇒ เหตุการณ์ไม่ข้ามบริษัท
 */

export interface RealtimeEvent {
  /** เช่น "chat.message", "chat.read", "chat.typing" */
  type: string;
  [key: string]: unknown;
}

type Listener = (event: RealtimeEvent) => void;

const CHANNEL_PREFIX = "rt:";
const userKey = (userId: string) => `u:${userId}`;
const orgKey = (orgId: string) => `o:${orgId}`;
const PRESENCE_PREFIX = "rt:online:";
/** กำลังดูหน้าเว็บอยู่จริง (แท็บอยู่หน้าจอ) — ต่างจากออนไลน์: มือถือที่ย่อเบราว์เซอร์ยังค้างการเชื่อมต่อ
 * ไว้ได้สักพัก แต่ผู้ใช้ไม่เห็นหน้าจอแล้ว ต้องส่งแจ้งเตือนเด้งทันที ไม่ใช่รอให้หลุด */
// เดิม "rt:active:" เป็น string ต่อคน — เปลี่ยนเป็น hash ต่อแท็บ จึงใช้ชื่อใหม่ ไม่ชนค่าเก่าที่ค้างใน Redis
const ACTIVE_PREFIX = "rt:tabs:";
const ACTIVE_TTL_SECONDS = 45;
/** SSE ส่ง heartbeat ทุก 25 วิ แล้วต่ออายุสถานะออนไลน์ — เผื่อพลาดไปหนึ่งรอบ */
const PRESENCE_TTL_SECONDS = 70;

interface Hub {
  local: EventEmitter;
  pub: Redis | null;
  sub: Redis | null;
  /** key ("u:<id>"/"o:<id>") → จำนวน SSE ที่ฟังอยู่ในโปรเซสนี้ (subscribe Redis ครั้งเดียวต่อ key) */
  refCount: Map<string, number>;
  /** สถานะออนไลน์ตอนไม่มี Redis: userId → หมดอายุเมื่อไร (ms) */
  presence: Map<string, number>;
  /** สถานะ "กำลังดูหน้าจอ" ตอนไม่มี Redis: userId → tabId → { หมดอายุ (ms), endpoint Web Push ของเครื่อง } */
  active: Map<string, Map<string, { until: number; endpoint: string }>>;
}

// เก็บบน globalThis — Next dev โหลดโมดูลซ้ำตอนแก้ไฟล์ ไม่งั้นจะเปิดคอนเนกชัน Redis เพิ่มทุกครั้ง
const g = globalThis as unknown as { __smartbossRealtime?: Hub };

function redisDisabled(client: Redis | null, hub: Hub) {
  // ต่อไม่ติดตั้งแต่แรก/หลุดถาวร → ถอยไปโหมดโปรเซสเดียว ไม่ให้ทั้งแชทล่มเพราะ Redis
  if (!client) return;
  client.disconnect();
  hub.pub = null;
  hub.sub = null;
}

function hub(): Hub {
  if (g.__smartbossRealtime) return g.__smartbossRealtime;
  const h: Hub = { local: new EventEmitter(), pub: null, sub: null, refCount: new Map(), presence: new Map(), active: new Map() };
  h.local.setMaxListeners(0);

  const url = process.env.REDIS_URL;
  if (url) {
    const opts = { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false } as const;
    h.pub = new Redis(url, opts);
    h.sub = new Redis(url, opts);
    let failures = 0;
    const onError = (err: Error) => {
      failures++;
      // ครั้งแรก ๆ ให้ ioredis ลองต่อใหม่เอง — พลาดติดกันหลายครั้งค่อยเลิกใช้
      if (failures === 1) console.warn("[realtime] redis error:", err.message);
      if (failures >= 5 && h.pub) {
        console.warn("[realtime] redis unavailable — falling back to in-process events");
        redisDisabled(h.pub, h);
        redisDisabled(h.sub, h);
      }
    };
    h.pub.on("error", onError);
    h.sub.on("error", onError);
    h.pub.on("ready", () => (failures = 0));
    // ต่อ Redis ติด (ครั้งแรก/ต่อใหม่หลังหลุด) → subscribe ทุกช่องที่มีคนฟังอยู่ในโปรเซสนี้
    // เดิม subscribe ครั้งเดียวตอนคนแรกเข้ามา ถ้าตอนนั้น Redis ยังไม่พร้อม (เช่น เพิ่งรีสตาร์ตหลัง
    // deploy แล้วทุกเครื่องต่อกลับพร้อมกัน) คำสั่งถูกปฏิเสธเงียบ ๆ (enableOfflineQueue: false)
    // ช่องนั้นไม่ได้ subscribe อีกเลยจนรีสตาร์ต ⇒ ข้อความสดไม่มา ต้องรีเฟรชเอง
    h.sub.on("ready", () => {
      failures = 0;
      const channels = [...h.refCount.keys()].map((k) => CHANNEL_PREFIX + k);
      if (channels.length > 0) h.sub?.subscribe(...channels).catch((err: Error) => console.warn("[realtime] resubscribe failed:", err.message));
    });
    h.sub.on("message", (channel: string, raw: string) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      try {
        h.local.emit(channel, JSON.parse(raw));
      } catch {
        // payload เสีย — ข้าม
      }
    });
  }

  g.__smartbossRealtime = h;
  return h;
}

function publishKey(key: string, event: RealtimeEvent, payload: string) {
  const h = hub();
  const channel = CHANNEL_PREFIX + key;
  // ส่งผ่าน Redis ต่อเมื่อฝั่งรับ (sub) พร้อมด้วย — pub พร้อมแต่ sub ยังต่อไม่ติด ข้อความจะไปถึง
  // Redis แต่ไม่มีใครในโปรเซสนี้ได้รับ (ตอนนี้รันโปรเซสเดียว ส่งในโปรเซสตรง ๆ ถึงครบ)
  if (h.pub && h.pub.status === "ready" && h.sub && h.sub.status === "ready") {
    h.pub.publish(channel, payload).catch(() => h.local.emit(channel, event));
  } else {
    h.local.emit(channel, event);
  }
}

/** ส่งเหตุการณ์ถึงผู้ใช้หลายคน (ทุกแท็บ/ทุกเครื่องที่เปิดอยู่) — ไม่ throw เด็ดขาด
 * การส่งสดพลาดต้องไม่ทำให้การบันทึกข้อความพลาดตาม (เครื่องรับจะดึงย้อนหลังเองตอนต่อใหม่) */
export function publishToUsers(userIds: Iterable<string>, event: RealtimeEvent): void {
  const payload = JSON.stringify(event);
  for (const userId of new Set(userIds)) publishKey(userKey(userId), event, payload);
}

/** ส่งเหตุการณ์ถึงทุกคนในบริษัทที่เปิดเว็บอยู่ (ห้องรวมทั้งบริษัท) */
export function publishToOrg(orgId: string, event: RealtimeEvent): void {
  publishKey(orgKey(orgId), event, JSON.stringify(event));
}

function listen(key: string, listener: Listener): () => void {
  const h = hub();
  const channel = CHANNEL_PREFIX + key;
  h.local.on(channel, listener);
  const count = (h.refCount.get(key) ?? 0) + 1;
  h.refCount.set(key, count);
  // ยังไม่พร้อม = ไม่ต้องสั่งตอนนี้ ตัวฟัง "ready" ด้านบน subscribe ให้ทุกช่องตอนต่อติด
  if (count === 1 && h.sub && h.sub.status === "ready") {
    h.sub.subscribe(channel).catch((err: Error) => console.warn("[realtime] subscribe failed:", channel, err.message));
  }
  return () => {
    h.local.off(channel, listener);
    const left = (h.refCount.get(key) ?? 1) - 1;
    if (left <= 0) {
      h.refCount.delete(key);
      if (h.sub) h.sub.unsubscribe(channel).catch(() => {});
    } else {
      h.refCount.set(key, left);
    }
  };
}

/** ฟังเหตุการณ์ของผู้ใช้คนนี้ + ของบริษัทเขา (ใช้ใน SSE route) — คืนฟังก์ชันเลิกฟัง */
export function subscribeUser(userId: string, orgId: string, listener: Listener): () => void {
  const offUser = listen(userKey(userId), listener);
  const offOrg = listen(orgKey(orgId), listener);
  return () => {
    offUser();
    offOrg();
  };
}

/** ต่ออายุ "ออนไลน์" — SSE เรียกตอนต่อ และทุกครั้งที่ส่ง heartbeat */
export function touchPresence(userId: string): void {
  const h = hub();
  if (h.pub && h.pub.status === "ready") {
    h.pub.set(PRESENCE_PREFIX + userId, "1", "EX", PRESENCE_TTL_SECONDS).catch(() => {});
  }
  h.presence.set(userId, Date.now() + PRESENCE_TTL_SECONDS * 1000);
}

/** ปิดแท็บสุดท้ายของคนนี้ในโปรเซสนี้ — ถ้ายังเปิดที่อื่นอยู่ heartbeat ที่นั่นจะต่ออายุกลับเอง */
export function clearPresenceIfIdle(userId: string): void {
  const h = hub();
  if ((h.refCount.get(userKey(userId)) ?? 0) > 0) return;
  h.presence.delete(userId);
  h.active.delete(userId);
  if (h.pub && h.pub.status === "ready") h.pub.del(PRESENCE_PREFIX + userId, ACTIVE_PREFIX + userId).catch(() => {});
}

/** ใครในรายชื่อนี้ออนไลน์อยู่บ้าง (จุดเขียว) */
export async function onlineUserIds(userIds: string[]): Promise<Set<string>> {
  const h = hub();
  const found = new Set<string>();
  if (userIds.length === 0) return found;
  if (h.pub && h.pub.status === "ready") {
    try {
      const values = await h.pub.mget(userIds.map((id) => PRESENCE_PREFIX + id));
      values.forEach((v, i) => {
        if (v) found.add(userIds[i]!);
      });
      return found;
    } catch {
      // ตกไปใช้ค่าในโปรเซสด้านล่าง
    }
  }
  const now = Date.now();
  for (const id of userIds) {
    const until = h.presence.get(id);
    if (until && until > now) found.add(id);
  }
  return found;
}

/**
 * แท็บที่กำลังอยู่หน้าจอของแต่ละคน → endpoint Web Push ของเครื่องนั้น ("" = เครื่องที่ไม่ได้เปิดแจ้งเตือน)
 * เก็บแยก "ต่อแท็บ" ใน hash เดียวต่อคน (rt:active:<userId>, field = tabId, ค่า = "<หมดอายุ ms>|<endpoint>")
 * ⇒ ย่อแอปในมือถือไม่ไปล้างสถานะของคอมที่ยังเปิดดูอยู่ และรู้ว่า "เครื่องไหน" ดูจออยู่
 */
async function viewingTabs(userIds: string[]): Promise<Map<string, string[]>> {
  const h = hub();
  const now = Date.now();
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  if (h.pub && h.pub.status === "ready") {
    try {
      const pipe = h.pub.pipeline();
      for (const id of userIds) pipe.hgetall(ACTIVE_PREFIX + id);
      const results = (await pipe.exec()) ?? [];
      results.forEach(([err, value], i) => {
        if (err || !value) return;
        const endpoints: string[] = [];
        for (const raw of Object.values(value as Record<string, string>)) {
          const sep = raw.indexOf("|");
          if (Number(raw.slice(0, sep)) > now) endpoints.push(raw.slice(sep + 1));
        }
        if (endpoints.length > 0) out.set(userIds[i]!, endpoints);
      });
      return out;
    } catch {
      // ตกไปใช้ค่าในโปรเซสด้านล่าง
    }
  }
  for (const id of userIds) {
    const endpoints = [...(h.active.get(id)?.values() ?? [])].filter((t) => t.until > now).map((t) => t.endpoint);
    if (endpoints.length > 0) out.set(id, endpoints);
  }
  return out;
}

/** ใครกำลังดูหน้าเว็บอยู่ (เครื่องไหนก็ได้) — ใช้กับแชทกลุ่มทั่วไป: ดูที่คอมอยู่แล้ว มือถือไม่ต้องเด้ง */
export async function activeUserIds(userIds: string[]): Promise<Set<string>> {
  return new Set((await viewingTabs(userIds)).keys());
}

/** endpoint Web Push ของ "เครื่องที่กำลังดูหน้าจออยู่" — เครื่องพวกนี้เด้งในแอปเองแล้ว ไม่ต้องส่ง Push ซ้ำ */
export async function viewingEndpoints(userIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const endpoints of (await viewingTabs(userIds)).values()) {
    for (const e of endpoints) if (e) found.add(e);
  }
  return found;
}

/** แท็บบอกว่าอยู่หน้าจอ (true, ส่งซ้ำทุก ~30 วิ) หรือถูกย่อ/สลับแอป (false) — ต่อแท็บ ไม่กระทบแท็บ/เครื่องอื่น */
export function setTabActive(userId: string, tabId: string, endpoint: string, active: boolean): void {
  const h = hub();
  const ready = h.pub && h.pub.status === "ready";
  const key = ACTIVE_PREFIX + userId;
  let tabs = h.active.get(userId);
  if (active) {
    const until = Date.now() + ACTIVE_TTL_SECONDS * 1000;
    if (!tabs) h.active.set(userId, (tabs = new Map()));
    tabs.set(tabId, { until, endpoint });
    if (ready) {
      h.pub!
        .multi()
        .hset(key, tabId, `${until}|${endpoint}`)
        .expire(key, ACTIVE_TTL_SECONDS)
        .exec()
        .catch(() => {});
    }
  } else {
    tabs?.delete(tabId);
    if (tabs?.size === 0) h.active.delete(userId);
    if (ready) h.pub!.hdel(key, tabId).catch(() => {});
  }
}
