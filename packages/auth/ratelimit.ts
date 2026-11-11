import Redis from "ioredis";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
    // อย่า retry ถี่จนสแปม log เมื่อ Redis ล่ม (เช่น dev VM หลับ)
    retryStrategy: (times) => Math.min(times * 1000, 10_000),
  });
  // กัน "Unhandled error event" ทำ process ล้ม — แค่ log เงียบ ๆ
  redis.on("error", () => {});
  return redis;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

/**
 * ตัวนับสำรองในหน่วยความจำของโปรเซสนี้ — ใช้เฉพาะตอน Redis ใช้ไม่ได้
 * เดิม Redis ล่ม = ไม่จำกัดเลย (คนยิงสุ่มรหัสได้ไม่อั้นตลอดช่วงที่ล่ม) ตอนนี้ยังจำกัดได้ระดับโปรเซส
 * ไม่ทำให้ระบบล่มตาม Redis เหมือนเดิม: ผู้ใช้ปกติไม่ถึงเพดานอยู่แล้ว
 */
const memoryWindows = new Map<string, { count: number; resetAt: number }>();

function memoryRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  if (memoryWindows.size > 5000) {
    for (const [k, w] of memoryWindows) if (w.resetAt <= now) memoryWindows.delete(k);
  }
  let w = memoryWindows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowSeconds * 1000 };
    memoryWindows.set(key, w);
  }
  w.count += 1;
  return {
    allowed: w.count <= limit,
    remaining: Math.max(0, limit - w.count),
    resetSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
  };
}

/**
 * Fixed-window rate limit บน Redis
 * ถ้า Redis ใช้ไม่ได้ → นับในหน่วยความจำของโปรเซสแทน (memoryRateLimit) ระบบไม่ล่มตาม Redis
 * @param key   identifier เช่น `login:{ip}`
 * @param limit จำนวนครั้งสูงสุดต่อ window
 * @param windowSeconds ขนาด window (วินาที)
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const client = getRedis();
  if (!client) return memoryRateLimit(key, limit, windowSeconds);
  const redisKey = `ratelimit:${key}`;
  try {
    const count = await client.incr(redisKey);
    if (count === 1) {
      await client.expire(redisKey, windowSeconds);
    }
    const ttl = await client.ttl(redisKey);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: ttl >= 0 ? ttl : windowSeconds,
    };
  } catch {
    // Redis ล่ม/timeout → นับในโปรเซสนี้แทน (ล็อกอินยังใช้ได้ และยังจำกัดความถี่อยู่)
    return memoryRateLimit(key, limit, windowSeconds);
  }
}
