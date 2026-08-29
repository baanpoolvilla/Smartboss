import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { BiometricEnrollment, CreateDeviceInput, Device } from '@workforce/contracts';
import type { schema } from '@workforce/db';
import { AppError, hashActivationToken, uuidv7, type Clock } from '@workforce/domain';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { buildPage, fetchLimit, type PageResult } from '../shared/pagination';
import { CLOCK } from '../shared/tokens';
import { DeviceRepository } from './device.repository';

type DeviceRow = typeof schema.devices.$inferSelect;
type EnrollmentRow = typeof schema.biometricEnrollments.$inferSelect;

@Injectable()
export class DeviceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: DeviceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * รายการสแกนดิบ — ใครแตะเครื่องเมื่อไหร่ ที่เครื่องไหน
   *
   * ไม่มี endpoint นี้มาก่อน: การสแกนถูกเก็บครบทุกครั้งแต่ไม่มีทางเปิดดูเลย
   * เห็นได้แค่ผลที่คำนวณแล้ว ซึ่งไม่ช่วยตอนเครื่องมีปัญหา — พนักงานบอกว่า
   * "สแกนแล้ว" แต่ผลลงเวลาไม่ขึ้น จะแยกไม่ออกว่าเครื่องไม่ส่ง หรือส่งแล้ว
   * แต่ยังไม่ได้สั่งคำนวณ หรือ slot ไม่ได้ผูกกับใคร
   *
   * ส่ง slot_resolved มาด้วยเสมอ เพราะนั่นคือคำตอบของกรณีที่สามและเป็น
   * สาเหตุที่พบบ่อยที่สุด
   */
  async listRawTimeEvents(query: {
    from: string;
    to: string;
    employmentId?: string;
    limit: number;
  }): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listRawTimeEvents(uow.tx, query);
      return { items: rows };
    });
  }

  async createDevice(input: CreateDeviceInput): Promise<Device> {
    return this.uow.run(async (uow) => {
      const row = await this.repository.insertDevice(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: input.company_id,
        deviceCode: input.device_code,
        name: input.name,
        siteId: input.site_id,
        deviceType: input.device_type,
        timeZone: input.time_zone,
        status: 'PENDING',
      });

      await uow.audit({
        action: 'device.provision',
        resourceType: 'device',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: row.companyId,
        after: { device_code: row.deviceCode, name: row.name, status: row.status },
      });

      return toDevice(row, false);
    });
  }

  async listDevices(query: {
    cursor: string | null;
    limit: number;
    companyId?: string;
    status?: string;
  }): Promise<PageResult<Device>> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listDevices(uow.tx, {
        cursor: query.cursor,
        limit: fetchLimit(query.limit),
        ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
        ...(query.status === undefined ? {} : { status: query.status }),
      });
      const page = buildPage(rows, query.limit);

      const items: Device[] = [];
      for (const row of page.items) {
        const credential = await this.repository.findActiveCredential(uow.tx, row.id);
        items.push(toDevice(row, credential !== undefined));
      }
      return { items, next_cursor: page.next_cursor };
    });
  }

  async getDevice(id: string): Promise<Device> {
    return this.uow.run(async (uow) => {
      const row = await this.repository.findDeviceById(uow.tx, id);
      if (row === undefined) throw AppError.notFound('device');
      const credential = await this.repository.findActiveCredential(uow.tx, id);
      return toDevice(row, credential !== undefined);
    });
  }

  /**
   * ออก activation token ที่ใช้ได้ครั้งเดียวและมีวันหมดอายุ
   *
   * token ตัวจริงถูกส่งกลับครั้งเดียวและไม่ถูกเก็บ — DB มีแค่ hash
   * แทนที่การใช้ shared key ที่ hard-code ใน firmware (spec §3.3 C3)
   */
  async issueActivationToken(
    deviceId: string,
    ttlSeconds: number,
  ): Promise<{ device_id: string; activation_token: string; expires_at: string }> {
    return this.uow.run(async (uow) => {
      const device = await this.repository.findDeviceById(uow.tx, deviceId);
      if (device === undefined) throw AppError.notFound('device');
      if (device.status === 'REVOKED') {
        throw AppError.conflict('cannot issue an activation token for a revoked device');
      }

      const token = `wfd_${randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(this.clock.now().getTime() + ttlSeconds * 1000);

      await this.repository.insertActivationToken(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        deviceId,
        tokenHash: hashActivationToken(token),
        expiresAt,
      });

      await uow.audit({
        action: 'device.activation-token.issue',
        resourceType: 'device',
        resourceId: deviceId,
        outcome: 'SUCCESS',
        companyId: device.companyId,
        // ไม่บันทึก token ลง audit — บันทึกแค่ว่าออกให้เมื่อไรและหมดอายุเมื่อไร
        metadata: { expires_at: expiresAt.toISOString(), ttl_seconds: ttlSeconds },
      });

      return {
        device_id: deviceId,
        activation_token: token,
        expires_at: expiresAt.toISOString(),
      };
    });
  }

  async revokeDevice(deviceId: string, reason: string): Promise<Device> {
    return this.uow.run(async (uow) => {
      const device = await this.repository.lockDevice(uow.tx, deviceId);
      if (device === undefined) throw AppError.notFound('device');

      const revokedCount = await this.repository.revokeCredentials(
        uow.tx,
        deviceId,
        this.clock.now(),
        reason,
      );
      const updated = await this.repository.updateDevice(uow.tx, deviceId, { status: 'REVOKED' });
      if (updated === undefined) throw AppError.notFound('device');

      await uow.audit({
        action: 'device.credential.revoke',
        resourceType: 'device',
        resourceId: deviceId,
        resourceVersion: updated.version,
        outcome: 'SUCCESS',
        companyId: device.companyId,
        reason,
        before: { status: device.status },
        after: { status: updated.status, credentials_revoked: revokedCount },
      });

      await uow.publish({
        aggregateType: 'device',
        aggregateId: deviceId,
        eventType: 'device.revoked',
        payload: { device_id: deviceId, reason },
      });

      return toDevice(updated, false);
    });
  }

  // --- biometric enrolment ---

  /**
   * สั่งให้เครื่องลงทะเบียนนิ้ว
   *
   * ระบบเดิมใช้ตัวแปร in-memory ที่หายเมื่อ restart และแยกเครื่องไม่ได้ (spec §3.3 S6)
   * ที่นี่เป็น command ที่มี nonce + วันหมดอายุ + ผูกกับเครื่องเจาะจง (spec §6.2)
   */
  async requestEnrollment(input: {
    employment_id: string;
    device_id: string;
    template_slot: number;
    finger_position: string | null;
    ttl_seconds: number;
  }): Promise<{ command_id: string; enrollment_id: string; expires_at: string }> {
    return this.uow.run(async (uow) => {
      const device = await this.repository.findDeviceById(uow.tx, input.device_id);
      if (device === undefined) throw AppError.notFound('device');
      if (device.status !== 'ACTIVE') {
        throw AppError.conflict('device must be activated before enrolling biometrics');
      }

      const occupied = await this.repository.findEnrollmentBySlot(
        uow.tx,
        input.device_id,
        input.template_slot,
      );
      if (occupied !== undefined) {
        // slot ค้างของคนเก่าคือสาเหตุที่ทำให้เครื่อง match ผิดคน
        throw AppError.conflict('template slot is already assigned on this device');
      }

      const enrollment = await this.repository.insertEnrollment(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        employmentId: input.employment_id,
        deviceId: input.device_id,
        templateSlot: input.template_slot,
        fingerPosition: input.finger_position,
        status: 'PENDING',
      });

      const nonce = randomBytes(16);
      const expiresAt = new Date(this.clock.now().getTime() + input.ttl_seconds * 1000);

      const command = await this.repository.insertCommand(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        deviceId: input.device_id,
        commandType: 'ENROLL_BIOMETRIC',
        payload: { enrollment_id: enrollment.id, template_slot: input.template_slot },
        nonce,
        expiresAt,
        reason: 'biometric enrolment requested',
      });

      await uow.audit({
        action: 'biometric.enrollment.request',
        resourceType: 'biometric_enrollment',
        resourceId: enrollment.id,
        outcome: 'SUCCESS',
        companyId: device.companyId,
        metadata: {
          device_id: input.device_id,
          template_slot: input.template_slot,
          expires_at: expiresAt.toISOString(),
        },
      });

      return {
        command_id: command.id,
        enrollment_id: enrollment.id,
        expires_at: expiresAt.toISOString(),
      };
    });
  }

  async listEnrollments(filters: {
    employmentId?: string;
    deviceId?: string;
  }): Promise<PageResult<BiometricEnrollment>> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listEnrollments(uow.tx, filters);
      return { items: rows.map(toEnrollment), next_cursor: null };
    });
  }

  /**
   * ลบลายนิ้วมือ — สร้าง deletion job ไปทุกเครื่องที่มี template ของคนนี้
   *
   * spec §6.2: offboarding ต้องสร้าง deletion job ทุก device และรอ ACK
   * การลบแถวใน DB อย่างเดียวไม่พอ เพราะ template ตัวจริงอยู่ในเซนเซอร์
   */
  async deleteEnrollmentsForEmployment(
    employmentId: string,
    reason: string,
  ): Promise<{ jobs: number }> {
    return this.uow.run(async (uow) => {
      const enrollments = await this.repository.listEnrollments(uow.tx, { employmentId });
      const active = enrollments.filter((row) => row.status !== 'DELETED');

      let jobs = 0;
      for (const enrollment of active) {
        const nonce = randomBytes(16);
        const expiresAt = new Date(this.clock.now().getTime() + 7 * 86_400_000);

        const command = await this.repository.insertCommand(uow.tx, {
          id: uuidv7(),
          tenantId: uow.tenantId,
          deviceId: enrollment.deviceId,
          commandType: 'DELETE_BIOMETRIC',
          payload: { enrollment_id: enrollment.id, template_slot: enrollment.templateSlot },
          nonce,
          expiresAt,
          reason,
        });

        await this.repository.insertDeletionJob(uow.tx, {
          id: uuidv7(),
          tenantId: uow.tenantId,
          employmentId,
          deviceId: enrollment.deviceId,
          enrollmentId: enrollment.id,
          commandId: command.id,
          reason,
          status: 'PENDING',
        });

        jobs += 1;
      }

      await uow.audit({
        action: 'biometric.enrollment.delete',
        resourceType: 'employment',
        resourceId: employmentId,
        outcome: 'SUCCESS',
        reason,
        metadata: { deletion_jobs: jobs },
      });

      return { jobs };
    });
  }
}

function toDevice(row: DeviceRow, hasActiveCredential: boolean): Device {
  return {
    id: row.id,
    company_id: row.companyId,
    device_code: row.deviceCode,
    name: row.name,
    site_id: row.siteId,
    device_type: row.deviceType,
    status: row.status as Device['status'],
    time_zone: row.timeZone,
    firmware_version: row.firmwareVersion,
    config_version: row.configVersion,
    last_seen_at: row.lastSeenAt?.toISOString() ?? null,
    has_active_credential: hasActiveCredential,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toEnrollment(row: EnrollmentRow): BiometricEnrollment {
  return {
    id: row.id,
    employment_id: row.employmentId,
    device_id: row.deviceId,
    template_slot: row.templateSlot,
    template_version: row.templateVersion,
    quality: row.quality,
    finger_position: row.fingerPosition,
    status: row.status as BiometricEnrollment['status'],
    enrolled_at: row.enrolledAt?.toISOString() ?? null,
    deleted_at: row.deletedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    // ไม่มี field ไหนที่คืน template หรือ hash ของ template ออก API
  };
}
