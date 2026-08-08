import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from './index';

const baseEnv = {
  DATABASE_URL: 'postgres://app:secret@localhost:5432/workforce',
  AUTH_PROVIDER: 'local',
  AUTH_LOCAL_SIGNING_SECRET: 'a-development-secret-that-is-long-enough',
  STORAGE_DRIVER: 'filesystem',
  STORAGE_FILESYSTEM_ROOT: '/tmp/workforce',
};

function issuePaths(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigurationError) return error.issues.map((issue) => issue.path);
    throw error;
  }
}

describe('loadConfig', () => {
  it('accepts a complete development configuration', () => {
    const config = loadConfig(baseEnv);
    expect(config.NODE_ENV).toBe('development');
    expect(config.HTTP_PORT).toBe(3100);
    expect(config.DEFAULT_TIME_ZONE).toBe('Asia/Bangkok');
    expect(config.isProduction).toBe(false);
  });

  it('refuses to start without DATABASE_URL — there is no fallback', () => {
    // ระบบเดิมมี `DB_PASS || '123456'` ทำให้ deploy ที่ลืมตั้ง env ยังรันได้ (spec §3.3 C1)
    expect(issuePaths({ ...baseEnv, DATABASE_URL: undefined })).toContain('DATABASE_URL');
  });

  it('refuses AUTH_PROVIDER=local in production', () => {
    const paths = issuePaths({ ...baseEnv, NODE_ENV: 'production' });
    expect(paths).toContain('AUTH_PROVIDER');
  });

  it('refuses filesystem object storage in production', () => {
    const paths = issuePaths({
      ...baseEnv,
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'oidc',
      AUTH_ISSUER: 'https://id.example.com',
      AUTH_AUDIENCE: 'workforce-api',
      AUTH_JWKS_URI: 'https://id.example.com/jwks',
      DATABASE_SSL: 'true',
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    });
    expect(paths).toContain('STORAGE_DRIVER');
  });

  it('requires a field encryption key in production', () => {
    const paths = issuePaths({
      ...baseEnv,
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'oidc',
      AUTH_ISSUER: 'https://id.example.com',
      AUTH_AUDIENCE: 'workforce-api',
      AUTH_JWKS_URI: 'https://id.example.com/jwks',
      DATABASE_SSL: 'true',
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'workforce',
      STORAGE_REGION: 'ap-southeast-1',
    });
    expect(paths).toContain('FIELD_ENCRYPTION_KEY');
  });

  it('requires TLS to the database in production', () => {
    const paths = issuePaths({
      ...baseEnv,
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'oidc',
      AUTH_ISSUER: 'https://id.example.com',
      AUTH_AUDIENCE: 'workforce-api',
      AUTH_JWKS_URI: 'https://id.example.com/jwks',
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'workforce',
      STORAGE_REGION: 'ap-southeast-1',
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    });
    expect(paths).toContain('DATABASE_SSL');
  });

  it('refuses a wildcard CORS origin in production', () => {
    const paths = issuePaths({
      ...baseEnv,
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'oidc',
      AUTH_ISSUER: 'https://id.example.com',
      AUTH_AUDIENCE: 'workforce-api',
      AUTH_JWKS_URI: 'https://id.example.com/jwks',
      DATABASE_SSL: 'true',
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'workforce',
      STORAGE_REGION: 'ap-southeast-1',
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      CORS_ALLOWED_ORIGINS: '*',
    });
    expect(paths).toContain('CORS_ALLOWED_ORIGINS');
  });

  it('requires OIDC settings when AUTH_PROVIDER=oidc', () => {
    const paths = issuePaths({ ...baseEnv, AUTH_PROVIDER: 'oidc' });
    expect(paths).toEqual(expect.arrayContaining(['AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_JWKS_URI']));
  });

  it('rejects a local signing secret that is too short to be useful', () => {
    expect(issuePaths({ ...baseEnv, AUTH_LOCAL_SIGNING_SECRET: 'short' })).toContain(
      'AUTH_LOCAL_SIGNING_SECRET',
    );
  });

  it('rejects a field encryption key that is not 32 bytes', () => {
    expect(
      issuePaths({ ...baseEnv, FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toContain('FIELD_ENCRYPTION_KEY');
  });

  it('caps signed URL lifetime', () => {
    expect(issuePaths({ ...baseEnv, STORAGE_SIGNED_URL_TTL_SECONDS: '86400' })).toContain(
      'STORAGE_SIGNED_URL_TTL_SECONDS',
    );
  });

  it('parses the CORS allowlist into entries', () => {
    const config = loadConfig({
      ...baseEnv,
      CORS_ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
    });
    expect(config.corsAllowedOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });
});
