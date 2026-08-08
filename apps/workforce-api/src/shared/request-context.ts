import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { AppError, type AuthenticatedPrincipal } from '@workforce/domain';

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  principal: AuthenticatedPrincipal | null;
  startedAt: Date;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * บริบทของ request ปัจจุบัน
 *
 * ใช้ AsyncLocalStorage แทนการส่ง context ผ่านทุก function signature
 * แต่ *ห้าม* ใช้เพื่อดึง tenant มาใส่ query เอง — repository ได้ tenant จาก
 * UnitOfWork ที่ตั้ง GUC ไว้แล้ว (ADR-0005 ชั้น 2)
 */
@Injectable()
export class RequestContextService {
  run<R>(context: RequestContext, handler: () => R): R {
    return storage.run(context, handler);
  }

  get(): RequestContext | undefined {
    return storage.getStore();
  }

  requireContext(): RequestContext {
    const context = storage.getStore();
    if (context === undefined) {
      throw AppError.internal('request context is not available outside a request scope');
    }
    return context;
  }

  setPrincipal(principal: AuthenticatedPrincipal): void {
    this.requireContext().principal = principal;
  }

  get principal(): AuthenticatedPrincipal | null {
    return storage.getStore()?.principal ?? null;
  }

  requirePrincipal(): AuthenticatedPrincipal {
    const principal = this.principal;
    if (principal === null) throw AppError.unauthenticated();
    return principal;
  }

  requireTenantId(): string {
    return this.requirePrincipal().tenantId;
  }

  get requestId(): string {
    return storage.getStore()?.requestId ?? 'unknown';
  }
}
