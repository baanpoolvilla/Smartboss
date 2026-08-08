import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '@workforce/domain';
import type { ObjectStorage, PutObjectInput, SignedUrlOptions } from './object-storage';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  defaultTtlSeconds?: number;
}

/** อายุสูงสุดของ signed URL — ยาวกว่านี้ทำให้ลิงก์ที่หลุดออกไปยังใช้ได้นานเกินควร */
const MAX_TTL_SECONDS = 900;

export class S3ObjectStorage implements ObjectStorage {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultTtlSeconds: number;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.defaultTtlSeconds = Math.min(options.defaultTtlSeconds ?? 300, MAX_TTL_SECONDS);

    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
      ...(options.accessKeyId !== undefined && options.secretAccessKey !== undefined
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async put(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.metadata === undefined ? {} : { Metadata: input.metadata }),
        // ห้ามมี ACL: 'public-read' ที่ไหนก็ตาม (ADR-0010 ข้อ 1)
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (bytes === undefined) throw AppError.notFound('object');
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') throw AppError.notFound('object');
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async createSignedDownloadUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const ttl = Math.min(options.expiresInSeconds ?? this.defaultTtlSeconds, MAX_TTL_SECONDS);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(options.downloadFileName === undefined
        ? {}
        : { ResponseContentDisposition: `attachment; filename="${options.downloadFileName}"` }),
    });
    return getSignedUrl(this.client, command, { expiresIn: ttl });
  }
}
