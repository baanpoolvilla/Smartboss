import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import { schema, withSystemTransaction, type DatabaseHandle } from '@workforce/db';
import type { Clock } from '@workforce/domain';
import { and, asc, inArray, lte, sql } from 'drizzle-orm';
import { APP_CONFIG, CLOCK, DATABASE_HANDLE } from '../shared/tokens';

export interface OutboxMessage {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string | null;
  eventType: string;
  payload: unknown;
  headers: unknown;
  attempts: number;
}

/** ปลายทางของ event — Phase 2 จะมี LINE/webhook/queue adapter มาลงทะเบียนที่นี่ */
export interface OutboxSink {
  readonly name: string;
  supports(eventType: string): boolean;
  deliver(message: OutboxMessage): Promise<void>;
}

export interface DispatchResult {
  claimed: number;
  dispatched: number;
  failed: number;
  dead: number;
}

/**
 * ส่ง event ที่อยู่ใน outbox (ADR-0008)
 *
 * รับประกัน at-least-once ไม่ใช่ exactly-once — consumer ต้อง idempotent เอง
 * `FOR UPDATE SKIP LOCKED` ทำให้เพิ่ม dispatcher หลายตัวได้โดยไม่ส่งซ้ำกัน
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly sinks: OutboxSink[] = [];

  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  register(sink: OutboxSink): void {
    this.sinks.push(sink);
  }

  async dispatchBatch(): Promise<DispatchResult> {
    const now = this.clock.now();

    const claimed = await withSystemTransaction(this.database.db, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.outboxMessages)
        .where(
          and(
            inArray(schema.outboxMessages.status, ['PENDING', 'DISPATCHING']),
            lte(schema.outboxMessages.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(schema.outboxMessages.occurredAt))
        .limit(this.config.OUTBOX_BATCH_SIZE)
        .for('update', { skipLocked: true });

      if (rows.length === 0) return [];

      await tx
        .update(schema.outboxMessages)
        .set({ status: 'DISPATCHING' })
        .where(
          inArray(
            schema.outboxMessages.id,
            rows.map((row) => row.id),
          ),
        );

      return rows;
    });

    const result: DispatchResult = { claimed: claimed.length, dispatched: 0, failed: 0, dead: 0 };

    for (const row of claimed) {
      const message: OutboxMessage = {
        id: row.id,
        tenantId: row.tenantId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        payload: row.payload,
        headers: row.headers,
        attempts: row.attempts,
      };

      try {
        await this.deliver(message);
        await this.markDispatched(row.id);
        result.dispatched += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const isDead = attempts >= row.maxAttempts;
        await this.markFailed(row.id, attempts, isDead, error);
        if (isDead) {
          result.dead += 1;
          // DLQ ต้องมีคนเห็น — ไม่ปล่อยให้ event หายเงียบ (spec §17)
          this.logger.error(
            `outbox message ${row.id} (${row.eventType}) exhausted ${row.maxAttempts} attempts`,
          );
        } else {
          result.failed += 1;
        }
      }
    }

    return result;
  }

  private async deliver(message: OutboxMessage): Promise<void> {
    const matching = this.sinks.filter((sink) => sink.supports(message.eventType));
    if (matching.length === 0) {
      // ยังไม่มี consumer ในเฟสนี้ ถือว่าส่งสำเร็จ ไม่ค้างเป็น backlog ปลอม
      this.logger.debug(`no sink registered for ${message.eventType}; marking dispatched`);
      return;
    }
    for (const sink of matching) {
      await sink.deliver(message);
    }
  }

  private async markDispatched(id: string): Promise<void> {
    await withSystemTransaction(this.database.db, async (tx) => {
      await tx
        .update(schema.outboxMessages)
        .set({ status: 'DISPATCHED', dispatchedAt: this.clock.now(), lastError: null })
        .where(sql`${schema.outboxMessages.id} = ${id}`);
    });
  }

  private async markFailed(
    id: string,
    attempts: number,
    isDead: boolean,
    error: unknown,
  ): Promise<void> {
    // exponential backoff แบบมีเพดาน: 2^attempts วินาที สูงสุด 1 ชั่วโมง
    const delaySeconds = Math.min(2 ** attempts, 3600);
    const nextAttemptAt = new Date(this.clock.now().getTime() + delaySeconds * 1000);
    const messageText = error instanceof Error ? error.message : String(error);

    await withSystemTransaction(this.database.db, async (tx) => {
      await tx
        .update(schema.outboxMessages)
        .set({
          status: isDead ? 'DEAD' : 'PENDING',
          attempts,
          nextAttemptAt,
          lastError: messageText.slice(0, 1000),
        })
        .where(sql`${schema.outboxMessages.id} = ${id}`);
    });
  }
}
