import { createHash } from 'node:crypto';

/**
 * Field ที่ห้ามปรากฏเป็นค่าจริงใน log หรือ audit before/after
 * spec §16 — "redacted structured logs", "no secrets/PII in logs"
 */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /api[-_]?key/i,
  /device[-_]?key/i,
  /cookie/i,
  /session/i,
  /private[-_]?key/i,
  /\bpin\b/i,

  // ข้อมูลส่วนบุคคลที่มีความอ่อนไหว
  /national[-_]?id/i,
  /citizen[-_]?id/i,
  /tax[-_]?id/i,
  /passport/i,
  /bank[-_]?account/i,
  /account[-_]?number/i,
  /\biban\b/i,

  // ชีวภาพ
  /fp[-_]?template/i,
  /template[-_]?data/i,
  /biometric/i,
  /fingerprint[-_]?image/i,
];

export const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * แทนค่าของ field อ่อนไหวด้วย marker พร้อม hash สั้น ๆ
 *
 * เก็บ hash ไว้เพื่อให้ยังตอบได้ว่า "ค่าเปลี่ยนไปหรือไม่" ในการตรวจสอบ
 * โดยไม่เปิดเผยค่าจริง — ถ้าไม่ต้องการแม้แต่ hash ให้ส่ง `hashSensitive: false`
 */
export interface RedactOptions {
  hashSensitive?: boolean;
  maxDepth?: number;
}

export function redactSensitive(value: unknown, options: RedactOptions = {}): unknown {
  const { hashSensitive = true, maxDepth = 8 } = options;
  return walk(value, false, 0, maxDepth, hashSensitive);
}

function walk(
  value: unknown,
  parentIsSensitive: boolean,
  depth: number,
  maxDepth: number,
  hashSensitive: boolean,
): unknown {
  if (depth > maxDepth) return '[TRUNCATED]';

  if (parentIsSensitive) {
    if (value === null || value === undefined) return value;
    return hashSensitive ? `${REDACTED}:${shortHash(value)}` : REDACTED;
  }

  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, false, depth + 1, maxDepth, hashSensitive));
  }

  if (value instanceof Date) return value.toISOString();

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = walk(item, isSensitiveKey(key), depth + 1, maxDepth, hashSensitive);
  }
  return output;
}

function shortHash(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return createHash('sha256').update(serialized).digest('hex').slice(0, 12);
}

/** ตรวจว่า object ที่จะ log ยังมีค่าอ่อนไหวหลงเหลือหรือไม่ — ใช้ใน test */
export function findSensitiveKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSensitiveKeys(item, `${path}[${index}]`));
  }

  const found: string[] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path === '' ? key : `${path}.${key}`;
    if (isSensitiveKey(key)) {
      const isRedacted = typeof item === 'string' && item.startsWith(REDACTED);
      if (!isRedacted && item !== null && item !== undefined) found.push(nextPath);
    }
    found.push(...findSensitiveKeys(item, nextPath));
  }
  return found;
}
