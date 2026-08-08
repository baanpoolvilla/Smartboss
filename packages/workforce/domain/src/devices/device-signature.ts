import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

/**
 * ลายเซ็นของเครื่องสแกน — Ed25519 ต่อเครื่อง (spec §6.2, §16)
 *
 * ระบบเดิมใช้ shared API key ตัวเดียวทุกเครื่อง hard-code ไว้ใน firmware
 * (spec §3.3 C3–C4) ซึ่งแปลว่าเครื่องหนึ่งหลุด = ปลอมได้ทุกเครื่อง และถอนสิทธิ์
 * ทีละเครื่องไม่ได้
 */

export interface SignedRequest {
  deviceId: string;
  timestamp: string;
  method: string;
  path: string;
  body: string;
}

/**
 * ข้อความที่ถูกเซ็น
 *
 * รวม method และ path ด้วย เพื่อไม่ให้ลายเซ็นของ request หนึ่งถูกนำไปใช้กับอีก
 * endpoint หนึ่งได้ และรวม timestamp เพื่อจำกัดหน้าต่างการ replay
 */
export function buildSigningPayload(request: SignedRequest): Buffer {
  const bodyHash = createHash('sha256').update(request.body, 'utf8').digest('hex');
  return Buffer.from(
    [
      'workforce-device-v1',
      request.deviceId,
      request.timestamp,
      request.method.toUpperCase(),
      request.path,
      bodyHash,
    ].join('\n'),
    'utf8',
  );
}

export function verifyDeviceSignature(input: {
  request: SignedRequest;
  signature: Buffer;
  publicKeyRaw: Buffer;
}): boolean {
  try {
    // เก็บ public key เป็น 32 ไบต์ดิบ แล้วห่อเป็น DER ตอนใช้ — ไม่ต้องเก็บ PEM ใน DB
    const key =
      input.publicKeyRaw.length === 32
        ? createPublicKey({
            key: Buffer.concat([
              Buffer.from('302a300506032b6570032100', 'hex'),
              input.publicKeyRaw,
            ]),
            format: 'der',
            type: 'spki',
          })
        : createPublicKey({ key: input.publicKeyRaw, format: 'der', type: 'spki' });

    return verify(null, buildSigningPayload(input.request), key, input.signature);
  } catch {
    // key เสียหายหรือลายเซ็นผิดรูปแบบ = ตรวจไม่ผ่าน ไม่ใช่ error ที่ต้องโยนขึ้นไป
    return false;
  }
}

/**
 * ตรวจว่า timestamp ของ request อยู่ในหน้าต่างที่ยอมรับได้
 *
 * แยกจากการตรวจ clock drift ของ *เหตุการณ์*: เครื่องที่ offline มา 30 วันส่ง
 * event เก่าได้ (นั่นคือเรื่องปกติ) แต่ตัว request ต้องเพิ่งถูกเซ็น มิฉะนั้น
 * ลายเซ็นเก่าที่ถูกดักไว้จะ replay ได้ตลอดกาล
 */
export function isRequestTimestampFresh(
  timestamp: string,
  now: Date,
  toleranceSeconds: number,
): boolean {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return false;
  return Math.abs(now.getTime() - parsed) <= toleranceSeconds * 1000;
}

/** เทียบ token/secret แบบไม่รั่วเวลา */
export function safeCompare(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashActivationToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
