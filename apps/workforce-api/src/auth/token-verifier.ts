import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import { AppError, isUuid, type Clock } from '@workforce/domain';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { APP_CONFIG, CLOCK } from '../shared/tokens';

export interface VerifiedToken {
  subject: string;
  tenantId: string;
  authenticatedAt: Date;
  authenticationMethods: string[];
  expiresAt: Date;
}

/**
 * claim ที่บอกว่า token นี้เป็นของบริษัทไหน
 * - provider oidc/local : ใช้ namespace ของเราเอง เพื่อไม่ชนกับ claim มาตรฐานของ IdP
 * - provider smartboss  : Smartboss ใส่มาเป็น `orgId` (ตั้งทับได้ด้วย AUTH_TENANT_CLAIM)
 */
const DEFAULT_TENANT_CLAIM = 'wf:tenant';

@Injectable()
export class TokenVerifier {
  private readonly remoteJwks: ReturnType<typeof createRemoteJWKSet> | null;
  private readonly localSecret: Uint8Array | null;
  private readonly smartbossSecret: Uint8Array | null;
  private readonly tenantClaim: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.remoteJwks =
      config.AUTH_PROVIDER === 'oidc' && config.AUTH_JWKS_URI !== undefined
        ? createRemoteJWKSet(new URL(config.AUTH_JWKS_URI))
        : null;

    this.localSecret =
      config.AUTH_PROVIDER === 'local' && config.AUTH_LOCAL_SIGNING_SECRET !== undefined
        ? new TextEncoder().encode(config.AUTH_LOCAL_SIGNING_SECRET)
        : null;

    this.smartbossSecret =
      config.AUTH_PROVIDER === 'smartboss' && config.AUTH_SMARTBOSS_SECRET !== undefined
        ? new TextEncoder().encode(config.AUTH_SMARTBOSS_SECRET)
        : null;

    this.tenantClaim =
      config.AUTH_PROVIDER === 'smartboss' ? config.AUTH_TENANT_CLAIM : DEFAULT_TENANT_CLAIM;
  }

  async verify(token: string): Promise<VerifiedToken> {
    const payload = await this.decode(token);

    const subject = payload.sub;
    if (typeof subject !== 'string' || subject.length === 0) {
      throw AppError.unauthenticated('token has no subject');
    }

    // tenant มาจาก token ที่ verify แล้วเท่านั้น — ห้ามรับจาก header/query/body
    // ที่ client ควบคุมได้ (ADR-0005 ชั้น 1, spec §21)
    const tenantId = payload[this.tenantClaim];
    if (typeof tenantId !== 'string' || !isUuid(tenantId)) {
      // Smartboss ออก token ให้ผู้ใช้ระดับแพลตฟอร์มด้วย orgId = null ได้
      // — คนกลุ่มนั้นเข้า workforce ไม่ได้ เพราะทุกข้อมูลผูกกับ tenant เสมอ
      throw AppError.unauthenticated(`token is missing a valid ${this.tenantClaim} claim`);
    }

    const authTime = typeof payload['auth_time'] === 'number' ? payload['auth_time'] : payload.iat;
    const amr = Array.isArray(payload['amr'])
      ? (payload['amr'] as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];

    return {
      subject,
      tenantId,
      authenticatedAt: new Date((authTime ?? 0) * 1000),
      authenticationMethods: amr,
      expiresAt: new Date((payload.exp ?? 0) * 1000),
    };
  }

  private async decode(token: string): Promise<JWTPayload> {
    try {
      if (this.config.AUTH_PROVIDER === 'smartboss') {
        if (this.smartbossSecret === null) {
          throw AppError.internal('smartboss signing secret is not configured');
        }
        const { payload } = await jwtVerify(token, this.smartbossSecret, {
          issuer: this.config.AUTH_ISSUER as string,
          audience: this.config.AUTH_AUDIENCE as string,
          // ตรึงอัลกอริทึมไว้ กัน alg-confusion (เช่นส่ง token alg=none เข้ามา)
          algorithms: ['HS256'],
          clockTolerance: this.config.AUTH_CLOCK_TOLERANCE_SECONDS,
          currentDate: this.clock.now(),
        });
        return payload;
      }

      if (this.config.AUTH_PROVIDER === 'local') {
        if (this.localSecret === null) throw AppError.internal('local signing secret is not configured');
        const { payload } = await jwtVerify(token, this.localSecret, {
          issuer: 'workforce-local',
          audience: 'workforce-api',
          clockTolerance: this.config.AUTH_CLOCK_TOLERANCE_SECONDS,
          // ใช้เวลาจาก Clock ที่ inject เข้ามา ไม่ใช่ Date.now() ภายใน jose
          // เพื่อให้การหมดอายุของ token ทดสอบได้และ deterministic
          currentDate: this.clock.now(),
        });
        return payload;
      }

      if (this.remoteJwks === null) throw AppError.internal('JWKS is not configured');
      const { payload } = await jwtVerify(token, this.remoteJwks, {
        issuer: this.config.AUTH_ISSUER as string,
        audience: this.config.AUTH_AUDIENCE as string,
        clockTolerance: this.config.AUTH_CLOCK_TOLERANCE_SECONDS,
        currentDate: this.clock.now(),
      });
      return payload;
    } catch (error) {
      if (error instanceof AppError) throw error;
      // ไม่ส่งรายละเอียดของ jose กลับไป — บอกแค่ว่า token ใช้ไม่ได้
      throw AppError.unauthenticated('invalid or expired token');
    }
  }
}
