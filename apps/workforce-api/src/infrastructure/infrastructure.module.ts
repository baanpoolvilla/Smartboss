import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { getConfig, type AppConfig } from '@workforce/config';
import { createDatabaseFromUrl, type DatabaseHandle } from '@workforce/db';
import { SystemClock } from '@workforce/domain';
import { RequestContextService } from '../shared/request-context';
import { APP_CONFIG, CLOCK, DATABASE_HANDLE, OBJECT_STORAGE } from '../shared/tokens';
import { FieldEncryptionService } from './crypto/field-encryption';
import { FilesystemObjectStorage } from './storage/filesystem-object-storage';
import type { ObjectStorage } from './storage/object-storage';
import { S3ObjectStorage } from './storage/s3-object-storage';
import { UnitOfWork } from './unit-of-work';

function createObjectStorage(config: AppConfig): ObjectStorage {
  if (config.STORAGE_DRIVER === 's3') {
    return new S3ObjectStorage({
      bucket: config.STORAGE_BUCKET as string,
      region: config.STORAGE_REGION as string,
      ...(config.STORAGE_ENDPOINT === undefined ? {} : { endpoint: config.STORAGE_ENDPOINT }),
      ...(config.STORAGE_ACCESS_KEY_ID === undefined
        ? {}
        : { accessKeyId: config.STORAGE_ACCESS_KEY_ID }),
      ...(config.STORAGE_SECRET_ACCESS_KEY === undefined
        ? {}
        : { secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY }),
      forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
      defaultTtlSeconds: config.STORAGE_SIGNED_URL_TTL_SECONDS,
    });
  }

  return new FilesystemObjectStorage({
    root: config.STORAGE_FILESYSTEM_ROOT as string,
    // dev เท่านั้น — production ถูกบล็อกที่ config schema
    signingSecret: config.AUTH_LOCAL_SIGNING_SECRET ?? 'development-object-signing-secret',
    defaultTtlSeconds: config.STORAGE_SIGNED_URL_TTL_SECONDS,
  });
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => getConfig() },
    {
      provide: DATABASE_HANDLE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DatabaseHandle =>
        createDatabaseFromUrl({
          databaseUrl: config.DATABASE_URL,
          isProduction: config.isProduction,
          poolMax: config.DATABASE_POOL_MAX,
          statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
          ssl: config.DATABASE_SSL,
        }),
    },
    { provide: CLOCK, useFactory: () => new SystemClock() },
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ObjectStorage => createObjectStorage(config),
    },
    RequestContextService,
    UnitOfWork,
    FieldEncryptionService,
  ],
  exports: [
    APP_CONFIG,
    DATABASE_HANDLE,
    CLOCK,
    OBJECT_STORAGE,
    RequestContextService,
    UnitOfWork,
    FieldEncryptionService,
  ],
})
export class InfrastructureModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  /** ปิด connection pool ตอน shutdown เพื่อให้ in-flight query จบก่อน process ตาย */
  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
