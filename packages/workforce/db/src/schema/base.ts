import { customType, integer, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

/** schema เดียวของระบบ — ไม่ใช้ `public` (ADR-0002) */
export const workforce = pgSchema('workforce');

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});

/** คอลัมน์ที่ทุก business table ต้องมี (ADR-0002) */
export const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};
