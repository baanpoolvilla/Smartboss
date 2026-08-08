import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import { verifyMigrations, type DatabaseHandle } from '@workforce/db';
import { AppError, type Clock } from '@workforce/domain';
import type { healthSchema, Me, readinessSchema } from '@workforce/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { PrincipalRole } from '../auth/principal-loader';
import { Public, RequirePermissions } from '../shared/decorators';
import { RequestContextService } from '../shared/request-context';
import { APP_CONFIG, CLOCK, DATABASE_HANDLE } from '../shared/tokens';

@Controller()
export class SystemController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly requestContext: RequestContextService,
  ) {}

  @Get('health')
  @Public()
  health(): z.infer<typeof healthSchema> {
    return {
      status: 'ok',
      service: this.config.SERVICE_NAME,
      time: this.clock.now().toISOString(),
    };
  }

  /**
   * Readiness ตรวจว่า schema ตรงกับไฟล์ migration ด้วย
   * ป้องกันการรับ traffic ด้วยโค้ดใหม่บน schema เก่า ซึ่งเป็นสาเหตุของ error ที่วินิจฉัยยาก
   */
  @Get('health/ready')
  @Public()
  async ready(): Promise<z.infer<typeof readinessSchema>> {
    const checks: z.infer<typeof readinessSchema>['checks'] = [];

    try {
      await this.database.db.execute(sql`SELECT 1`);
      checks.push({ name: 'database', status: 'ok' });
    } catch (error) {
      checks.push({
        name: 'database',
        status: 'down',
        detail: error instanceof Error ? error.message : 'query failed',
      });
    }

    try {
      const status = await verifyMigrations(this.database.db);
      checks.push(
        status.upToDate
          ? { name: 'schema', status: 'ok' }
          : {
              name: 'schema',
              status: 'down',
              detail: `pending=${status.pending.join(',') || 'none'} drifted=${status.drifted.join(',') || 'none'}`,
            },
      );
    } catch (error) {
      checks.push({
        name: 'schema',
        status: 'down',
        detail: error instanceof Error ? error.message : 'verification failed',
      });
    }

    const down = checks.some((check) => check.status === 'down');
    return { status: down ? 'down' : 'ok', checks };
  }

  /**
   * ข้อมูลตัวตนของผู้เรียก
   * `permissions` มีไว้ให้ UI ตัดสินใจแสดงผล — ไม่ใช่ security control (spec §5)
   */
  @Get('me')
  @RequirePermissions()
  me(@Req() request: FastifyRequest): Me {
    const principal = this.requestContext.requirePrincipal();
    const roles = (request as unknown as { principalRoles?: PrincipalRole[] }).principalRoles ?? [];

    return {
      principal_id: principal.principalId,
      tenant_id: principal.tenantId,
      display_name: principal.displayName,
      email: null,
      employment_id: principal.employmentId,
      company_ids: [...principal.companyIds],
      roles: roles.map((role) => ({
        code: role.code,
        name: role.name,
        company_id: role.companyId,
      })),
      permissions: [...principal.permissions].sort(),
      authenticated_at: principal.authenticatedAt.toISOString(),
      authentication_methods: [...principal.authenticationMethods],
      access_expires_at: principal.accessExpiresAt?.toISOString() ?? null,
    };
  }
}

export function assertNever(value: never): never {
  throw AppError.internal(`unexpected value: ${String(value)}`);
}
