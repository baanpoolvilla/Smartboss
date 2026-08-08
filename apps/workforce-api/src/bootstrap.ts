import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_BASE_PATH } from '@workforce/contracts';
import type { AppConfig } from '@workforce/config';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './shared/problem.filter';
import { RequestContextService } from './shared/request-context';
import { APP_CONFIG } from './shared/tokens';

export interface BootstrapOptions {
  /** override สำหรับ test — ปกติปล่อยว่างให้ Nest สร้างจาก AppModule */
  moduleRef?: unknown;
}

export async function createApplication(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // trustProxy จำเป็นเพื่อให้ x-forwarded-for ถูกใช้เป็น client IP ที่ audit บันทึก
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    // rawBody จำเป็นต่อ DeviceAuthGuard — ลายเซ็นของเครื่องคำนวณจาก byte ดิบ
    // ไม่ใช่ JSON ที่ parse แล้ว ถ้าไม่เปิด request.rawBody จะเป็น undefined
    // แล้ว guard จะ hash สตริงว่าง ทำให้ทุก request ที่มี body ตรวจไม่ผ่าน
    rawBody: true,
  });

  return configureApplication(app);
}

export function configureApplication<T extends INestApplication>(app: T): T {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix(API_BASE_PATH);
  app.useGlobalFilters(new ProblemDetailsFilter(app.get(RequestContextService)));
  app.enableShutdownHooks();

  // CORS: allowlist จาก config เท่านั้น ไม่มี wildcard ใน production (บังคับที่ config schema)
  if (config.corsAllowedOrigins.length > 0) {
    app.enableCors({
      origin: config.corsAllowedOrigins,
      credentials: true,
      allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-request-id', 'if-match'],
      exposedHeaders: ['x-request-id', 'idempotency-replayed'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  }

  return app;
}

export async function startApplication(): Promise<void> {
  const app = await createApplication();
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = new Logger('bootstrap');

  await app.listen(config.HTTP_PORT, config.HTTP_HOST);
  logger.log(
    `${config.SERVICE_NAME} listening on ${config.HTTP_HOST}:${String(config.HTTP_PORT)}${API_BASE_PATH} ` +
      `(env=${config.NODE_ENV}, auth=${config.AUTH_PROVIDER}, storage=${config.STORAGE_DRIVER})`,
  );
}
