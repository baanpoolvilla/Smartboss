import { Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import {
  ackCommandSchema,
  deviceActivationRequestSchema,
  deviceBatchSchema,
  heartbeatSchema,
  legacyAttendanceSchema,
  type DeviceBatch,
  type IngestResult,
} from '@workforce/contracts';
import { AppError, type DeviceIdentity } from '@workforce/domain';
import type { z } from 'zod';
import { Public } from '../shared/decorators';
import { zodPipe } from '../shared/zod-validation.pipe';
import { DeviceActivationService } from './device-activation.service';
import { DeviceAuthenticated, type DeviceRequest } from './device-auth.guard';
import { IngestionService } from './ingestion.service';

/**
 * Boundary ของ device ingestion — แยกจาก business API โดยเจตนา (spec §1.2)
 *
 * ทุก route ที่นี่ authenticate ด้วยลายเซ็นของเครื่อง ไม่ใช่ JWT ของผู้ใช้
 * และไม่มี route ไหนที่อ่านหรือแก้ข้อมูลธุรกิจนอกเหนือจากเวลาที่เครื่องส่งมา
 */
@Controller('device-ingestion')
export class DeviceIngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly activation: DeviceActivationService,
  ) {}

  @Post('time-events:batch')
  @DeviceAuthenticated()
  @Public()
  async ingestBatch(
    @Req() request: DeviceRequest,
    @Body(zodPipe(deviceBatchSchema)) body: DeviceBatch,
  ): Promise<IngestResult> {
    return this.ingestion.ingestBatch(requireDevice(request), body);
  }

  @Post('heartbeats')
  @DeviceAuthenticated()
  @Public()
  async heartbeat(
    @Req() request: DeviceRequest,
    @Body(zodPipe(heartbeatSchema)) body: z.infer<typeof heartbeatSchema>,
  ): Promise<{ server_time: string; clock_drift_ms: number }> {
    return this.ingestion.recordHeartbeat(requireDevice(request), body);
  }

  @Get('sync-state')
  @DeviceAuthenticated()
  @Public()
  async syncState(@Req() request: DeviceRequest): Promise<Record<string, unknown>> {
    return this.ingestion.getSyncState(requireDevice(request));
  }

  @Get('commands')
  @DeviceAuthenticated()
  @Public()
  async commands(@Req() request: DeviceRequest): Promise<{ items: unknown[] }> {
    return { items: await this.ingestion.fetchCommands(requireDevice(request)) };
  }

  @Post('commands:ack')
  @DeviceAuthenticated()
  @Public()
  async ackCommand(
    @Req() request: DeviceRequest,
    @Body(zodPipe(ackCommandSchema)) body: z.infer<typeof ackCommandSchema>,
  ): Promise<{ status: string }> {
    return this.ingestion.ackCommand(requireDevice(request), body);
  }
}

@Controller()
export class DeviceActivationController {
  constructor(private readonly activation: DeviceActivationService) {}

  /**
   * เครื่องแลก activation token กับการลงทะเบียน public key ของตัวเอง
   *
   * เป็น endpoint เดียวในกลุ่มนี้ที่ไม่ต้องมีลายเซ็น เพราะเครื่องยังไม่มี credential
   * — ความปลอดภัยมาจาก token ที่ใช้ครั้งเดียวและมีวันหมดอายุ
   */
  @Post('device-activation')
  @Public()
  @HttpCode(200)
  async activate(
    @Body(zodPipe(deviceActivationRequestSchema))
    body: z.infer<typeof deviceActivationRequestSchema>,
  ): Promise<Record<string, unknown>> {
    return this.activation.activate(body);
  }
}

@Controller('legacy')
export class LegacyIngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /**
   * รูปแบบเดียวกับ `POST /api/attendance` ของระบบเดิม (spec §13)
   * ต้องปิดหลัง cutover — ตั้ง `LEGACY_INGEST_KEY` ว่างไว้เพื่อปิด
   */
  @Post('attendance')
  @Public()
  @HttpCode(200)
  async legacyAttendance(
    @Headers('x-legacy-ingest-key') key: string | undefined,
    @Body(zodPipe(legacyAttendanceSchema)) body: z.infer<typeof legacyAttendanceSchema>,
  ): Promise<{ event_id: string; status: string }> {
    return this.ingestion.ingestLegacy({
      deviceCode: body.device_id,
      fingerId: body.finger_id,
      presentedKey: key ?? null,
    });
  }
}

function requireDevice(request: DeviceRequest): DeviceIdentity {
  if (request.device === undefined) {
    throw AppError.internal('device identity is missing after authentication');
  }
  return request.device;
}
