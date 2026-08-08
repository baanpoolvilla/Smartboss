import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSigningPayload, verifyDeviceSignature } from './device-signature';

/**
 * รูปแบบไบต์ของ payload ที่เซ็น เป็น "สัญญาข้ามภาษา" ระหว่างเซิร์ฟเวอร์ (TypeScript)
 * กับเฟิร์มแวร์ (C บน ESP32) — ทั้งสองฝั่งสร้างสตริงนี้แยกกันคนละ codebase
 *
 * ต่างกันแม้ไบต์เดียว = ทุกเครื่องยืนยันตัวตนไม่ผ่านพร้อมกัน และจะรู้ตัวก็ต่อเมื่อ
 * ติดตั้งหน้างานแล้ว เทสต์ชุดนี้จึงตรึงรูปแบบไว้เป็น golden vector
 * เฟิร์มแวร์อ้างอิงค่าเดียวกันใน firmware/esp32-fingerprint/README.md
 */
describe('device signing payload wire format', () => {
  const fixture = {
    deviceId: '019fbc85-b0be-7000-bc58-546ab4cb7fbe',
    timestamp: '2026-07-15T01:02:03.000Z',
    method: 'POST',
    path: '/api/workforce/v1/device-ingestion/time-events:batch',
    body: '{"batch_id":"demo"}',
  };

  it('pins the exact byte layout', () => {
    const payload = buildSigningPayload(fixture);

    // ค่าที่คาดหวังเขียนเป็นค่าคงที่ทั้งก้อน — ไม่ได้คำนวณซ้ำด้วยโค้ดเดียวกับที่กำลังทดสอบ
    // hash คือ sha256 ของ {"batch_id":"demo"}
    const expected =
      'workforce-device-v1\n' +
      '019fbc85-b0be-7000-bc58-546ab4cb7fbe\n' +
      '2026-07-15T01:02:03.000Z\n' +
      'POST\n' +
      '/api/workforce/v1/device-ingestion/time-events:batch\n' +
      '233790ee635623600c2db9deac927f8864cfb7e39cdbb53aa0db937d9f957312';

    expect(payload.toString('utf8')).toBe(expected);
  });

  it('hashes an empty body to the sha256 of the empty string', () => {
    // เฟิร์มแวร์ส่ง body ว่างสำหรับ GET — ทั้งสองฝั่งต้องได้ค่าเดียวกัน
    const payload = buildSigningPayload({ ...fixture, method: 'GET', body: '' });
    const lines = payload.toString('utf8').split('\n');
    expect(lines[5]).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('separates fields with \\n and nothing else', () => {
    const payload = buildSigningPayload(fixture).toString('utf8');
    expect(payload).not.toContain('\r');
    expect(payload.split('\n')).toHaveLength(6);
  });

  it('changes when any single field changes', () => {
    const base = buildSigningPayload(fixture).toString('utf8');
    const variants = [
      { ...fixture, deviceId: '019fbc85-b0be-7000-bc58-546ab4cb7fbf' },
      { ...fixture, timestamp: '2026-07-15T01:02:04.000Z' },
      { ...fixture, method: 'GET' },
      { ...fixture, path: `${fixture.path}x` },
      { ...fixture, body: `${fixture.body} ` },
    ];

    for (const variant of variants) {
      expect(buildSigningPayload(variant).toString('utf8')).not.toBe(base);
    }
  });

  it('accepts a signature made over the raw 32-byte public key', () => {
    // เฟิร์มแวร์ส่ง public key เป็น 32 ไบต์ดิบ (ไม่ใช่ DER) ตามที่ libsodium คืนมา
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
    expect(publicKeyRaw).toHaveLength(32);

    const payload = buildSigningPayload(fixture);
    const signature = sign(null, payload, privateKey);

    expect(verifyDeviceSignature({ request: fixture, signature, publicKeyRaw })).toBe(true);
  });

  it('rejects a signature over a different body', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);

    const signature = sign(null, buildSigningPayload(fixture), privateKey);
    const tampered = { ...fixture, body: '{"batch_id":"other"}' };

    expect(verifyDeviceSignature({ request: tampered, signature, publicKeyRaw })).toBe(false);
  });
});
