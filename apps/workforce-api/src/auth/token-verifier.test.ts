import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@workforce/config';
import { type Clock, LocalDate } from '@workforce/domain';
import { TokenVerifier } from './token-verifier';

/**
 * single login: token ที่ Smartboss ออก ต้องใช้กับ workforce API ได้เลย
 * เทสต์นี้เซ็น token ด้วยพารามิเตอร์ชุดเดียวกับ packages/auth/jwt.ts ของ Smartboss
 * (iss=smartboss, aud=smartboss-web, HS256, tenant อยู่ใน claim `orgId`)
 */

const SECRET = 'smartboss-shared-secret-at-least-32-chars';
const ISSUER = 'smartboss';
const AUDIENCE = 'smartboss-web';

const NOW = new Date('2026-08-02T03:00:00.000Z');

const fixedClock: Clock = {
  now: () => NOW,
  today: () => LocalDate.fromISO('2026-08-02'),
};

function smartbossConfig(over: Record<string, string | undefined> = {}): AppConfig {
  return loadConfig({
    DATABASE_URL: 'postgres://app:secret@localhost:5432/workforce',
    STORAGE_DRIVER: 'filesystem',
    STORAGE_FILESYSTEM_ROOT: '/tmp/workforce',
    AUTH_PROVIDER: 'smartboss',
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    AUTH_SMARTBOSS_SECRET: SECRET,
    ...over,
  });
}

/** เลียนแบบ signAccessToken ของ Smartboss แบบตรงพารามิเตอร์ */
async function signSmartbossToken(claims: {
  sub: string;
  orgId: string | null;
  roles?: string[];
  permissions?: string[];
  secret?: string;
  issuer?: string;
  audience?: string;
}): Promise<string> {
  return new SignJWT({
    orgId: claims.orgId,
    roles: claims.roles ?? [],
    permissions: claims.permissions ?? [],
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(claims.issuer ?? ISSUER)
    .setAudience(claims.audience ?? AUDIENCE)
    .setIssuedAt(Math.floor(NOW.getTime() / 1000))
    .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 900)
    .sign(new TextEncoder().encode(claims.secret ?? SECRET));
}

describe('TokenVerifier — provider smartboss', () => {
  let verifier: TokenVerifier;
  let userId: string;
  let orgId: string;

  beforeAll(() => {
    verifier = new TokenVerifier(smartbossConfig(), fixedClock);
    userId = randomUUID();
    orgId = randomUUID();
  });

  it('รับ token ของ Smartboss และ map orgId → tenantId', async () => {
    const token = await signSmartbossToken({ sub: userId, orgId });
    const verified = await verifier.verify(token);

    expect(verified.subject).toBe(userId);
    expect(verified.tenantId).toBe(orgId);
    expect(verified.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('ปฏิเสธผู้ใช้ระดับแพลตฟอร์มที่ orgId = null', async () => {
    // Smartboss ออก token แบบนี้ให้ super admin ที่ยังไม่สังกัดบริษัท
    const token = await signSmartbossToken({ sub: userId, orgId: null });
    await expect(verifier.verify(token)).rejects.toThrow(/orgId/);
  });

  it('ปฏิเสธ token ที่ orgId ไม่ใช่ UUID', async () => {
    const token = await signSmartbossToken({ sub: userId, orgId: 'not-a-uuid' });
    await expect(verifier.verify(token)).rejects.toThrow(/orgId/);
  });

  it('ปฏิเสธ token ที่เซ็นด้วย secret อื่น', async () => {
    const token = await signSmartbossToken({
      sub: userId,
      orgId,
      secret: 'a-completely-different-secret-32-chars!!',
    });
    await expect(verifier.verify(token)).rejects.toThrow(/invalid or expired token/);
  });

  it('ปฏิเสธ token ที่ issuer/audience ไม่ตรง', async () => {
    const wrongIssuer = await signSmartbossToken({ sub: userId, orgId, issuer: 'someone-else' });
    await expect(verifier.verify(wrongIssuer)).rejects.toThrow(/invalid or expired token/);

    const wrongAudience = await signSmartbossToken({ sub: userId, orgId, audience: 'other-app' });
    await expect(verifier.verify(wrongAudience)).rejects.toThrow(/invalid or expired token/);
  });

  it('ปฏิเสธ token ที่หมดอายุแล้ว', async () => {
    const expired = await new SignJWT({ orgId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(NOW.getTime() / 1000) - 7200)
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifier.verify(expired)).rejects.toThrow(/invalid or expired token/);
  });

  it('ปฏิเสธ token ที่ไม่ได้เซ็น (alg=none)', async () => {
    // กัน alg-confusion: ต้องไม่ยอมรับแม้ payload จะถูกต้องทุกอย่าง
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: userId,
        orgId,
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(NOW.getTime() / 1000) + 900,
      }),
    ).toString('base64url');

    await expect(verifier.verify(`${header}.${body}.`)).rejects.toThrow(
      /invalid or expired token/,
    );
  });
});

/** คืนเฉพาะ path ของ issue เพื่อดูว่า config ติดที่เรื่องไหน */
function issuePaths(over: Record<string, string | undefined>): string[] {
  try {
    smartbossConfig(over);
    return [];
  } catch (error) {
    const issues = (error as { issues?: { path: string }[] }).issues ?? [];
    return issues.map((issue) => issue.path);
  }
}

describe('config — provider smartboss', () => {
  it('ใช้ใน production ได้ (ต่างจาก local ที่ถูกบล็อก)', () => {
    // production ยังมีเงื่อนไขอื่น (storage/SSL/encryption key) ที่ไม่เกี่ยวกับ auth
    // จุดที่ต้องพิสูจน์คือ AUTH_PROVIDER=smartboss ต้องไม่ถูกปฏิเสธเองแบบ local
    expect(issuePaths({ NODE_ENV: 'production' })).not.toContain('AUTH_PROVIDER');

    // เทียบกับ local ที่ถูกบล็อกใน production
    const localInProd = (() => {
      try {
        loadConfig({
          DATABASE_URL: 'postgres://app:secret@localhost:5432/workforce',
          STORAGE_DRIVER: 'filesystem',
          STORAGE_FILESYSTEM_ROOT: '/tmp/workforce',
          AUTH_PROVIDER: 'local',
          AUTH_LOCAL_SIGNING_SECRET: 'a-development-secret-that-is-long-enough',
          NODE_ENV: 'production',
        });
        return [] as string[];
      } catch (error) {
        return ((error as { issues?: { path: string }[] }).issues ?? []).map((i) => i.path);
      }
    })();
    expect(localInProd).toContain('AUTH_PROVIDER');
  });

  it('ต้องมี AUTH_SMARTBOSS_SECRET', () => {
    expect(() => smartbossConfig({ AUTH_SMARTBOSS_SECRET: undefined })).toThrow(
      /AUTH_SMARTBOSS_SECRET/,
    );
  });

  it('claim tenant ตั้งต้นเป็น orgId', () => {
    expect(smartbossConfig().AUTH_TENANT_CLAIM).toBe('orgId');
  });
});
