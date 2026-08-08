import { AppError, isAppError } from '@workforce/domain';

interface PostgresError {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
  table?: string;
}

function asPostgresError(error: unknown): PostgresError | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as PostgresError;
  return typeof candidate.code === 'string' ? candidate : null;
}

/**
 * แปลงข้อผิดพลาดจาก PostgreSQL เป็น AppError ที่ client เข้าใจได้
 *
 * constraint ในฐานข้อมูลเป็นชั้นบังคับ invariant ที่แท้จริง (ADR-0012) — เมื่อมันทำงาน
 * ผู้เรียกควรได้ 409 พร้อมสาเหตุ ไม่ใช่ 500 ที่ทำให้ดูเหมือนระบบพัง
 * ข้อความจาก driver ไม่ถูกส่งกลับตรง ๆ เพราะอาจมีค่าของข้อมูลติดไปด้วย
 */
export function mapDatabaseError(error: unknown): unknown {
  if (isAppError(error)) return error;

  const pgError = asPostgresError(error);
  if (pgError === null) return error;

  switch (pgError.code) {
    case '23505': // unique_violation
      return AppError.conflict('a record with these unique values already exists', {
        meta: { constraint: pgError.constraint ?? null },
      });

    case '23P01': // exclusion_violation — trigger ตรวจช่วง effective ก็ใช้รหัสนี้
      return new AppError(
        'EFFECTIVE_PERIOD_OVERLAP',
        'the effective period overlaps an existing record',
        { meta: { constraint: pgError.constraint ?? null } },
      );

    case '23503': // foreign_key_violation
      return AppError.validation('a referenced record does not exist', {
        meta: { constraint: pgError.constraint ?? null },
      });

    case '23514': // check_violation
      return AppError.validation('a value violates a database constraint', {
        meta: { constraint: pgError.constraint ?? null },
      });

    case '23502': // not_null_violation
      return AppError.validation('a required value is missing');

    case '42501': // insufficient_privilege — เช่น พยายามแก้ audit_events
      return AppError.immutable('this record', {
        detail: 'the database rejected the modification',
      });

    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return AppError.conflict('the request conflicted with a concurrent change; retry it');

    case '57014': // query_canceled (statement timeout)
      return AppError.internal('the database statement timed out');

    default:
      return error;
  }
}
