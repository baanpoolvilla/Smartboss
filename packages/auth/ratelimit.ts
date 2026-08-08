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
 * Fixed-window rate limit บน Redis
 * ถ้า Redis ใช้ไม่ได้ → **fail-open** (ยอมให้ผ่าน) เพื่อไม่ให้ระบบล่มตาม Redis
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
  if (!client) {
    return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
  }
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
    // Redis ล่ม/timeout → ปล่อยผ่าน (ดีกว่าให้ล็อกอินพังทั้งระบบ)
    return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
  }
}
