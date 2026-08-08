import { Inject, Injectable } from '@nestjs/common';
import { schema, withTenant, type DatabaseHandle } from '@workforce/db';
import {
  AppError,
  isPermission,
  type AuthenticatedPrincipal,
  type Clock,
  type DataScope,
  type Permission,
} from '@workforce/domain';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { CLOCK, DATABASE_HANDLE } from '../shared/tokens';
import type { VerifiedToken } from './token-verifier';

export interface PrincipalRole {
  code: string;
  name: string;
  companyId: string | null;
}

export interface LoadedPrincipal {
  principal: AuthenticatedPrincipal;
  roles: PrincipalRole[];
}

/** map permission ที่ลงท้ายด้วย scope suffix เป็น DataScope (ADR-0006) */
function scopeOf(permission: Permission): { base: string; scope: DataScope } | null {
  if (permission.endsWith('.self')) return { base: permission.slice(0, -5), scope: 'SELF' };
  if (permission.endsWith('.team')) return { base: permission.slice(0, -5), scope: 'TEAM' };
  if (permission.endsWith('.all')) return { base: permission.slice(0, -4), scope: 'TENANT' };
  return null;
}

/**
 * โหลดสิทธิ์จากฐานข้อมูลทุก request
 *
 * เจตนาไม่เก็บ role/permission ไว้ใน token: การถอนสิทธิ์ต้องมีผลทันที
 * ไม่ใช่รอจนกว่า token เดิมจะหมดอายุ (ADR-0006)
 */
@Injectable()
export class PrincipalLoader {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async load(token: VerifiedToken): Promise<LoadedPrincipal> {
    const now = this.clock.now();

    return withTenant(this.database.db, token.tenantId, async (tx) => {
      const principalRows = await tx
        .select()
        .from(schema.principals)
        .where(eq(schema.principals.subject, token.subject))
        .limit(1);

      const principalRow = principalRows[0];
      if (principalRow === undefined) {
        // token ถูกต้องแต่ยังไม่มี principal ใน tenant นี้ — ไม่ auto-provision
        // การสร้างสิทธิ์เข้าถึงต้องเป็นการกระทำที่ตั้งใจและ audit ได้
        throw AppError.unauthenticated('principal is not provisioned in this tenant');
      }
      if (principalRow.status !== 'ACTIVE') {
        throw AppError.forbidden('principal is disabled');
      }

      const assignments = await tx
        .select({
          roleId: schema.principalRoleAssignments.roleId,
          companyId: schema.principalRoleAssignments.companyId,
          expiresAt: schema.principalRoleAssignments.expiresAt,
          roleCode: schema.roles.code,
          roleName: schema.roles.name,
          permission: schema.rolePermissions.permission,
        })
        .from(schema.principalRoleAssignments)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.principalRoleAssignments.roleId))
        .leftJoin(
          schema.rolePermissions,
          eq(schema.rolePermissions.roleId, schema.principalRoleAssignments.roleId),
        )
        .where(
          and(
            eq(schema.principalRoleAssignments.principalId, principalRow.id),
            // การมอบสิทธิ์แบบ JIT ที่หมดอายุแล้วต้องไม่มีผล แม้แถวยังอยู่ในตาราง
            or(
              isNull(schema.principalRoleAssignments.expiresAt),
              gt(schema.principalRoleAssignments.expiresAt, now),
            ),
          ),
        );

      const permissions = new Set<Permission>();
      const scopes: Record<string, DataScope> = {};
      const companyIds = new Set<string>();
      const roleMap = new Map<string, PrincipalRole>();
      // query join กับ role_permissions จึงมีหลายแถวต่อหนึ่ง assignment — dedupe ก่อนสรุปวันหมดอายุ
      const assignmentExpiry = new Map<string, Date | null>();

      for (const row of assignments) {
        const assignmentKey = `${row.roleId}:${row.companyId ?? '*'}`;
        roleMap.set(assignmentKey, {
          code: row.roleCode,
          name: row.roleName,
          companyId: row.companyId,
        });
        assignmentExpiry.set(assignmentKey, row.expiresAt);
        if (row.companyId !== null) companyIds.add(row.companyId);

        if (row.permission !== null && isPermission(row.permission)) {
          permissions.add(row.permission);
          const scoped = scopeOf(row.permission);
          if (scoped !== null) {
            const current = scopes[scoped.base];
            scopes[scoped.base] = widen(current, scoped.scope);
          }
        }
      }

      // สิทธิ์ถาวรแม้เพียงชุดเดียวทำให้บัญชีนี้ไม่หมดอายุ
      // จะตั้งวันหมดอายุได้ก็ต่อเมื่อ *ทุก* assignment เป็นแบบมีกำหนดเวลา (JIT/support)
      const expiries = [...assignmentExpiry.values()];
      const hasPermanent = expiries.length === 0 || expiries.some((value) => value === null);
      const accessExpiresAt = hasPermanent
        ? null
        : expiries.reduce<Date | null>(
            (latest, value) =>
              value !== null && (latest === null || value > latest) ? value : latest,
            null,
          );

      // หา employment ของตัว principal เอง เพื่อ resolve scope SELF
      let employmentId: string | null = null;
      if (principalRow.personId !== null) {
        const employmentRows = await tx
          .select({ id: schema.employments.id })
          .from(schema.employments)
          .where(eq(schema.employments.personId, principalRow.personId))
          .limit(1);
        employmentId = employmentRows[0]?.id ?? null;
      }

      const principal: AuthenticatedPrincipal = {
        principalId: principalRow.id,
        tenantId: token.tenantId,
        subject: token.subject,
        displayName: principalRow.displayName,
        employmentId,
        permissions,
        companyIds: [...companyIds],
        scopes,
        authenticatedAt: token.authenticatedAt,
        authenticationMethods: token.authenticationMethods,
        accessExpiresAt,
      };

      return { principal, roles: [...roleMap.values()] };
    });
  }
}

const SCOPE_RANK: Record<DataScope, number> = { SELF: 0, TEAM: 1, COMPANY: 2, TENANT: 3 };

function widen(current: DataScope | undefined, candidate: DataScope): DataScope {
  if (current === undefined) return candidate;
  return SCOPE_RANK[candidate] > SCOPE_RANK[current] ? candidate : current;
}
