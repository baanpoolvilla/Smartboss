import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '@workforce/config';
import { AppError, requiresStepUp, type Clock, type Permission } from '@workforce/domain';
import { PUBLIC_ROUTE_KEY, REQUIRED_PERMISSIONS_KEY } from '../shared/decorators';
import { RequestContextService } from '../shared/request-context';
import { APP_CONFIG, CLOCK } from '../shared/tokens';

/**
 * ตรวจสิทธิ์ฝั่ง server ทุก endpoint (spec §5)
 *
 * route ที่ไม่ประกาศทั้ง @Public() และ @RequirePermissions() จะถูกปฏิเสธ
 * — ปลอดภัยกว่าปล่อยผ่านเมื่อ developer ลืม และ `permission-coverage.test.ts`
 * จะจับได้ตั้งแต่ตอน test ไม่ต้องรอ runtime
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (required === undefined) {
      throw AppError.forbidden('route does not declare required permissions');
    }

    const principal = this.requestContext.requirePrincipal();

    if (principal.accessExpiresAt !== null && principal.accessExpiresAt <= this.clock.now()) {
      throw AppError.forbidden('time-limited access has expired');
    }

    const missing = required.filter((permission) => !principal.permissions.has(permission));
    if (missing.length > 0) {
      throw AppError.forbidden('permission denied', { meta: { required_permissions: missing } });
    }

    this.assertStepUp(required, principal.authenticationMethods, principal.authenticatedAt);
    return true;
  }

  /**
   * การกระทำที่กระทบเงินหรือเปิดหลักฐานส่วนบุคคลต้องมี MFA ที่ยังไม่เก่าเกินไป
   * (spec §16) — ไม่พอที่จะ "เคย" ยืนยันตัวตนตอน login เมื่อ 8 ชั่วโมงก่อน
   */
  private assertStepUp(
    required: readonly Permission[],
    methods: readonly string[],
    authenticatedAt: Date,
  ): void {
    const needsStepUp = required.some((permission) => requiresStepUp(permission));
    if (!needsStepUp) return;

    if (!methods.includes('mfa')) {
      throw AppError.stepUpRequired('multi-factor authentication is required for this action');
    }

    const ageSeconds = (this.clock.now().getTime() - authenticatedAt.getTime()) / 1000;
    if (ageSeconds > this.config.STEP_UP_MAX_AGE_SECONDS) {
      throw AppError.stepUpRequired('re-authentication is required for this action', {
        meta: { max_age_seconds: this.config.STEP_UP_MAX_AGE_SECONDS },
      });
    }
  }
}
