import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { listAuditEventsQuerySchema, type AuditEvent } from '@workforce/contracts';
import { schema } from '@workforce/db';
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { RequirePermissions } from '../shared/decorators';
import { decodeCursor, type PageResult } from '../shared/pagination';
import { zodPipe } from '../shared/zod-validation.pipe';

type AuditRow = typeof schema.auditEvents.$inferSelect;

@Injectable()
export class AuditQueryService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(query: {
    cursor: string | null;
    limit: number;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    actorId?: string;
    outcome?: string;
    occurredFrom?: string;
    occurredTo?: string;
  }): Promise<PageResult<AuditEvent>> {
    return this.uow.run(async (uow) => {
      const conditions: SQL[] = [];
      // audit เรียงจากใหม่ไปเก่า cursor จึงเดินหน้าด้วย `<` ไม่ใช่ `>`
      if (query.cursor !== null) conditions.push(lt(schema.auditEvents.id, query.cursor));
      if (query.action !== undefined) conditions.push(eq(schema.auditEvents.action, query.action));
      if (query.resourceType !== undefined)
        conditions.push(eq(schema.auditEvents.resourceType, query.resourceType));
      if (query.resourceId !== undefined)
        conditions.push(eq(schema.auditEvents.resourceId, query.resourceId));
      if (query.actorId !== undefined) conditions.push(eq(schema.auditEvents.actorId, query.actorId));
      if (query.outcome !== undefined) conditions.push(eq(schema.auditEvents.outcome, query.outcome));
      if (query.occurredFrom !== undefined)
        conditions.push(gte(schema.auditEvents.occurredAt, new Date(query.occurredFrom)));
      if (query.occurredTo !== undefined)
        conditions.push(lte(schema.auditEvents.occurredAt, new Date(query.occurredTo)));

      const rows = await uow.tx
        .select()
        .from(schema.auditEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.auditEvents.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;

      return {
        items: items.map(toAuditEvent),
        next_cursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      };
    });
  }
}

@Controller()
export class AuditController {
  constructor(private readonly service: AuditQueryService) {}

  @Get('audit-events')
  @RequirePermissions('workforce.audit.read')
  async list(
    @Query(zodPipe(listAuditEventsQuerySchema)) query: z.infer<typeof listAuditEventsQuerySchema>,
  ): Promise<PageResult<AuditEvent>> {
    return this.service.list({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.resource_type === undefined ? {} : { resourceType: query.resource_type }),
      ...(query.resource_id === undefined ? {} : { resourceId: query.resource_id }),
      ...(query.actor_id === undefined ? {} : { actorId: query.actor_id }),
      ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
      ...(query.occurred_from === undefined ? {} : { occurredFrom: query.occurred_from }),
      ...(query.occurred_to === undefined ? {} : { occurredTo: query.occurred_to }),
    });
  }
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    occurred_at: row.occurredAt.toISOString(),
    recorded_at: row.recordedAt.toISOString(),
    actor_type: row.actorType as AuditEvent['actor_type'],
    actor_id: row.actorId,
    actor_display: row.actorDisplay,
    on_behalf_of_id: row.onBehalfOfId,
    action: row.action,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    resource_version: row.resourceVersion,
    outcome: row.outcome as AuditEvent['outcome'],
    reason: row.reason,
    request_id: row.requestId,
    company_id: row.companyId,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}
