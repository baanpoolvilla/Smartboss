import { config as loadDotenv } from 'dotenv';
import { configSchema, type RawConfig } from './schema';

export { configSchema, type RawConfig } from './schema';

export interface AppConfig extends RawConfig {
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly corsAllowedOrigins: readonly string[];
}

export class ConfigurationError extends Error {
  readonly issues: readonly { path: string; message: string }[];

  constructor(issues: readonly { path: string; message: string }[]) {
    const lines = issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n');
    super(`invalid configuration:\n${lines}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

/**
 * โหลดและตรวจ config
 *
 * ไม่มี fallback สำหรับ secret ใด ๆ — ถ้า env ไม่ครบ ต้อง throw
 * ระบบเดิมมี `DB_PASS || '123456'` ซึ่งทำให้ deploy ที่ลืมตั้ง env ยังรันได้
 * ด้วยรหัสที่รู้กันทั้งอินเทอร์เน็ต (spec §3.3 C1, §21)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }

  const value = parsed.data;
  return Object.freeze({
    ...value,
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test',
    corsAllowedOrigins: value.CORS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  });
}

/** โหลด .env สำหรับ local dev — production ตั้ง env จาก secrets manager ไม่ใช่จากไฟล์ */
export function loadDotenvFile(path?: string): void {
  if (process.env.NODE_ENV === 'production') return;
  loadDotenv(path === undefined ? {} : { path });
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached === undefined) cached = loadConfig();
  return cached;
}

/** ใช้ใน test เท่านั้น */
export function resetConfigCache(): void {
  cached = undefined;
}
