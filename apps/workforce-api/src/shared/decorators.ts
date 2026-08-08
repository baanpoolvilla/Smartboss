import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@workforce/domain';

export const PUBLIC_ROUTE_KEY = 'workforce:public';
export const REQUIRED_PERMISSIONS_KEY = 'workforce:permissions';
export const IDEMPOTENT_KEY = 'workforce:idempotent';

/**
 * ไม่ต้อง authenticate — ต้องประกาศชัดเจน
 * `permission-coverage.test.ts` จะ fail ถ้าเจอ route ที่ไม่มีทั้ง @Public และ @RequirePermissions
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE_KEY, true);

/**
 * สิทธิ์ที่ต้องมีครบทุกตัว (AND) — ไม่ใช่ OR
 * ถ้าต้องการ OR ให้แยกเป็นคนละ endpoint เพราะ semantics ต่างกันชัดเจนกว่า
 */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** ต้องส่ง header `Idempotency-Key` (ADR-0008) */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<{ principal?: unknown }>();
  return request.principal;
});
