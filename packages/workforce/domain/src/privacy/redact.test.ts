import { describe, expect, it } from 'vitest';
import { findSensitiveKeys, REDACTED, redactSensitive } from './redact';

describe('redactSensitive', () => {
  it('redacts credentials and tokens', () => {
    const result = redactSensitive({
      username: 'somchai',
      password: 'hunter2',
      line_channel_token: 'abc123',
      device_key: 'CHANGE_ME_DEVICE_KEY',
      apiKey: 'k-1',
    }) as Record<string, string>;

    expect(result['username']).toBe('somchai');
    for (const key of ['password', 'line_channel_token', 'device_key', 'apiKey']) {
      expect(result[key]).toMatch(new RegExp(`^\\${REDACTED}:[0-9a-f]{12}$`));
      expect(result[key]).not.toContain('hunter2');
      expect(result[key]).not.toContain('CHANGE_ME');
    }
  });

  it('redacts sensitive personal identifiers', () => {
    const result = redactSensitive({
      display_name: 'สมชาย ใจดี',
      national_id: '1234567890123',
      bank_account: '123-4-56789-0',
      tax_id: '0105551234567',
      fp_template: 'base64-blob',
    }) as Record<string, string>;

    expect(result['display_name']).toBe('สมชาย ใจดี');
    expect(result['national_id']).not.toContain('1234567890123');
    expect(result['bank_account']).not.toContain('123-4-56789-0');
    expect(result['tax_id']).not.toContain('0105551234567');
    expect(result['fp_template']).not.toContain('base64-blob');
  });

  it('produces a stable hash so change detection still works', () => {
    const first = redactSensitive({ password: 'same' }) as Record<string, string>;
    const second = redactSensitive({ password: 'same' }) as Record<string, string>;
    const different = redactSensitive({ password: 'other' }) as Record<string, string>;

    expect(first['password']).toBe(second['password']);
    expect(first['password']).not.toBe(different['password']);
  });

  it('can omit the hash entirely', () => {
    const result = redactSensitive({ password: 'x' }, { hashSensitive: false }) as Record<string, string>;
    expect(result['password']).toBe(REDACTED);
  });

  it('walks nested structures and arrays', () => {
    const result = redactSensitive({
      people: [{ name: 'A', national_id: '111' }, { name: 'B', national_id: '222' }],
      nested: { deep: { session_token: 'abc' } },
    });

    expect(findSensitiveKeys(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('111');
    expect(JSON.stringify(result)).not.toContain('abc');
  });

  it('leaves nulls alone rather than inventing a hash', () => {
    const result = redactSensitive({ national_id: null, password: undefined }) as Record<string, unknown>;
    expect(result['national_id']).toBeNull();
    expect(result['password']).toBeUndefined();
  });

  it('truncates runaway nesting instead of recursing forever', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 20; index += 1) {
      cursor['next'] = {};
      cursor = cursor['next'] as Record<string, unknown>;
    }
    expect(() => JSON.stringify(redactSensitive(deep))).not.toThrow();
    expect(JSON.stringify(redactSensitive(deep))).toContain('[TRUNCATED]');
  });
});

describe('findSensitiveKeys', () => {
  it('reports sensitive values that were not redacted', () => {
    // ใช้เป็นยามใน test อื่น: ตรวจว่าไม่มี PII หลุดเข้า audit/log (spec §16)
    expect(findSensitiveKeys({ user: { national_id: '123' } })).toEqual(['user.national_id']);
    expect(findSensitiveKeys({ items: [{ password: 'p' }] })).toEqual(['items[0].password']);
    expect(findSensitiveKeys(redactSensitive({ user: { national_id: '123' } }))).toEqual([]);
  });
});
