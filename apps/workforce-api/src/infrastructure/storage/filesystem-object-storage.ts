import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { AppError } from '@workforce/domain';
import type { ObjectStorage, PutObjectInput, SignedUrlOptions } from './object-storage';

/**
 * Adapter สำหรับ local dev และ test — ทำให้รัน test ได้โดยไม่ต้องมี MinIO/S3
 *
 * `@workforce/config` ปฏิเสธการ start ถ้าเลือก driver นี้ใน production (ADR-0010)
 * signed URL ที่นี่เป็นแค่ path + HMAC + expiry เพื่อให้ flow เหมือนกัน
 * ไม่ได้ให้การรับประกันด้านความปลอดภัยระดับเดียวกับ S3 presigned URL
 */
export class FilesystemObjectStorage implements ObjectStorage {
  readonly driver = 'filesystem' as const;
  private readonly root: string;
  private readonly signingSecret: string;
  private readonly defaultTtlSeconds: number;

  constructor(options: { root: string; signingSecret: string; defaultTtlSeconds?: number }) {
    this.root = resolve(options.root);
    this.signingSecret = options.signingSecret;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 300;
  }

  /**
   * กัน path traversal: key ที่มี `..` หรือ absolute path ต้องไม่พาไฟล์ออกนอก root
   * ตรวจด้วยการ resolve จริงแล้วเทียบ prefix ไม่ใช่แค่ค้นหา '..' ในสตริง
   */
  private resolveKey(key: string): string {
    if (key.length === 0) throw AppError.validation('object key must not be empty');
    const target = resolve(this.root, normalize(key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw AppError.validation('object key escapes the storage root');
    }
    return target;
  }

  async put(input: PutObjectInput): Promise<void> {
    const path = this.resolveKey(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
    await writeFile(
      `${path}.meta.json`,
      JSON.stringify({ contentType: input.contentType, metadata: input.metadata ?? {} }),
      'utf8',
    );
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      throw AppError.notFound('object');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await readFile(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.resolveKey(key);
    await rm(path, { force: true });
    await rm(`${path}.meta.json`, { force: true });
  }

  async createSignedDownloadUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? this.defaultTtlSeconds);
    const signature = this.sign(key, expiresAt);
    const params = new URLSearchParams({ key, expires: String(expiresAt), signature });
    return `/internal/objects?${params.toString()}`;
  }

  /** ตรวจ signed URL — ใช้ในเส้นทาง dev download */
  verifySignedUrl(key: string, expiresAt: number, signature: string): boolean {
    if (expiresAt * 1000 < Date.now()) return false;
    const expected = Buffer.from(this.sign(key, expiresAt));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private sign(key: string, expiresAt: number): string {
    return createHmac('sha256', this.signingSecret).update(`${key}:${expiresAt}`).digest('hex');
  }

  /** ใช้ใน test เพื่อล้างไฟล์ที่สร้างระหว่างทาง */
  async clear(): Promise<void> {
    await rm(join(this.root), { recursive: true, force: true });
  }
}
