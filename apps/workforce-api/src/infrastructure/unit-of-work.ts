import { Inject, Injectable } from '@nestjs/common';
import {
  actorDisplay,
  actorId,
  AppError,
  redactSensitive,
  requiresReason,
  uuidv7,
  type Actor,
  type AuditEventInput,
  type Clock,
} from '@workforce/domain';
import { schema, withTenant, type DatabaseHandle, type Tx } from '@workforce/db';
import { RequestContextService } from '../shared/request-context';
import { CLOCK, DATABASE_HANDLE } from '../shared/tokens';
import { mapDatabaseError } from './database-errors';

export interface OutboxMessageInput {
  aggregateType: string;
  aggregateId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

export interface UnitOfWorkContext {
  readonly tx: Tx;
  readonly tenantId: string;
  /** บันทึก audit ใน transaction เดียวกับ business change (ADR-0009 ข้อ 1) */
  audit(input: AuditEventInput): Promise<void>;
  /** ส่ง side effect ผ่าน outbox — ห้ามยิง HTTP ตรงใน transaction (ADR-0008) */
  publish(input: OutboxMessageInput): Promise<void>;
}

/**
 * ขอบเขตของ transaction หนึ่งหน่วยงาน
 *
 * ทุกอย่างที่เกิดใน `run()` อยู่ใน transaction เดียว: business data, audit และ outbox
 * ถ้า business ล้มเหลว audit และ outbox ก็ถูก rollback ไปด้วย — ไม่มีสภาวะที่
 * "ส่ง notification แล้วแต่ข้อมูลไม่ได้บันทึก"
 */
@Injectable()
export class UnitOfWork {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly requestContext: RequestContextService,
  ) {}

  /** ใช้ในเส้นทางที่มีผู้เรียกเป็น principal (คือ HTTP request ทั่วไป) */
  async run<R>(handler: (uow: UnitOfWorkContext) => Promise<R>): Promise<R> {
    const principal = this.requestContext.requirePrincipal();
    return this.runAs({ type: 'PRINCIPAL', principal }, principal.tenantId, handler);
  }

  /** ใช้ในงานเบื้องหลัง/ระบบ ที่ไม่มี principal เช่น worker, migration job */
  async runAs<R>(
    actor: Actor,
    tenantId: string,
    handler: (uow: UnitOfWorkContext) => Promise<R>,
  ): Promise<R> {
    try {
      return await withTenant(this.handle.db, tenantId, async (tx) => {
        const context: UnitOfWorkContext = {
          tx,
          tenantId,
          audit: async (input) => this.writeAudit(tx, tenantId, actor, input),
          publish: async (input) => this.writeOutbox(tx, tenantId, input),
        };
        return handler(context);
      });
    } catch (error) {
      // constraint ที่ทำงานคือ invariant ที่ถูกบังคับ ไม่ใช่ระบบพัง — ตอบ 409/400 ไม่ใช่ 500
      throw mapDatabaseError(error);
    }
  }

  private async writeAudit(
    tx: Tx,
    tenantId: string,
    actor: Actor,
    input: AuditEventInput,
  ): Promise<void> {
    if (requiresReason(input.action) && (input.reason ?? '').trim() === '') {
      // ไม่บันทึกเป็นค่าว่างแล้วปล่อยผ่าน — action กลุ่มนี้ไม่มีเหตุผลไม่ได้
      throw AppError.validation(`action ${input.action} requires a reason`);
    }

    const context = this.requestContext.get();
    const isSupportOperator =
      actor.type === 'PRINCIPAL' && actor.principal.accessExpiresAt !== null;

    await tx.insert(schema.auditEvents).values({
      id: uuidv7(),
      tenantId,
      companyId: input.companyId ?? null,
      occurredAt: this.clock.now(),
      actorType: isSupportOperator ? 'SUPPORT_OPERATOR' : actor.type,
      actorId: actorId(actor),
      actorDisplay: actorDisplay(actor),
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      resourceVersion: input.resourceVersion ?? null,
      outcome: input.outcome,
      reason: input.reason ?? null,
      requestId: context?.requestId ?? null,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      // redact ก่อนเขียนเสมอ — audit ไม่ใช่ที่เก็บ PII/secret (ADR-0009 ข้อ 3)
      before: input.before === undefined ? null : redactSensitive(input.before),
      after: input.after === undefined ? null : redactSensitive(input.after),
      metadata: (redactSensitive(input.metadata ?? {}) as Record<string, unknown>) ?? {},
    });
  }

  private async writeOutbox(tx: Tx, tenantId: string, input: OutboxMessageInput): Promise<void> {
    await tx.insert(schema.outboxMessages).values({
      id: uuidv7(),
      tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId ?? null,
      eventType: input.eventType,
      payload: redactSensitive(input.payload) as Record<string, unknown>,
      headers: {
        ...(input.headers ?? {}),
        request_id: this.requestContext.get()?.requestId ?? null,
      },
      occurredAt: this.clock.now(),
    });
  }
}
