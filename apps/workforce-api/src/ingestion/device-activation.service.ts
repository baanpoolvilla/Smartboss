import { Inject, Injectable } from '@nestjs/common';
import { withSystemTransaction, type DatabaseHandle } from '@workforce/db';
import { AppError, hashActivationToken, uuidv7, type Clock } from '@workforce/domain';
import { DeviceRepository } from '../devices/device.repository';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { CLOCK, DATABASE_HANDLE } from '../shared/tokens';

@Injectable()
export class DeviceActivationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly devices: DeviceRepository,
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * แลก activation token เป็น credential ถาวรของเครื่อง
   *
   * รับประกัน:
   *   - token ใช้ได้ครั้งเดียว (UPDATE ... WHERE used_at IS NULL แล้วเช็คจำนวนแถว)
   *   - token หมดอายุแล้วใช้ไม่ได้ (spec §19.1 ข้อ 6)
   *   - เครื่องหนึ่งมี credential ที่ใช้งานได้ใบเดียว — activate ใหม่ = หมุนกุญแจ
   */
  async activate(input: {
    activation_token: string;
    public_key: string;
    firmware_version?: string;
  }): Promise<Record<string, unknown>> {
    const tokenHash = hashActivationToken(input.activation_token);

    // เครื่องยังไม่รู้ว่าตัวเองอยู่ tenant ไหน — ค้นหา token ข้าม tenant ผ่าน
    // SECURITY DEFINER function ที่คืนเฉพาะ field ที่จำเป็น (ดู migration 0002)
    const found = await withSystemTransaction(this.database.db, async (tx) =>
      this.devices.lookupActivationToken(tx, tokenHash),
    );

    if (found === undefined) throw AppError.unauthenticated('invalid activation token');

    const now = this.clock.now();
    if (found.usedAt !== null) throw AppError.unauthenticated('activation token was already used');
    if (found.expiresAt <= now) throw AppError.unauthenticated('activation token has expired');

    const publicKey = decodePublicKey(input.public_key);

    return this.uow.runAs(
      { type: 'SYSTEM', component: 'device-activation' },
      found.tenantId,
      async (uow) => {
        const claimed = await this.devices.markActivationTokenUsed(uow.tx, found.tokenId, now);
        if (claimed === 0) {
          // อีก request หนึ่งใช้ token นี้ไปก่อนแล้วเสี้ยววินาที
          throw AppError.unauthenticated('activation token was already used');
        }

        const device = await this.devices.lockDevice(uow.tx, found.deviceId);
        if (device === undefined) throw AppError.notFound('device');
        if (device.status === 'REVOKED') {
          throw AppError.unauthenticated('device has been revoked');
        }

        // หมุนกุญแจ: ใบเก่าถูก revoke ก่อน เพื่อไม่ชนกับ unique index ของ credential ที่ active
        await this.devices.revokeCredentials(uow.tx, device.id, now, 'replaced by re-activation');

        await this.devices.insertCredential(uow.tx, {
          id: uuidv7(),
          tenantId: found.tenantId,
          deviceId: device.id,
          publicKey,
          algorithm: 'ed25519',
          status: 'ACTIVE',
          activatedAt: now,
        });

        const updated = await this.devices.updateDevice(uow.tx, device.id, {
          status: 'ACTIVE',
          lastSeenAt: now,
          ...(input.firmware_version === undefined
            ? {}
            : { firmwareVersion: input.firmware_version }),
        });

        await uow.audit({
          action: 'device.activate',
          resourceType: 'device',
          resourceId: device.id,
          resourceVersion: updated?.version ?? device.version,
          outcome: 'SUCCESS',
          companyId: device.companyId,
          metadata: { firmware_version: input.firmware_version ?? null },
        });

        return {
          device_id: device.id,
          tenant_id: found.tenantId,
          company_id: device.companyId,
          device_code: device.deviceCode,
          time_zone: device.timeZone,
          config_version: device.configVersion,
          server_time: now.toISOString(),
        };
      },
    );
  }
}

function decodePublicKey(value: string): Buffer {
  const raw = Buffer.from(value, 'base64');
  // Ed25519 public key ดิบยาว 32 ไบต์; DER/SPKI ยาว 44 ไบต์
  if (raw.length !== 32 && raw.length !== 44) {
    throw AppError.validation('public_key must be a base64 ed25519 key (32 raw or 44 DER bytes)');
  }
  return raw;
}
