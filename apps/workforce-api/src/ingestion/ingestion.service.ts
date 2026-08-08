import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import type { DeviceBatch, DeviceTimeEvent, IngestResult } from '@workforce/contracts';
import { schema, withSystemTransaction, type DatabaseHandle, type Tx } from '@workforce/db';
import {
  AppError,
  assessClockDrift,
  assessOfflineAge,
  computeEventPayloadHash,
  safeCompare,
  uuidv7,
  type Clock,
  type DeviceIdentity,
  type EventIntent,
  type TimeEventEnvelope,
} from '@workforce/domain';
import { and, eq, sql } from 'drizzle-orm';
import { DeviceRepository } from '../devices/device.repository';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { APP_CONFIG, CLOCK, DATABASE_HANDLE } from '../shared/tokens';

interface EventOutcome {
  status: 'ACCEPTED' | 'DUPLICATE' | 'QUARANTINED';
  sequence: number;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly devices: DeviceRepository,
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * รับ batch จากเครื่องสแกน
   *
   * คุณสมบัติที่ต้องรักษา (spec §6.1, §17, §19.1):
   *   - event loss = 0 : ACK หลัง commit เท่านั้น
   *   - duplicate = 0  : (source_id, sequence) unique + เทียบ payload hash
   *   - sequence ซ้ำแต่ payload ต่าง → quarantine ไม่ทับของเดิม ไม่ทิ้งเงียบ
   *   - captured_at จากเครื่องคือเวลาทำงาน; เวลาที่ server ได้รับใช้ตรวจ drift เท่านั้น
   */
  async ingestBatch(device: DeviceIdentity, batch: DeviceBatch): Promise<IngestResult> {
    const receivedAt = this.clock.now();
    const drift = assessClockDrift(
      new Date(batch.device_time),
      receivedAt,
      this.config.DEVICE_CLOCK_DRIFT_TOLERANCE_MS,
    );

    const actor = { type: 'DEVICE' as const, device };

    return this.uow.runAs(actor, device.tenantId, async (uow) => {
      const sequences = batch.events.map((event) => event.sequence);
      const batchRowId = uuidv7();

      const outcomes: EventOutcome[] = [];
      for (const event of batch.events) {
        outcomes.push(
          await this.ingestOne(uow.tx, device, event, {
            batchRowId,
            receivedAt,
            driftMs: drift.driftMs,
          }),
        );
      }

      const accepted = outcomes.filter((outcome) => outcome.status === 'ACCEPTED').length;
      const duplicates = outcomes.filter((outcome) => outcome.status === 'DUPLICATE').length;
      const quarantined = outcomes.filter((outcome) => outcome.status === 'QUARANTINED').length;

      // ACK เฉพาะ event ที่จัดการเสร็จแล้วจริง — quarantine ก็ถือว่าจัดการแล้ว
      // เครื่องจึงลบออกจากคิวได้ ไม่ส่งวนซ้ำไม่รู้จบ
      const ackedSequence = outcomes.length > 0 ? Math.max(...sequences) : null;

      await uow.tx.insert(schema.deviceIngestBatches).values({
        id: batchRowId,
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        receivedAt,
        eventCount: batch.events.length,
        acceptedCount: accepted,
        duplicateCount: duplicates,
        quarantinedCount: quarantined,
        minSequence: sequences.length > 0 ? Math.min(...sequences) : null,
        maxSequence: sequences.length > 0 ? Math.max(...sequences) : null,
        ackedSequence,
        clockDriftMs: drift.driftMs,
      });

      await this.devices.updateDevice(uow.tx, device.deviceId, {
        lastSeenAt: receivedAt,
        ...(batch.firmware_version === undefined ? {} : { firmwareVersion: batch.firmware_version }),
      });

      if (drift.isAnomalous) {
        // ไม่แก้เวลาที่เครื่องบันทึกไว้ แต่ต้องมีร่องรอยว่านาฬิกาเพี้ยน (spec §6.2)
        await uow.audit({
          action: 'device.clock.anomaly',
          resourceType: 'device',
          resourceId: device.deviceId,
          outcome: 'SUCCESS',
          companyId: device.companyId,
          metadata: { drift_ms: drift.driftMs, batch_id: batch.batch_id },
        });
      }

      if (quarantined > 0) {
        await uow.audit({
          action: 'time-event.quarantine',
          resourceType: 'device',
          resourceId: device.deviceId,
          outcome: 'FAILED',
          companyId: device.companyId,
          metadata: { batch_id: batch.batch_id, quarantined },
        });
      }

      return {
        batch_id: batch.batch_id,
        accepted,
        duplicates,
        quarantined,
        acked_sequence: ackedSequence,
        server_time: receivedAt.toISOString(),
        clock_drift_ms: drift.driftMs,
      };
    });
  }

  private async ingestOne(
    tx: Tx,
    device: DeviceIdentity,
    event: DeviceTimeEvent,
    context: { batchRowId: string; receivedAt: Date; driftMs: number },
  ): Promise<EventOutcome> {
    // slot → employment; slot ที่ไม่รู้จักยังบันทึกเป็นหลักฐาน แต่ employment เป็น null
    // จึงไม่กลายเป็นเวลาทำงาน (ระบบเดิมสร้าง log ให้ 'Unknown' — spec §3.3 C9)
    let employmentId: string | null = null;
    if (event.template_slot !== null) {
      const enrollment = await this.devices.findEnrollmentBySlot(
        tx,
        device.deviceId,
        event.template_slot,
      );
      employmentId = enrollment?.employmentId ?? null;
    }

    const capturedAt = new Date(event.captured_at);
    const offline = assessOfflineAge(
      capturedAt,
      context.receivedAt,
      this.config.OFFLINE_EVENT_MAX_AGE_MINUTES,
    );

    const envelope: TimeEventEnvelope = {
      event_id: event.event_id,
      employment_id: employmentId,
      source_type: 'FINGERPRINT_DEVICE',
      source_id: device.deviceId,
      event_intent: event.event_intent as EventIntent,
      captured_at: event.captured_at,
      timezone: event.timezone,
      sequence: event.sequence,
      evidence: { ...event.evidence, template_slot: event.template_slot },
      client_context: {},
    };
    const payloadHash = computeEventPayloadHash(envelope);

    const inserted = await tx
      .insert(schema.rawTimeEvents)
      .values({
        id: event.event_id,
        tenantId: device.tenantId,
        companyId: device.companyId,
        employmentId,
        sourceType: 'FINGERPRINT_DEVICE',
        sourceId: device.deviceId,
        eventIntent: event.event_intent,
        capturedAt,
        timeZone: event.timezone,
        receivedAt: context.receivedAt,
        sequence: event.sequence,
        payloadHash,
        evidence: {
          ...event.evidence,
          template_slot: event.template_slot,
          slot_resolved: employmentId !== null,
          offline_age_minutes: Math.round(offline.ageMinutes),
          offline_too_old: offline.isTooOld,
        },
        clientContext: { clock_drift_ms: context.driftMs },
        status: 'ACCEPTED',
        ingestBatchId: context.batchRowId,
      })
      // ON CONFLICT DO NOTHING ไม่ทำให้ transaction abort — จึงประมวลผล event
      // ที่เหลือใน batch ต่อได้ โดยไม่ต้องใช้ savepoint ต่อรายการ
      .onConflictDoNothing()
      .returning({ id: schema.rawTimeEvents.id });

    if (inserted.length > 0) return { status: 'ACCEPTED', sequence: event.sequence };

    // ชนกับของเดิม — ต้องแยกว่าเป็น retry ที่ปลอดภัย หรือของใหม่ที่อ้าง sequence ซ้ำ
    const existingRows = await tx
      .select({
        id: schema.rawTimeEvents.id,
        payloadHash: schema.rawTimeEvents.payloadHash,
      })
      .from(schema.rawTimeEvents)
      .where(
        and(
          eq(schema.rawTimeEvents.sourceId, device.deviceId),
          eq(schema.rawTimeEvents.sequence, event.sequence),
        ),
      )
      .limit(1);

    const existing = existingRows[0];
    if (existing !== undefined && safeCompare(Buffer.from(existing.payloadHash), payloadHash)) {
      // retry ของ batch เดิม — ตอบสำเร็จแบบ idempotent (spec §6.1)
      return { status: 'DUPLICATE', sequence: event.sequence };
    }

    await tx.insert(schema.rawTimeEventQuarantine).values({
      id: uuidv7(),
      tenantId: device.tenantId,
      sourceType: 'FINGERPRINT_DEVICE',
      sourceId: device.deviceId,
      sequence: event.sequence,
      claimedEventId: event.event_id,
      existingEventId: existing?.id ?? null,
      reason:
        existing === undefined
          ? 'EVENT_ID_ALREADY_USED'
          : 'SEQUENCE_REUSED_WITH_DIFFERENT_PAYLOAD',
      payload: envelope as unknown as Record<string, unknown>,
      payloadHash,
      receivedAt: context.receivedAt,
    });

    this.logger.warn(
      `quarantined event from device ${device.deviceId} sequence ${String(event.sequence)}`,
    );
    return { status: 'QUARANTINED', sequence: event.sequence };
  }

  async recordHeartbeat(
    device: DeviceIdentity,
    input: {
      device_time: string;
      queue_depth: number;
      template_count: number;
      firmware_version?: string;
      config_version?: number;
      metrics: Record<string, unknown>;
    },
  ): Promise<{ server_time: string; clock_drift_ms: number }> {
    const receivedAt = this.clock.now();
    const drift = assessClockDrift(
      new Date(input.device_time),
      receivedAt,
      this.config.DEVICE_CLOCK_DRIFT_TOLERANCE_MS,
    );

    return this.uow.runAs({ type: 'DEVICE', device }, device.tenantId, async (uow) => {
      await this.devices.insertHeartbeat(uow.tx, {
        id: uuidv7(),
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        reportedAt: new Date(input.device_time),
        receivedAt,
        clockDriftMs: drift.driftMs,
        queueDepth: input.queue_depth,
        templateCount: input.template_count,
        firmwareVersion: input.firmware_version ?? null,
        configVersion: input.config_version ?? null,
        metrics: input.metrics,
      });

      await this.devices.updateDevice(uow.tx, device.deviceId, {
        lastSeenAt: receivedAt,
        ...(input.firmware_version === undefined
          ? {}
          : { firmwareVersion: input.firmware_version }),
      });

      return { server_time: receivedAt.toISOString(), clock_drift_ms: drift.driftMs };
    });
  }

  async getSyncState(device: DeviceIdentity): Promise<{
    device_id: string;
    acked_sequence: number | null;
    config_version: number;
    pending_command_count: number;
    server_time: string;
  }> {
    return this.uow.runAs({ type: 'DEVICE', device }, device.tenantId, async (uow) => {
      const result = await uow.tx.execute(sql`
        SELECT max(sequence) AS acked
        FROM workforce.raw_time_events
        WHERE source_id = ${device.deviceId}
      `);
      const acked = (result.rows[0] as { acked: number | string | null } | undefined)?.acked ?? null;

      const deviceRow = await this.devices.findDeviceById(uow.tx, device.deviceId);
      const commands = await this.devices.listPendingCommands(
        uow.tx,
        device.deviceId,
        this.clock.now(),
      );

      return {
        device_id: device.deviceId,
        acked_sequence: acked === null ? null : Number(acked),
        config_version: deviceRow?.configVersion ?? 0,
        pending_command_count: commands.length,
        server_time: this.clock.now().toISOString(),
      };
    });
  }

  async fetchCommands(device: DeviceIdentity): Promise<
    {
      id: string;
      command_type: string;
      payload: Record<string, unknown>;
      nonce: string;
      expires_at: string;
      created_at: string;
    }[]
  > {
    return this.uow.runAs({ type: 'DEVICE', device }, device.tenantId, async (uow) => {
      const now = this.clock.now();
      const commands = await this.devices.listPendingCommands(uow.tx, device.deviceId, now);
      await this.devices.markCommandsDelivered(
        uow.tx,
        commands.map((command) => command.id),
        now,
      );

      return commands.map((command) => ({
        id: command.id,
        command_type: command.commandType,
        payload: command.payload as Record<string, unknown>,
        nonce: Buffer.from(command.nonce).toString('base64url'),
        expires_at: command.expiresAt.toISOString(),
        created_at: command.createdAt.toISOString(),
      }));
    });
  }

  /**
   * เครื่องรายงานผลของคำสั่ง
   *
   * nonce ใช้ได้ครั้งเดียว: คำสั่งที่ ACK แล้วหรือหมดอายุแล้วจะถูกปฏิเสธ
   * ป้องกันการเล่นซ้ำคำสั่งลงทะเบียนนิ้วเก่า (spec §19.1 ข้อ 6)
   */
  async ackCommand(
    device: DeviceIdentity,
    input: {
      nonce: string;
      outcome: 'SUCCESS' | 'FAILED';
      result: Record<string, unknown>;
      template_hash?: string;
      quality?: number;
    },
  ): Promise<{ status: string }> {
    return this.uow.runAs({ type: 'DEVICE', device }, device.tenantId, async (uow) => {
      const nonce = Buffer.from(input.nonce, 'base64url');
      const command = await this.devices.findCommandByNonce(uow.tx, device.deviceId, nonce);
      if (command === undefined) throw AppError.notFound('command');

      const now = this.clock.now();
      if (command.status === 'ACKED') throw AppError.conflict('command was already acknowledged');
      if (command.expiresAt <= now) {
        await this.devices.updateCommand(uow.tx, command.id, { status: 'EXPIRED' });
        throw AppError.conflict('command has expired');
      }

      await this.devices.updateCommand(uow.tx, command.id, {
        status: input.outcome === 'SUCCESS' ? 'ACKED' : 'FAILED',
        ackedAt: now,
        result: input.result,
      });

      const payload = command.payload as { enrollment_id?: string };

      if (command.commandType === 'ENROLL_BIOMETRIC' && payload.enrollment_id !== undefined) {
        await this.devices.updateEnrollment(uow.tx, payload.enrollment_id, {
          status: input.outcome === 'SUCCESS' ? 'ACTIVE' : 'DELETED',
          enrolledAt: input.outcome === 'SUCCESS' ? now : null,
          ...(input.template_hash === undefined
            ? {}
            : { templateHash: Buffer.from(input.template_hash, 'hex') }),
          ...(input.quality === undefined ? {} : { quality: input.quality }),
        });
      }

      if (command.commandType === 'DELETE_BIOMETRIC' && payload.enrollment_id !== undefined) {
        if (input.outcome === 'SUCCESS') {
          await this.devices.updateEnrollment(uow.tx, payload.enrollment_id, {
            status: 'DELETED',
            deletedAt: now,
            // hash ของ template ที่ถูกลบแล้วไม่มีประโยชน์และเป็นข้อมูลชีวภาพตกค้าง
            templateHash: null,
          });
        }
        await this.devices.updateDeletionJobsByCommand(uow.tx, command.id, {
          status: input.outcome === 'SUCCESS' ? 'ACKED' : 'FAILED',
          ackedAt: input.outcome === 'SUCCESS' ? now : null,
        });
      }

      await uow.audit({
        action: `device.command.${input.outcome === 'SUCCESS' ? 'ack' : 'fail'}`,
        resourceType: 'device_command',
        resourceId: command.id,
        outcome: input.outcome === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        companyId: device.companyId,
        metadata: { command_type: command.commandType },
      });

      return { status: input.outcome };
    });
  }

  /**
   * Adapter สำหรับ firmware เดิม (spec §13)
   *
   * ข้อจำกัดที่ยอมรับโดยรู้ตัว: โปรโตคอลเดิมไม่มี event id, sequence หรือลายเซ็น
   * จึง **ไม่มี dedup ที่แท้จริง** — event ถูกทำเครื่องหมาย LEGACY_UNTRUSTED และ
   * adapter นี้ต้องถูกปิดหลัง backlog = 0
   */
  async ingestLegacy(input: {
    deviceCode: string;
    fingerId: number;
    presentedKey: string | null;
  }): Promise<{ event_id: string; status: string }> {
    const expectedKey = this.config.LEGACY_INGEST_KEY;
    if (expectedKey === undefined) {
      // ไม่ได้ตั้งค่า = adapter ปิดอยู่ ตอบ 404 ไม่ใช่ 401 เพื่อไม่เปิดเผยว่ามี endpoint นี้
      throw AppError.notFound('endpoint');
    }
    if (
      input.presentedKey === null ||
      !safeCompare(Buffer.from(input.presentedKey), Buffer.from(expectedKey))
    ) {
      throw AppError.unauthenticated('invalid legacy ingest key');
    }

    const lookup = await withSystemTransaction(this.database.db, async (tx) => {
      const result = await tx.execute(
        sql`SELECT * FROM workforce.lookup_legacy_device(${input.deviceCode})`,
      );
      return result.rows[0] as
        | { device_id: string; tenant_id: string; company_id: string; status: string }
        | undefined;
    });

    if (lookup === undefined) throw AppError.notFound('device');
    if (lookup.status !== 'ACTIVE') throw AppError.unauthenticated('device is not active');

    const device: DeviceIdentity = {
      deviceId: lookup.device_id,
      tenantId: lookup.tenant_id,
      companyId: lookup.company_id,
      credentialId: lookup.device_id,
      revokedAt: null,
    };

    const capturedAt = this.clock.now();
    const eventId = uuidv7();

    return this.uow.runAs({ type: 'DEVICE', device }, device.tenantId, async (uow) => {
      const enrollment = await this.devices.findEnrollmentBySlot(
        uow.tx,
        device.deviceId,
        input.fingerId,
      );

      const envelope: TimeEventEnvelope = {
        event_id: eventId,
        employment_id: enrollment?.employmentId ?? null,
        source_type: 'LEGACY_UNTRUSTED',
        source_id: device.deviceId,
        event_intent: 'AUTO',
        captured_at: capturedAt.toISOString(),
        timezone: 'Asia/Bangkok',
        sequence: null,
        evidence: { legacy_finger_id: input.fingerId },
        client_context: {},
      };

      await uow.tx.insert(schema.rawTimeEvents).values({
        id: eventId,
        tenantId: device.tenantId,
        companyId: device.companyId,
        employmentId: enrollment?.employmentId ?? null,
        sourceType: 'LEGACY_UNTRUSTED',
        sourceId: device.deviceId,
        eventIntent: 'AUTO',
        capturedAt,
        timeZone: 'Asia/Bangkok',
        receivedAt: capturedAt,
        // ไม่มี sequence จาก firmware เดิม → unique index ไม่ครอบ → ไม่มี dedup
        sequence: null,
        payloadHash: computeEventPayloadHash(envelope),
        evidence: {
          legacy_finger_id: input.fingerId,
          slot_resolved: enrollment !== undefined,
          // captured_at = เวลาที่ server ได้รับ เพราะ firmware เดิมไม่ส่งเวลามา
          captured_at_is_server_time: true,
        },
        clientContext: { adapter: 'legacy-v1' },
        status: 'ACCEPTED',
      });

      await this.devices.updateDevice(uow.tx, device.deviceId, { lastSeenAt: capturedAt });

      return { event_id: eventId, status: 'ACCEPTED' };
    });
  }
}
