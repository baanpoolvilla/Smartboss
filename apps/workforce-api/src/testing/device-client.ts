import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { buildSigningPayload } from '@workforce/domain';
import { BASE, call, type TestHarness } from './test-app';

/**
 * เครื่องสแกนจำลองสำหรับ test
 *
 * ถือ private key ไว้เองและเซ็นทุก request เหมือนของจริง — test จึงเดินผ่าน
 * เส้นทางตรวจลายเซ็นตัวจริง ไม่ใช่ mock guard ทิ้ง
 */
export class FakeDevice {
  private constructor(
    readonly deviceId: string,
    private readonly privateKey: KeyObject,
    readonly publicKeyBase64: string,
    private readonly harness: TestHarness,
  ) {}

  static generateKeyPair(): { privateKey: KeyObject; publicKeyBase64: string } {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    // ส่ง raw 32 ไบต์ — DER/SPKI ของ ed25519 มี prefix 12 ไบต์
    const der = publicKey.export({ format: 'der', type: 'spki' });
    return { privateKey, publicKeyBase64: der.subarray(12).toString('base64') };
  }

  static async activate(
    harness: TestHarness,
    activationToken: string,
    firmwareVersion = '2.0.0',
  ): Promise<{ device: FakeDevice; status: number; body: Record<string, unknown> }> {
    const { privateKey, publicKeyBase64 } = FakeDevice.generateKeyPair();

    const response = await call(harness, 'POST', '/device-activation', {
      payload: {
        activation_token: activationToken,
        public_key: publicKeyBase64,
        firmware_version: firmwareVersion,
      },
    });

    const deviceId = (response.body['device_id'] as string | undefined) ?? '';
    return {
      device: new FakeDevice(deviceId, privateKey, publicKeyBase64, harness),
      status: response.status,
      body: response.body,
    };
  }

  private signHeaders(
    method: string,
    path: string,
    body: string,
    overrides: { timestamp?: string; corruptSignature?: boolean } = {},
  ): Record<string, string> {
    const timestamp = overrides.timestamp ?? this.harness.clock.now().toISOString();
    const payload = buildSigningPayload({
      deviceId: this.deviceId,
      timestamp,
      method,
      path: `${BASE}${path}`,
      body,
    });

    const signature = sign(null, payload, this.privateKey);
    if (overrides.corruptSignature === true) signature[0] = signature[0]! ^ 0xff;

    return {
      'x-device-id': this.deviceId,
      'x-device-timestamp': timestamp,
      'x-device-signature': signature.toString('base64'),
    };
  }

  async post(
    path: string,
    body: unknown,
    overrides: { timestamp?: string; corruptSignature?: boolean } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const raw = JSON.stringify(body);
    const response = await call(this.harness, 'POST', path, {
      rawPayload: raw,
      headers: this.signHeaders('POST', path, raw, overrides),
    });
    return { status: response.status, body: response.body };
  }

  async get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await call(this.harness, 'GET', path, {
      headers: this.signHeaders('GET', path, ''),
    });
    return { status: response.status, body: response.body };
  }
}
