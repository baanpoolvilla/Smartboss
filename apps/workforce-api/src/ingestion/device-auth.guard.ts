import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '@workforce/config';
import { withSystemTransaction, type DatabaseHandle } from '@workforce/db';
import {
  AppError,
  isRequestTimestampFresh,
  isUuid,
  verifyDeviceSignature,
  type Clock,
  type DeviceIdentity,
} from '@workforce/domain';
import type { FastifyRequest } from 'fastify';
import { DeviceRepository } from '../devices/device.repository';
import { APP_CONFIG, CLOCK, DATABASE_HANDLE } from '../shared/tokens';

export const DEVICE_ROUTE_KEY = 'workforce:device-route';

/**
 * Route ที่ authenticate ด้วยลายเซ็นของเครื่อง ไม่ใช่ JWT ของผู้ใช้
 *
 * ตั้ง metadata สองตัว: `DEVICE_ROUTE_KEY` ให้ DeviceAuthGuard ทำงาน และ
 * `PUBLIC_ROUTE_KEY` ให้ guard ของ principal ข้ามไป — route จึงไม่เคยอยู่ในสภาพ
 * "ไม่มีใครตรวจเลย"
 */
export const DeviceAuthenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(DEVICE_ROUTE_KEY, true);

export interface DeviceRequest extends FastifyRequest {
  device?: DeviceIdentity;
  /** เปิดด้วย `rawBody: true` ตอนสร้าง app — ต้องเซ็นบน byte ดิบ ไม่ใช่ JSON ที่ parse แล้ว */
  rawBody?: Buffer;
}

const DEVICE_ID_HEADER = 'x-device-id';
const SIGNATURE_HEADER = 'x-device-signature';
const TIMESTAMP_HEADER = 'x-device-timestamp';

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly devices: DeviceRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isDeviceRoute = this.reflector.getAllAndOverride<boolean>(DEVICE_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isDeviceRoute !== true) return true;

    const request = context.switchToHttp().getRequest<DeviceRequest>();

    const deviceId = header(request, DEVICE_ID_HEADER);
    const signature = header(request, SIGNATURE_HEADER);
    const timestamp = header(request, TIMESTAMP_HEADER);

    if (deviceId === null || signature === null || timestamp === null) {
      throw AppError.unauthenticated('device signature headers are missing');
    }
    if (!isUuid(deviceId)) throw AppError.unauthenticated('invalid device id');

    if (
      !isRequestTimestampFresh(
        timestamp,
        this.clock.now(),
        this.config.DEVICE_REQUEST_TIMESTAMP_TOLERANCE_SECONDS,
      )
    ) {
      // ลายเซ็นเก่าที่ถูกดักไว้ต้องใช้ซ้ำไม่ได้ตลอดกาล
      throw AppError.unauthenticated('device request timestamp is outside the accepted window');
    }

    const lookup = await withSystemTransaction(this.database.db, async (tx) =>
      this.devices.lookupDeviceAuth(tx, deviceId),
    );

    if (lookup === undefined) {
      // ไม่มีเครื่อง หรือไม่มี credential ที่ยังใช้ได้ — ตอบเหมือนกันทั้งสองกรณี
      throw AppError.unauthenticated('device is not activated');
    }
    if (lookup.deviceStatus !== 'ACTIVE') {
      throw AppError.unauthenticated('device is not active');
    }

    const verified = verifyDeviceSignature({
      request: {
        deviceId,
        timestamp,
        method: request.method,
        path: request.url.split('?')[0] ?? request.url,
        body: request.rawBody?.toString('utf8') ?? '',
      },
      signature: decodeSignature(signature),
      publicKeyRaw: lookup.publicKey,
    });

    if (!verified) throw AppError.unauthenticated('device signature verification failed');

    request.device = {
      deviceId,
      tenantId: lookup.tenantId,
      companyId: lookup.companyId,
      credentialId: deviceId,
      revokedAt: null,
    };

    return true;
  }
}

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.length > 0 ? single : null;
}

function decodeSignature(value: string): Buffer {
  try {
    return Buffer.from(value, 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}
