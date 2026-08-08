import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import { AppError } from '@workforce/domain';
import { APP_CONFIG } from '../../shared/tokens';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 1;

/**
 * เข้ารหัส field อ่อนไหวระดับคอลัมน์ — เลขบัตรประชาชน, เลขผู้เสียภาษี, เลขบัญชี
 * (spec §16 "field encryption สำหรับ national ID, bank, tax identifiers")
 *
 * รูปแบบ: [version:1][iv:12][tag:16][ciphertext:n]
 * มี version นำหน้าเพื่อให้หมุนกุญแจ/เปลี่ยน algorithm ได้โดยยังอ่านข้อมูลเก่าออก
 */
@Injectable()
export class FieldEncryptionService {
  private readonly key: Buffer | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key =
      config.FIELD_ENCRYPTION_KEY === undefined
        ? null
        : Buffer.from(config.FIELD_ENCRYPTION_KEY, 'base64');
  }

  get isConfigured(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (this.key === null) {
      // เงียบ ๆ เก็บเป็น plaintext แทนคือสิ่งที่ห้ามที่สุด — ปฏิเสธไปเลยดีกว่า
      throw AppError.validation(
        'FIELD_ENCRYPTION_KEY is not configured; cannot store sensitive fields',
      );
    }
    return this.key;
  }

  encrypt(plaintext: string): Buffer {
    const key = this.requireKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  }

  /**
   * รับ Uint8Array ไม่ใช่เฉพาะ Buffer เพราะ driver คืนค่า bytea ต่างชนิดกัน
   * (node-postgres คืน Buffer, PGlite คืน Uint8Array) — normalize ที่นี่จุดเดียว
   */
  decrypt(payload: Uint8Array): string {
    const key = this.requireKey();
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

    if (bytes.length < 1 + IV_LENGTH + TAG_LENGTH) {
      throw AppError.internal('encrypted payload is truncated');
    }
    if (bytes[0] !== VERSION) {
      throw AppError.internal(`unsupported field encryption version: ${String(bytes[0])}`);
    }

    const iv = bytes.subarray(1, 1 + IV_LENGTH);
    const tag = bytes.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const ciphertext = bytes.subarray(1 + IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Hash แบบ deterministic สำหรับค้นหา/กันซ้ำ โดยไม่ต้องถอดรหัส
   * ใช้ HMAC (ไม่ใช่ SHA ดิบ) เพื่อไม่ให้ผู้ที่ได้ hash ไปทำ dictionary attack
   * บนเลขบัตรประชาชนซึ่งมีจำนวนค่าที่เป็นไปได้จำกัด
   */
  blindIndex(value: string): Buffer {
    const key = this.requireKey();
    return createHmac('sha256', key).update(value.trim()).digest();
  }
}
