/**
 * Error กลางของระบบ — map เป็น RFC 9457 problem+json ที่ชั้น HTTP (spec §13)
 *
 * domain layer โยน AppError โดยไม่รู้จัก HTTP; ชั้น interface เป็นคนแปลงเป็น status
 */

export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'STEP_UP_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'REQUEST_IN_PROGRESS'
  | 'IMMUTABLE_RESOURCE'
  | 'EFFECTIVE_PERIOD_OVERLAP'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  IDEMPOTENCY_KEY_REUSED: 422,
  REQUEST_IN_PROGRESS: 409,
  IMMUTABLE_RESOURCE: 409,
  EFFECTIVE_PERIOD_OVERLAP: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  detail?: string;
  /** ข้อมูลเพิ่มเติมที่ปลอดภัยจะส่งให้ client — ห้ามใส่ PII หรือ secret */
  meta?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly detail: string | undefined;
  readonly meta: Record<string, unknown> | undefined;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = options.detail;
    this.meta = options.meta;
  }

  /** URN สำหรับ `type` ใน problem+json */
  get problemType(): string {
    return `urn:workforce:error:${this.code.toLowerCase().replace(/_/g, '-')}`;
  }

  static validation(message: string, options?: AppErrorOptions): AppError {
    return new AppError('VALIDATION_FAILED', message, options);
  }

  static unauthenticated(message = 'authentication required', options?: AppErrorOptions): AppError {
    return new AppError('UNAUTHENTICATED', message, options);
  }

  static forbidden(message = 'permission denied', options?: AppErrorOptions): AppError {
    return new AppError('FORBIDDEN', message, options);
  }

  static stepUpRequired(message = 'step-up authentication required', options?: AppErrorOptions): AppError {
    return new AppError('STEP_UP_REQUIRED', message, options);
  }

  /**
   * ใช้กับทรัพยากรที่ไม่มีอยู่ **และ** ทรัพยากรของ tenant อื่น
   * ตอบ 404 ไม่ใช่ 403 เพราะ 403 เป็นการยืนยันว่าของชิ้นนั้นมีอยู่จริง (ADR-0005)
   */
  static notFound(resource: string, options?: AppErrorOptions): AppError {
    return new AppError('NOT_FOUND', `${resource} not found`, options);
  }

  static conflict(message: string, options?: AppErrorOptions): AppError {
    return new AppError('CONFLICT', message, options);
  }

  static immutable(resource: string, options?: AppErrorOptions): AppError {
    return new AppError('IMMUTABLE_RESOURCE', `${resource} is immutable and cannot be modified`, options);
  }

  static internal(message = 'internal error', options?: AppErrorOptions): AppError {
    return new AppError('INTERNAL', message, options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
