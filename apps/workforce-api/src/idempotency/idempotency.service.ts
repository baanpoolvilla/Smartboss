import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import { schema, withSystemTransaction, type DatabaseHandle } from '@workforce/db';
import { AppError, uuidv7, type Clock } from '@workforce/domain';
import { and, eq, lt } from 'drizzle-orm';
import { APP_CONFIG, CLOCK, DATABASE_HANDLE } from '../shared/tokens';

export interface IdempotencyReplay {
  kind: 'REPLAY';
  status: number;
  body: unknown;
}

export interface IdempotencyProceed {
  kind: 'PROCEED';
}

export type IdempotencyDecision = IdempotencyReplay | IdempotencyProceed;

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Fingerprint ของคำขอ — ผูกกับ tenant, ผู้เรียก, method, path และ body
   *
   * ผูก tenant/principal ด้วยเพื่อไม่ให้ key ที่เดาได้ของ tenant หนึ่ง
   * ไปชนกับของอีก tenant หนึ่ง (แม้ unique index จะแยกตาม tenant อยู่แล้ว
   * การรวมไว้ใน fingerprint ทำให้ความผิดพลาดตรวจพบได้ชัดกว่า)
   */
  fingerprint(input: {
    tenantId: string;
    principalId: string | null;
    method: string;
    path: string;
    body: unknown;
  }): string {
    const canonical = JSON.stringify({
      tenant: input.tenantId,
      principal: input.principalId,
      method: input.method.toUpperCase(),
      path: input.path,
      body: canonicalize(input.body),
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  async begin(input: {
    tenantId: string;
    principalId: string | null;
    key: string;
    fingerprint: string;
  }): Promise<IdempotencyDecision> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.IDEMPOTENCY_RETENTION_DAYS * 86_400_000);

    return withSystemTransaction(this.database.db, async (tx) => {
      const inserted = await tx
        .insert(schema.idempotencyKeys)
        .values({
          id: uuidv7(),
          tenantId: input.tenantId,
          principalId: input.principalId,
          idempotencyKey: input.key,
          fingerprint: input.fingerprint,
          status: 'IN_PROGRESS',
          expiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: schema.idempotencyKeys.id });

      if (inserted.length > 0) return { kind: 'PROCEED' };

      const existingRows = await tx
        .select()
        .from(schema.idempotencyKeys)
        .where(
          and(
            eq(schema.idempotencyKeys.tenantId, input.tenantId),
            eq(schema.idempotencyKeys.idempotencyKey, input.key),
          ),
        )
        .limit(1);

      const existing = existingRows[0];
      if (existing === undefined) return { kind: 'PROCEED' };

      if (existing.fingerprint !== input.fingerprint) {
        // คีย์เดิมแต่ payload ต่าง = bug ฝั่ง client ไม่ใช่การ retry
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with a different request payload',
        );
      }

      if (existing.status === 'IN_PROGRESS') {
        throw new AppError(
          'REQUEST_IN_PROGRESS',
          'a request with this Idempotency-Key is still in progress',
        );
      }

      return {
        kind: 'REPLAY',
        status: existing.responseStatus ?? 200,
        body: existing.responseBody,
      };
    });
  }

  async complete(input: {
    tenantId: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await withSystemTransaction(this.database.db, async (tx) => {
      await tx
        .update(schema.idempotencyKeys)
        .set({
          status: 'COMPLETED',
          responseStatus: input.status,
          responseBody: input.body === undefined ? null : (input.body as Record<string, unknown>),
          completedAt: this.clock.now(),
        })
        .where(
          and(
            eq(schema.idempotencyKeys.tenantId, input.tenantId),
            eq(schema.idempotencyKeys.idempotencyKey, input.key),
          ),
        );
    });
  }

  /**
   * ปล่อยคีย์เมื่อคำขอล้มเหลว เพื่อให้ client retry ได้
   *
   * ถ้าปล่อยไว้เป็น IN_PROGRESS ค้าง client จะติด 409 จนกว่าคีย์จะหมดอายุ
   * ทั้งที่ยังไม่มีอะไรถูกบันทึกสำเร็จเลย
   */
  async release(input: { tenantId: string; key: string }): Promise<void> {
    await withSystemTransaction(this.database.db, async (tx) => {
      await tx
        .delete(schema.idempotencyKeys)
        .where(
          and(
            eq(schema.idempotencyKeys.tenantId, input.tenantId),
            eq(schema.idempotencyKeys.idempotencyKey, input.key),
            eq(schema.idempotencyKeys.status, 'IN_PROGRESS'),
          ),
        );
    });
  }

  /** งานทำความสะอาด — เรียกจาก scheduler ใน Phase 2 */
  async purgeExpired(): Promise<number> {
    return withSystemTransaction(this.database.db, async (tx) => {
      const deleted = await tx
        .delete(schema.idempotencyKeys)
        .where(lt(schema.idempotencyKeys.expiresAt, this.clock.now()))
        .returning({ id: schema.idempotencyKeys.id });
      return deleted.length;
    });
  }
}

/** เรียงคีย์ของ object ให้คงที่ เพื่อให้ body เดิมได้ fingerprint เดิมเสมอ */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}
