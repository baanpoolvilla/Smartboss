import type { DataScope, Permission } from '../authz/permissions';

/**
 * ตัวตนที่ผ่านการ authenticate แล้ว
 *
 * `tenantId` มาจาก access token ที่ verify แล้วเท่านั้น
 * ห้ามรับจาก query/body/header ที่ client ควบคุมได้ (ADR-0005 ชั้น 1)
 */
export interface AuthenticatedPrincipal {
  readonly principalId: string;
  readonly tenantId: string;
  readonly subject: string;
  readonly displayName: string;
  /** employment ของตัว principal เอง — ใช้ resolve scope SELF */
  readonly employmentId: string | null;
  readonly permissions: ReadonlySet<Permission>;
  /** company ที่ role assignment ครอบคลุม; ว่าง = ทุก company ใน tenant */
  readonly companyIds: readonly string[];
  readonly scopes: Readonly<Record<string, DataScope>>;
  readonly authenticatedAt: Date;
  readonly authenticationMethods: readonly string[];
  /** support access แบบ JIT ต้องมีวันหมดอายุเสมอ */
  readonly accessExpiresAt: Date | null;
}

export interface DeviceIdentity {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly credentialId: string;
  readonly revokedAt: Date | null;
}

export type Actor =
  | { type: 'PRINCIPAL'; principal: AuthenticatedPrincipal }
  | { type: 'DEVICE'; device: DeviceIdentity }
  | { type: 'SYSTEM'; component: string };

export function actorId(actor: Actor): string | null {
  switch (actor.type) {
    case 'PRINCIPAL':
      return actor.principal.principalId;
    case 'DEVICE':
      return actor.device.deviceId;
    case 'SYSTEM':
      return null;
  }
}

export function actorDisplay(actor: Actor): string {
  switch (actor.type) {
    case 'PRINCIPAL':
      return actor.principal.displayName;
    case 'DEVICE':
      return `device:${actor.device.deviceId}`;
    case 'SYSTEM':
      return `system:${actor.component}`;
  }
}

export function actorTenantId(actor: Actor): string | null {
  switch (actor.type) {
    case 'PRINCIPAL':
      return actor.principal.tenantId;
    case 'DEVICE':
      return actor.device.tenantId;
    case 'SYSTEM':
      return null;
  }
}
