import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import type { CommitResult, CommitSessionInput, EnrollMobileDeviceInput } from '@workforce/contracts';
import { schema, type Tx } from '@workforce/db';
import {
  AppError,
  computeEventPayloadHash,
  createsTimeEvent,
  evaluateCheckin,
  LocalDate,
  uuidv7,
  type CheckinEvidence,
  type Clock,
  type PhotoPolicy,
  type SiteLocation,
  type TimeEventEnvelope,
} from '@workforce/domain';
import { eq } from 'drizzle-orm';
import { UnitOfWork, type UnitOfWorkContext } from '../infrastructure/unit-of-work';
import {
  buildObjectKey,
  type ObjectStorage,
} from '../infrastructure/storage/object-storage';
import { RequestContextService } from '../shared/request-context';
import { APP_CONFIG, CLOCK, OBJECT_STORAGE } from '../shared/tokens';
import { CheckinRepository } from './checkin.repository';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * นโยบายเริ่มต้นเมื่อพนักงานยังไม่ถูกจัดเข้ากลุ่มใด
 *
 * เข้มไว้ก่อน: บังคับพิกัด ส่งเข้าคิวตรวจเมื่อพบความเสี่ยง แต่ไม่ปฏิเสธ
 * เพราะการตั้งค่ายังไม่ครบไม่ควรทำให้พนักงานลงเวลาไม่ได้
 */
const DEFAULT_POLICY: PhotoPolicy = {
  photoRequired: 'ALWAYS',
  photoRandomPercent: 0,
  locationRequired: true,
  allowedSiteIds: [],
  radiusM: 200,
  maxAccuracyM: 100,
  captureDeadlineSeconds: 30,
  allowOfflineCapture: false,
  offlineMaxAgeMinutes: 120,
  requireEnrolledDevice: true,
  requireLiveCapture: true,
  riskAction: 'REVIEW',
};

@Injectable()
export class CheckinService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: CheckinRepository,
    private readonly requestContext: RequestContextService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private requireEmployment(): string {
    const employmentId = this.requestContext.requirePrincipal().employmentId;
    if (employmentId === null) {
      throw AppError.validation('this account is not linked to an employment record');
    }
    return employmentId;
  }

  // --- mobile device registration ---

  async enrollMobileDevice(input: EnrollMobileDeviceInput): Promise<Record<string, unknown>> {
    const employmentId = this.requireEmployment();

    return this.uow.run(async (uow) => {
      const existing = await this.repository.findMobileDeviceByFingerprint(
        uow.tx,
        employmentId,
        input.device_fingerprint,
      );
      if (existing !== undefined && existing.status === 'ACTIVE') {
        return toMobileDevice(existing);
      }

      const active = await this.repository.findActiveMobileDevice(uow.tx, employmentId);

      // spec §6.4: 1 active device ต่อพนักงาน — เครื่องที่สองต้องรออนุมัติ
      // ไม่ใช่แทนที่เครื่องเดิมเงียบ ๆ ซึ่งเป็นช่องทางยึดบัญชี
      const status = active === undefined ? 'ACTIVE' : 'PENDING';

      const row = await this.repository.insertMobileDevice(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        employmentId,
        deviceFingerprint: input.device_fingerprint,
        platform: input.platform,
        model: input.model,
        appVersion: input.app_version,
        attestationStatus: input.attestation_status,
        status,
        approvedAt: status === 'ACTIVE' ? this.clock.now() : null,
      });

      await uow.audit({
        action: status === 'ACTIVE' ? 'mobile-device.enroll' : 'mobile-device.replacement.request',
        resourceType: 'mobile_device_registration',
        resourceId: row.id,
        outcome: 'SUCCESS',
        after: {
          platform: row.platform,
          status: row.status,
          attestation_status: row.attestationStatus,
        },
      });

      return toMobileDevice(row);
    });
  }

  async approveMobileDevice(id: string, reason: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const device = await this.repository.findMobileDeviceById(uow.tx, id);
      if (device === undefined) throw AppError.notFound('mobile device registration');
      if (device.status !== 'PENDING') {
        throw AppError.conflict('only a pending registration can be approved');
      }

      const now = this.clock.now();
      const current = await this.repository.findActiveMobileDevice(uow.tx, device.employmentId);
      if (current !== undefined) {
        await this.repository.updateMobileDevice(uow.tx, current.id, {
          status: 'REPLACED',
          revokedAt: now,
          revokedReason: 'replaced by an approved registration',
        });
      }

      const approved = await this.repository.updateMobileDevice(uow.tx, id, {
        status: 'ACTIVE',
        approvedAt: now,
        approvedBy: this.requestContext.requirePrincipal().principalId,
      });

      await uow.audit({
        action: 'mobile-device.replacement.approve',
        resourceType: 'mobile_device_registration',
        resourceId: id,
        outcome: 'SUCCESS',
        reason,
        before: { status: device.status },
        after: { status: 'ACTIVE', replaced: current?.id ?? null },
      });

      return toMobileDevice(approved ?? device);
    });
  }

  async listMyMobileDevices(): Promise<{ items: Record<string, unknown>[] }> {
    const employmentId = this.requireEmployment();
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listMobileDevices(uow.tx, employmentId);
      return { items: rows.map(toMobileDevice) };
    });
  }

  // --- session lifecycle ---

  async createSession(input: {
    event_intent: string;
    device_fingerprint: string | null;
  }): Promise<Record<string, unknown>> {
    const employmentId = this.requireEmployment();

    return this.uow.run(async (uow) => {
      const employment = await uow.tx
        .select()
        .from(schema.employments)
        .where(eq(schema.employments.id, employmentId))
        .limit(1);
      const employmentRow = employment[0];
      if (employmentRow === undefined) throw AppError.notFound('employment');

      const now = this.clock.now();
      const policy = await this.loadPolicy(uow, employmentId, now);

      let registrationId: string | null = null;
      if (input.device_fingerprint !== null) {
        const registration = await this.repository.findMobileDeviceByFingerprint(
          uow.tx,
          employmentId,
          input.device_fingerprint,
        );
        registrationId = registration?.id ?? null;
      }

      const session = await this.repository.insertSession(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: employmentRow.companyId,
        employmentId,
        mobileDeviceRegistrationId: registrationId,
        eventIntent: input.event_intent,
        status: 'OPEN',
        // ผู้ใช้ต้องยืนยันภายในหน้าต่างนี้ ไม่งั้นรูปที่เตรียมไว้ล่วงหน้าจะใช้ได้ตลอด
        expiresAt: new Date(now.getTime() + policy.captureDeadlineSeconds * 1000 * 10),
      });

      return {
        id: session.id,
        employment_id: employmentId,
        event_intent: session.eventIntent,
        status: session.status,
        expires_at: session.expiresAt.toISOString(),
        created_at: session.createdAt.toISOString(),
        policy: {
          photo_required: policy.photoRequired,
          location_required: policy.locationRequired,
          capture_deadline_seconds: policy.captureDeadlineSeconds,
          require_live_capture: policy.requireLiveCapture,
          max_accuracy_m: policy.maxAccuracyM,
        },
      };
    });
  }

  /**
   * แนบรูปเข้ากับ session
   *
   * แยกจาก commit เพื่อให้ upload ที่ล้มเหลว retry ได้โดยไม่สร้าง time event ซ้ำ
   * (spec §13) — เรียกซ้ำได้ รูปล่าสุดชนะ
   */
  async attachEvidence(
    sessionId: string,
    input: {
      photo_base64: string;
      content_type: string;
      captured_at_client: string;
      live_capture: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const employmentId = this.requireEmployment();
    const photo = Buffer.from(input.photo_base64, 'base64');

    if (photo.length === 0) throw AppError.validation('photo payload is empty');
    if (photo.length > MAX_PHOTO_BYTES) throw AppError.validation('photo exceeds the size limit');

    return this.uow.run(async (uow) => {
      const session = await this.repository.findSessionById(uow.tx, sessionId);
      if (session === undefined || session.employmentId !== employmentId) {
        throw AppError.notFound('check-in session');
      }
      if (session.status === 'COMMITTED') {
        throw AppError.conflict('session was already committed');
      }
      if (session.expiresAt <= this.clock.now()) {
        await this.repository.updateSession(uow.tx, sessionId, { status: 'EXPIRED' });
        throw AppError.conflict('check-in session has expired');
      }

      const sha256 = createHash('sha256').update(photo).digest();
      const objectKey = buildObjectKey(
        uow.tenantId,
        'CHECKIN_PHOTO',
        input.content_type === 'image/png' ? 'png' : 'jpg',
        this.clock.now(),
      );

      // เขียนลง object storage ก่อน แล้วค่อยบันทึก metadata — ถ้า commit ล้มเหลว
      // จะเหลือ object กำพร้าซึ่ง retention job เก็บกวาดได้ ปลอดภัยกว่ามี metadata
      // ที่ชี้ไปยังไฟล์ที่ไม่มีอยู่จริง
      await this.storage.put({ key: objectKey, body: photo, contentType: input.content_type });

      const storageObjectId = uuidv7();
      const retentionDays = (await this.loadPolicyRow(uow, employmentId))?.photoRetentionDays ?? 90;
      const retentionUntil = LocalDate.fromInstant(this.clock.now(), this.config.DEFAULT_TIME_ZONE)
        .plusDays(retentionDays)
        .toString();

      await this.repository.insertStorageObject(uow.tx, {
        id: storageObjectId,
        tenantId: uow.tenantId,
        companyId: session.companyId,
        category: 'CHECKIN_PHOTO',
        objectKey,
        contentType: input.content_type,
        sizeBytes: photo.length,
        sha256,
        status: 'AVAILABLE',
        retentionUntil,
      });

      const evidence = await this.repository.insertPhotoEvidence(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        sessionId,
        storageObjectId,
        sha256,
        capturedAtClient: new Date(input.captured_at_client),
        contentType: input.content_type,
        sizeBytes: photo.length,
        liveCapture: input.live_capture,
        retentionUntil,
      });

      await this.repository.updateSession(uow.tx, sessionId, { status: 'EVIDENCE_ATTACHED' });

      return {
        evidence_id: evidence.id,
        session_id: sessionId,
        size_bytes: photo.length,
        retention_until: retentionUntil,
      };
    });
  }

  /**
   * ยืนยันการลงเวลา — จุดที่ policy engine ตัดสินและ raw event ถูกสร้าง
   */
  async commitSession(sessionId: string, input: CommitSessionInput): Promise<CommitResult> {
    const employmentId = this.requireEmployment();

    return this.uow.run(async (uow) => {
      const session = await this.repository.findSessionById(uow.tx, sessionId);
      if (session === undefined || session.employmentId !== employmentId) {
        throw AppError.notFound('check-in session');
      }
      // commit ซ้ำต้องไม่สร้าง event ที่สอง (spec §19.2)
      if (session.status === 'COMMITTED') {
        throw AppError.conflict('session was already committed');
      }

      const now = this.clock.now();
      const capturedAt = new Date(input.captured_at_client);
      const policy = await this.loadPolicy(uow, employmentId, now);
      const policyRow = await this.loadPolicyRow(uow, employmentId);

      const photo = await this.repository.findEvidenceForSession(uow.tx, sessionId);
      const duplicatePhoto =
        photo === undefined
          ? false
          : await this.repository.photoChecksumSeen(
              uow.tx,
              Buffer.from(photo.sha256),
              sessionId,
            );

      const registration =
        session.mobileDeviceRegistrationId === null
          ? undefined
          : await this.repository.findMobileDeviceById(uow.tx, session.mobileDeviceRegistrationId);

      const sites = await this.repository.listSitesForCompany(uow.tx, session.companyId);
      const siteLocations: SiteLocation[] = sites
        .filter((site) => site.latitude !== null && site.longitude !== null)
        .map((site) => ({
          id: site.id,
          latitude: Number(site.latitude),
          longitude: Number(site.longitude),
          radiusM: site.radiusM,
        }));

      const previous = await this.repository.findPreviousCheckin(uow.tx, employmentId, capturedAt);

      const evidence: CheckinEvidence = {
        hasPhoto: photo !== undefined,
        liveCapture: photo?.liveCapture ?? false,
        duplicatePhoto,
        location:
          input.location === null
            ? null
            : {
                latitude: input.location.latitude,
                longitude: input.location.longitude,
                accuracyM: input.location.accuracy_m,
              },
        mockLocationSuspected: input.mock_location_suspected,
        deviceEnrolled: registration?.status === 'ACTIVE',
        attestationStatus:
          (registration?.attestationStatus as CheckinEvidence['attestationStatus']) ?? 'UNAVAILABLE',
        capturedAtClient: capturedAt,
        committedAt: now,
        previousCheckin: previous ?? null,
      };

      const evaluation = evaluateCheckin({ policy, evidence, sites: siteLocations });

      let eventId: string | null = null;
      if (createsTimeEvent(evaluation.decision)) {
        eventId = uuidv7();
        const envelope: TimeEventEnvelope = {
          event_id: eventId,
          employment_id: employmentId,
          source_type: 'MOBILE_APP',
          source_id: registration?.id ?? null,
          event_intent: session.eventIntent as TimeEventEnvelope['event_intent'],
          captured_at: capturedAt.toISOString(),
          timezone: this.config.DEFAULT_TIME_ZONE,
          sequence: null,
          evidence: { decision: evaluation.decision, risk_flags: evaluation.flags },
          client_context: { app_version: input.app_version },
        };

        await uow.tx.insert(schema.rawTimeEvents).values({
          id: eventId,
          tenantId: uow.tenantId,
          companyId: session.companyId,
          employmentId,
          sourceType: 'MOBILE_APP',
          sourceId: registration?.id ?? null,
          eventIntent: session.eventIntent,
          capturedAt,
          timeZone: this.config.DEFAULT_TIME_ZONE,
          receivedAt: now,
          sequence: null,
          payloadHash: computeEventPayloadHash(envelope),
          evidence: {
            decision: evaluation.decision,
            risk_flags: evaluation.flags,
            score: evaluation.score,
            // ผลการตัดสินอยู่ที่นี่เพื่อการวินิจฉัย แต่การนับเป็นเวลาทำงานจริง
            // ตัดสินที่ attendance engine ใน Phase 4 จาก risk assessment
            requires_review: evaluation.decision === 'PENDING_REVIEW',
          },
          clientContext: { app_version: input.app_version, platform: registration?.platform },
          status: 'ACCEPTED',
        });
      }

      await this.repository.insertTimeEventEvidence(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        rawTimeEventId: eventId,
        sessionId,
        photoEvidenceId: photo?.id ?? null,
        latitude: input.location === null ? null : input.location.latitude.toFixed(6),
        longitude: input.location === null ? null : input.location.longitude.toFixed(6),
        accuracyM: input.location === null ? null : input.location.accuracy_m.toFixed(2),
        siteId: evaluation.matchedSiteId,
        distanceFromSiteM:
          evaluation.distanceFromSiteM === null ? null : evaluation.distanceFromSiteM.toFixed(2),
        platform: registration?.platform ?? null,
        appVersion: input.app_version,
        attestationStatus: registration?.attestationStatus ?? null,
      });

      await this.repository.insertRiskAssessment(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        sessionId,
        rawTimeEventId: eventId,
        employmentId,
        decision: evaluation.decision,
        riskFlags: evaluation.flags,
        score: evaluation.score,
        policyGroupId: policyRow?.id ?? null,
        details: evaluation.details,
      });

      await this.repository.updateSession(uow.tx, sessionId, {
        status: 'COMMITTED',
        committedAt: now,
        committedEventId: eventId,
      });

      if (registration !== undefined) {
        await this.repository.updateMobileDevice(uow.tx, registration.id, { lastUsedAt: now });
      }

      await uow.audit({
        action: 'attendance.photo-checkin.commit',
        resourceType: 'photo_checkin_session',
        resourceId: sessionId,
        outcome: evaluation.decision === 'REJECTED_POLICY' ? 'FAILED' : 'SUCCESS',
        companyId: session.companyId,
        metadata: {
          decision: evaluation.decision,
          risk_flags: evaluation.flags,
          score: evaluation.score,
        },
      });

      return {
        session_id: sessionId,
        event_id: eventId,
        decision: evaluation.decision,
        risk_flags: evaluation.flags,
        score: evaluation.score,
        matched_site_id: evaluation.matchedSiteId,
        distance_from_site_m: evaluation.distanceFromSiteM,
        captured_at: capturedAt.toISOString(),
        server_time: now.toISOString(),
      };
    });
  }

  // --- evidence access ---

  /**
   * สร้าง signed URL อายุสั้นสำหรับดูรูปหลักฐาน
   *
   * ทุกครั้งที่มีคนขอ URL จะถูกบันทึก audit — การ "ดู" หลักฐานเป็นการเข้าถึง
   * ข้อมูลอ่อนไหวที่ต้องตรวจสอบย้อนหลังได้ (spec §17, ADR-0009 ข้อ 4)
   */
  async createEvidenceDownloadUrl(evidenceId: string): Promise<{ url: string; expires_at: string }> {
    return this.uow.run(async (uow) => {
      const evidence = await this.repository.findPhotoEvidenceById(uow.tx, evidenceId);
      if (evidence === undefined) throw AppError.notFound('photo evidence');
      if (evidence.deletedAt !== null) throw AppError.notFound('photo evidence');

      const objectRows = await uow.tx
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, evidence.storageObjectId))
        .limit(1);
      const object = objectRows[0];
      if (object === undefined || object.status !== 'AVAILABLE') {
        throw AppError.notFound('photo evidence');
      }

      const ttl = this.config.STORAGE_SIGNED_URL_TTL_SECONDS;
      const url = await this.storage.createSignedDownloadUrl(object.objectKey, {
        expiresInSeconds: ttl,
      });

      await uow.audit({
        action: 'attendance.evidence.read',
        resourceType: 'photo_evidence_object',
        resourceId: evidenceId,
        outcome: 'SUCCESS',
        metadata: { ttl_seconds: ttl },
      });

      return {
        url,
        expires_at: new Date(this.clock.now().getTime() + ttl * 1000).toISOString(),
      };
    });
  }

  async listRiskAssessments(query: {
    cursor: string | null;
    limit: number;
    decision?: string;
    employmentId?: string;
    unreviewedOnly: boolean;
  }): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listRiskAssessments(uow.tx, query);
      return { items: rows.map(toRiskAssessment), next_cursor: null };
    });
  }

  async reviewRiskAssessment(
    id: string,
    input: { outcome: 'APPROVED' | 'REJECTED'; reason: string },
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const assessment = await this.repository.findRiskAssessmentById(uow.tx, id);
      if (assessment === undefined) throw AppError.notFound('risk assessment');
      if (assessment.reviewedAt !== null) throw AppError.conflict('already reviewed');

      await this.repository.updateRiskAssessment(uow.tx, id, {
        reviewedAt: this.clock.now(),
        reviewedBy: this.requestContext.requirePrincipal().principalId,
        reviewOutcome: input.outcome,
        reviewReason: input.reason,
      });

      await uow.audit({
        action: 'attendance.exception.waive',
        resourceType: 'mobile_risk_assessment',
        resourceId: id,
        outcome: 'SUCCESS',
        // action นี้อยู่ใน REASON_REQUIRED_ACTIONS — ไม่มีเหตุผลจะถูกปฏิเสธ
        reason: input.reason,
        before: { decision: assessment.decision, risk_flags: assessment.riskFlags },
        after: { review_outcome: input.outcome },
      });

      const updated = await this.repository.findRiskAssessmentById(uow.tx, id);
      return toRiskAssessment(updated ?? assessment);
    });
  }

  // --- helpers ---

  private async loadPolicyRow(
    uow: UnitOfWorkContext,
    employmentId: string,
  ): Promise<typeof schema.attendancePolicyGroups.$inferSelect | undefined> {
    const asOf = LocalDate.fromInstant(this.clock.now(), this.config.DEFAULT_TIME_ZONE).toString();
    return this.repository.resolvePolicyForEmployment(uow.tx, employmentId, asOf);
  }

  private async loadPolicy(
    uow: UnitOfWorkContext,
    employmentId: string,
    now: Date,
  ): Promise<PhotoPolicy> {
    const asOf = LocalDate.fromInstant(now, this.config.DEFAULT_TIME_ZONE).toString();
    const row = await this.repository.resolvePolicyForEmployment(uow.tx, employmentId, asOf);
    if (row === undefined) return DEFAULT_POLICY;

    return {
      photoRequired: row.photoRequired as PhotoPolicy['photoRequired'],
      photoRandomPercent: row.photoRandomPercent,
      locationRequired: row.locationRequired,
      allowedSiteIds: row.allowedSiteIds,
      radiusM: row.radiusM,
      maxAccuracyM: row.maxAccuracyM,
      captureDeadlineSeconds: row.captureDeadlineSeconds,
      allowOfflineCapture: row.allowOfflineCapture,
      offlineMaxAgeMinutes: row.offlineMaxAgeMinutes,
      requireEnrolledDevice: row.requireEnrolledDevice,
      requireLiveCapture: row.requireLiveCapture,
      riskAction: row.riskAction as PhotoPolicy['riskAction'],
    };
  }
}

function toMobileDevice(
  row: typeof schema.mobileDeviceRegistrations.$inferSelect,
): Record<string, unknown> {
  return {
    id: row.id,
    employment_id: row.employmentId,
    platform: row.platform,
    model: row.model,
    app_version: row.appVersion,
    attestation_status: row.attestationStatus,
    status: row.status,
    approved_at: row.approvedAt?.toISOString() ?? null,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
    // device_fingerprint ไม่ออก API — เป็นตัวระบุที่ใช้ผูกเครื่องเท่านั้น
  };
}

function toRiskAssessment(
  row: typeof schema.mobileRiskAssessments.$inferSelect,
): Record<string, unknown> {
  return {
    id: row.id,
    session_id: row.sessionId,
    raw_time_event_id: row.rawTimeEventId,
    employment_id: row.employmentId,
    decision: row.decision,
    risk_flags: row.riskFlags,
    score: row.score,
    details: row.details,
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    review_outcome: row.reviewOutcome,
    review_reason: row.reviewReason,
    created_at: row.createdAt.toISOString(),
  };
}
