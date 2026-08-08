import { uuidv7 } from '@workforce/domain';

export type StorageCategory = 'CHECKIN_PHOTO' | 'PAYSLIP' | 'IMPORT' | 'EXPORT' | 'ATTACHMENT';

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface SignedUrlOptions {
  expiresInSeconds?: number;
  downloadFileName?: string;
}

/**
 * Port ของ object storage (ADR-0010)
 *
 * ไม่มี method ที่คืน public URL โดยเจตนา — การเข้าถึงทำผ่าน signed URL อายุสั้น
 * ที่ต้องผ่าน authorization + audit ก่อนเสมอ
 */
export interface ObjectStorage {
  readonly driver: 's3' | 'filesystem';
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  createSignedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string>;
}

/**
 * สร้าง object key ที่ไม่มีข้อมูลระบุตัวตน (ADR-0010 ข้อ 4)
 * ห้ามใส่ชื่อ, เลขบัตร หรือ employee code ลงใน path
 */
export function buildObjectKey(
  tenantId: string,
  category: StorageCategory,
  extension: string,
  now: Date = new Date(),
): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `${tenantId}/${year}/${month}/${day}/${category.toLowerCase()}/${uuidv7()}.${safeExtension}`;
}

/** ไฟล์ที่เพิ่ง upload ยังไม่ผ่านการตรวจ อยู่ใน prefix แยกจนกว่าจะ promote (spec §14) */
export function quarantineKey(key: string): string {
  return `quarantine/${key}`;
}
