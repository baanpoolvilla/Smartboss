import { AppError, isUuid } from '@workforce/domain';

export interface PageResult<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * Keyset pagination บน id
 *
 * ใช้ได้เพราะ id ทุกตัวเป็น UUIDv7 ซึ่งเรียงตามเวลาที่สร้าง (ADR-0002)
 * จึงได้ลำดับที่เสถียรโดยไม่ต้องพ่วง `created_at` เข้าไปใน cursor
 * และไม่มีปัญหาแถวซ้ำ/แถวหายแบบ OFFSET เมื่อมีการ insert ระหว่างเปิดหน้า
 */
export function decodeCursor(cursor: string | undefined): string | null {
  if (cursor === undefined || cursor === '') return null;
  if (!isUuid(cursor)) throw AppError.validation('cursor is not a valid page token');
  return cursor;
}

export function buildPage<T extends { id: string }>(rows: T[], limit: number): PageResult<T> {
  // ดึงเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหม โดยไม่ต้อง COUNT ทั้งตาราง
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    next_cursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export function fetchLimit(limit: number): number {
  return limit + 1;
}
