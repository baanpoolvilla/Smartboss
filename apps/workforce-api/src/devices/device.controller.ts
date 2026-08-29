import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  createDeviceSchema,
  deleteEnrollmentSchema,
  issueActivationTokenSchema,
  listDevicesQuerySchema,
  requestEnrollmentSchema,
  revokeDeviceSchema,
  type BiometricEnrollment,
  type CreateDeviceInput,
  type Device,
} from '@workforce/contracts';
import type { z } from 'zod';
import { requireUuid } from '../organization/organization.controller';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { decodeCursor, type PageResult } from '../shared/pagination';
import { zodPipe } from '../shared/zod-validation.pipe';
import { DeviceService } from './device.service';

@Controller()
export class DeviceController {
  constructor(private readonly service: DeviceService) {}

  @Get('devices')
  @RequirePermissions('workforce.devices.read')
  async list(
    @Query(zodPipe(listDevicesQuerySchema)) query: z.infer<typeof listDevicesQuerySchema>,
  ): Promise<PageResult<Device>> {
    return this.service.listDevices({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.company_id === undefined ? {} : { companyId: query.company_id }),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
  }

  @Post('devices')
  @HttpCode(201)
  @RequirePermissions('workforce.devices.manage')
  @Idempotent()
  async create(@Body(zodPipe(createDeviceSchema)) body: CreateDeviceInput): Promise<Device> {
    return this.service.createDevice(body);
  }

  @Get('devices/:deviceId')
  @RequirePermissions('workforce.devices.read')
  async get(@Param('deviceId') deviceId: string): Promise<Device> {
    return this.service.getDevice(requireUuid(deviceId, 'deviceId'));
  }

  @Post('devices/:deviceId/activation-tokens')
  @HttpCode(201)
  @RequirePermissions('workforce.devices.manage')
  @Idempotent()
  async issueActivationToken(
    @Param('deviceId') deviceId: string,
    @Body(zodPipe(issueActivationTokenSchema)) body: z.infer<typeof issueActivationTokenSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.issueActivationToken(requireUuid(deviceId, 'deviceId'), body.ttl_seconds);
  }

  @Post('devices/:deviceId/revoke')
  @HttpCode(200)
  @RequirePermissions('workforce.devices.revoke')
  @Idempotent()
  async revoke(
    @Param('deviceId') deviceId: string,
    @Body(zodPipe(revokeDeviceSchema)) body: z.infer<typeof revokeDeviceSchema>,
  ): Promise<Device> {
    return this.service.revokeDevice(requireUuid(deviceId, 'deviceId'), body.reason);
  }

  /**
   * รายการสแกนดิบ — ใครแตะเครื่องเมื่อไหร่
   *
   * ใช้สิทธิ์เดียวกับผลลงเวลาของทั้งบริษัท ไม่ใช่สิทธิ์เครื่องสแกน เพราะนี่คือ
   * ข้อมูลการมาทำงานของคน ไม่ใช่สถานะฮาร์ดแวร์
   */
  @Get('raw-time-events')
  @RequirePermissions('workforce.attendance.read.all')
  async listRawTimeEvents(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('employment_id') employmentId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    const parsed = Number(limit ?? 200);
    return this.service.listRawTimeEvents({
      from,
      to,
      ...(employmentId === undefined
        ? {}
        : { employmentId: requireUuid(employmentId, 'employment_id') }),
      limit: Number.isInteger(parsed) && parsed > 0 && parsed <= 500 ? parsed : 200,
    });
  }

  @Get('biometric-enrollments')
  @RequirePermissions('workforce.devices.read')
  async listEnrollments(
    @Query('employment_id') employmentId: string | undefined,
    @Query('device_id') deviceId: string | undefined,
  ): Promise<PageResult<BiometricEnrollment>> {
    return this.service.listEnrollments({
      ...(employmentId === undefined ? {} : { employmentId: requireUuid(employmentId, 'employment_id') }),
      ...(deviceId === undefined ? {} : { deviceId: requireUuid(deviceId, 'device_id') }),
    });
  }

  @Post('biometric-enrollments')
  @HttpCode(202)
  @RequirePermissions('workforce.devices.enroll-biometric')
  @Idempotent()
  async requestEnrollment(
    @Body(zodPipe(requestEnrollmentSchema)) body: z.infer<typeof requestEnrollmentSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.requestEnrollment(body);
  }

  /**
   * ลบลายนิ้วมือของพนักงานออกจากทุกเครื่อง
   * สร้าง deletion job + command ต่อเครื่อง แล้วรอ ACK (spec §6.2)
   */
  @Post('employments/:employmentId/biometric-enrollments:delete')
  @HttpCode(202)
  @RequirePermissions('workforce.devices.enroll-biometric')
  @Idempotent()
  async deleteEnrollments(
    @Param('employmentId') employmentId: string,
    @Body(zodPipe(deleteEnrollmentSchema)) body: z.infer<typeof deleteEnrollmentSchema>,
  ): Promise<{ jobs: number }> {
    return this.service.deleteEnrollmentsForEmployment(
      requireUuid(employmentId, 'employmentId'),
      body.reason,
    );
  }
}
