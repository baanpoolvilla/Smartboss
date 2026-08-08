import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { PrincipalLoader } from './principal-loader';
import { TokenVerifier } from './token-verifier';

/**
 * ลำดับ guard สำคัญ: AuthGuard ต้องทำงานก่อน PermissionsGuard
 * Nest เรียก APP_GUARD ตามลำดับที่ประกาศใน providers
 */
@Module({
  providers: [
    TokenVerifier,
    PrincipalLoader,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [TokenVerifier, PrincipalLoader],
})
export class AuthModule {}
