import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SERVICE_NAME: nonEmpty.default('workforce-api'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    HTTP_HOST: nonEmpty.default('0.0.0.0'),
    HTTP_PORT: port.default(3100),
    HTTP_BODY_LIMIT_BYTES: positiveInt.default(1_048_576),
    /** origin ที่อนุญาต คั่นด้วย comma — ไม่มีค่า default เป็น "*" โดยเจตนา */
    CORS_ALLOWED_ORIGINS: z.string().default(''),

    // ---- Database ----
    // ไม่มี fallback ใด ๆ ทั้งสิ้น: ระบบเดิมมี password fallback '123456' ใน source (spec §3.3 C1)
    DATABASE_URL: nonEmpty,
    DATABASE_POOL_MAX: positiveInt.default(10),
    DATABASE_STATEMENT_TIMEOUT_MS: positiveInt.default(15_000),
    DATABASE_SSL: booleanish.default(false),

    // ---- Authentication ----
    // smartboss = ใช้ access token ที่ Smartboss ออก (HS256 shared secret, claim tenant = orgId)
    //             ต่างจาก local ตรงที่อนุญาตให้ใช้ใน production ได้ เพราะ secret มาจาก
    //             ระบบ auth จริง ไม่ใช่ค่า dev ที่ hardcode ไว้
    AUTH_PROVIDER: z.enum(['oidc', 'local', 'smartboss']).default('oidc'),
    // issuer ของ Smartboss เป็นสตริงธรรมดา ("smartboss") ไม่ใช่ URL จึงไม่บังคับ .url()
    AUTH_ISSUER: z.string().min(1).optional(),
    AUTH_AUDIENCE: z.string().optional(),
    AUTH_JWKS_URI: z.string().url().optional(),
    /** ใช้เฉพาะ AUTH_PROVIDER=local (dev/test) — เซ็น/ตรวจ token ด้วย HMAC */
    AUTH_LOCAL_SIGNING_SECRET: z.string().min(32).optional(),
    /** ใช้เฉพาะ AUTH_PROVIDER=smartboss — ต้องเป็นค่าเดียวกับ JWT_SECRET ของ Smartboss */
    AUTH_SMARTBOSS_SECRET: z.string().min(32).optional(),
    /** claim ที่บอก tenant ใน token ของ Smartboss */
    AUTH_TENANT_CLAIM: z.string().min(1).default('orgId'),
    AUTH_CLOCK_TOLERANCE_SECONDS: positiveInt.default(30),
    STEP_UP_MAX_AGE_SECONDS: positiveInt.default(900),

    // ---- Field encryption ----
    // AES-256-GCM key (base64, 32 bytes) สำหรับเลขบัตรประชาชน/เลขผู้เสียภาษี/บัญชีธนาคาร
    // production ต้องมาจาก secrets manager ไม่ใช่ไฟล์ .env
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, {
        message: 'FIELD_ENCRYPTION_KEY must be 32 bytes encoded as base64',
      })
      .optional(),

    // ---- Object storage (ADR-0010) ----
    STORAGE_DRIVER: z.enum(['s3', 'filesystem']).default('filesystem'),
    STORAGE_BUCKET: z.string().optional(),
    STORAGE_REGION: z.string().optional(),
    STORAGE_ENDPOINT: z.string().url().optional(),
    STORAGE_ACCESS_KEY_ID: z.string().optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
    STORAGE_FORCE_PATH_STYLE: booleanish.default(false),
    STORAGE_FILESYSTEM_ROOT: z.string().optional(),
    STORAGE_SIGNED_URL_TTL_SECONDS: positiveInt.max(900).default(300),

    // ---- Device ingestion (spec §6.2) ----
    // หน้าต่างที่ยอมรับลายเซ็นของ request — สั้นเพื่อจำกัดการ replay
    // ไม่เกี่ยวกับอายุของ event: เครื่องที่ offline 30 วันยังส่ง event เก่าได้
    DEVICE_REQUEST_TIMESTAMP_TOLERANCE_SECONDS: positiveInt.default(300),
    // เกินเท่านี้ถือว่านาฬิกาเครื่องเพี้ยน → บันทึกเป็น anomaly แต่ไม่แก้ captured_at
    DEVICE_CLOCK_DRIFT_TOLERANCE_MS: positiveInt.default(120_000),
    // event ที่เก่ากว่านี้เข้า exception OFFLINE_EVENT_TOO_OLD (spec §7.3)
    OFFLINE_EVENT_MAX_AGE_MINUTES: positiveInt.default(43_200),
    // adapter สำหรับ firmware เดิมระหว่าง parallel run — ไม่ตั้ง = ปิดใช้งาน (spec §13)
    LEGACY_INGEST_KEY: z.string().min(32).optional(),

    // ---- Behaviour ----
    DEFAULT_TIME_ZONE: nonEmpty.default('Asia/Bangkok'),
    DEFAULT_CURRENCY: nonEmpty.default('THB'),
    IDEMPOTENCY_RETENTION_DAYS: positiveInt.default(7),
    OUTBOX_MAX_ATTEMPTS: positiveInt.default(10),
    OUTBOX_BATCH_SIZE: positiveInt.default(50),
    /** ระยะพักของ worker เมื่อ outbox ว่าง — ถี่เกินไปคือ query เปล่าทิ้ง */
    OUTBOX_POLL_INTERVAL_MS: positiveInt.default(2000),
  })
  .superRefine((config, ctx) => {
    const isProduction = config.NODE_ENV === 'production';

    if (config.AUTH_PROVIDER === 'oidc') {
      for (const key of ['AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_JWKS_URI'] as const) {
        if (!config[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when AUTH_PROVIDER=oidc`,
          });
        }
      }
      // JWKS_URI ต้องเป็น URL จริง — เช็คตรงนี้เพราะ schema ด้านบนผ่อนให้ AUTH_ISSUER
      // เป็นสตริงธรรมดาได้แล้ว (เพื่อรองรับ issuer "smartboss")
      if (config.AUTH_ISSUER !== undefined && !/^https?:\/\//.test(config.AUTH_ISSUER)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_ISSUER'],
          message: 'AUTH_ISSUER must be a URL when AUTH_PROVIDER=oidc',
        });
      }
    }

    if (config.AUTH_PROVIDER === 'smartboss') {
      for (const key of ['AUTH_ISSUER', 'AUTH_AUDIENCE'] as const) {
        if (!config[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when AUTH_PROVIDER=smartboss`,
          });
        }
      }
      if (!config.AUTH_SMARTBOSS_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_SMARTBOSS_SECRET'],
          message:
            'AUTH_SMARTBOSS_SECRET (>= 32 chars) is required when AUTH_PROVIDER=smartboss — ต้องเป็นค่าเดียวกับ JWT_SECRET ของ Smartboss',
        });
      }
    }

    if (config.AUTH_PROVIDER === 'local') {
      // local provider เป็นช่องทาง dev เท่านั้น — ปล่อยหลุดขึ้น production คือ auth bypass
      if (isProduction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_PROVIDER'],
          message: 'AUTH_PROVIDER=local is not allowed when NODE_ENV=production',
        });
      }
      if (!config.AUTH_LOCAL_SIGNING_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_LOCAL_SIGNING_SECRET'],
          message: 'AUTH_LOCAL_SIGNING_SECRET (>= 32 chars) is required when AUTH_PROVIDER=local',
        });
      }
    }

    if (config.STORAGE_DRIVER === 's3') {
      for (const key of ['STORAGE_BUCKET', 'STORAGE_REGION'] as const) {
        if (!config[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }

    if (config.STORAGE_DRIVER === 'filesystem') {
      // filesystem adapter ไม่มี access control ระดับ object — ห้ามใช้เก็บหลักฐาน/payslip จริง
      if (isProduction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_DRIVER'],
          message: 'STORAGE_DRIVER=filesystem is not allowed when NODE_ENV=production',
        });
      }
      if (!config.STORAGE_FILESYSTEM_ROOT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_FILESYSTEM_ROOT'],
          message: 'STORAGE_FILESYSTEM_ROOT is required when STORAGE_DRIVER=filesystem',
        });
      }
    }

    if (isProduction && !config.FIELD_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIELD_ENCRYPTION_KEY'],
        message: 'FIELD_ENCRYPTION_KEY is required in production (sensitive fields cannot be stored in clear)',
      });
    }

    if (isProduction && config.CORS_ALLOWED_ORIGINS.trim() === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'wildcard CORS origin is not allowed when NODE_ENV=production',
      });
    }

    if (isProduction && !config.DATABASE_SSL && !config.DATABASE_URL.includes('sslmode=')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_SSL'],
        message: 'DATABASE_SSL must be enabled (or sslmode set in DATABASE_URL) in production',
      });
    }
  });

export type RawConfig = z.infer<typeof configSchema>;
