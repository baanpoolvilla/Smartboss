import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  approveMobileDeviceSchema,
  assignPolicyGroupSchema,
  attachEvidenceSchema,
  commitSessionSchema,
  createPolicyGroupSchema,
  createSessionSchema,
  enrollMobileDeviceSchema,
  listRiskAssessmentsQuerySchema,
  reviewRiskAssessmentSchema,
  type CommitResult,
  type CommitSessionInput,
  type CreatePolicyGroupInput,
  type EnrollMobileDeviceInput,
} from '@workforce/contracts';
import type { z } from 'zod';
import { requireUuid } from '../organization/organization.controller';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { decodeCursor } from '../shared/pagination';
import { zodPipe } from '../shared/zod-validation.pipe';
import { CheckinService } from './checkin.service';
import { PolicyGroupService } from './policy-group.service';

@Controller()
export class CheckinController {
  constructor(
    private readonly service: CheckinService,
    private readonly policyGroups: PolicyGroupService,
  ) {}

  // --- mobile device registration (employee self-service) ---

  @Post('mobile-devices/enroll')
  @HttpCode(201)
  @RequirePermissions('workforce.attendance.read.self')
  @Idempotent()
  async enrollDevice(
    @Body(zodPipe(enrollMobileDeviceSchema)) body: EnrollMobileDeviceInput,
  ): Promise<Record<string, unknown>> {
    return this.service.enrollMobileDevice(body);
  }

  @Get('me/mobile-devices')
  @RequirePermissions('workforce.attendance.read.self')
  async listMyDevices(): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listMyMobileDevices();
  }

  @Post('mobile-devices/:registrationId/approve')
  @HttpCode(200)
  @RequirePermissions('workforce.people.manage')
  @Idempotent()
  async approveDevice(
    @Param('registrationId') registrationId: string,
    @Body(zodPipe(approveMobileDeviceSchema)) body: z.infer<typeof approveMobileDeviceSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.approveMobileDevice(
      requireUuid(registrationId, 'registrationId'),
      body.reason,
    );
  }

  // --- photo check-in: create → evidence → commit (spec §13) ---

  @Post('time-events/photo-checkin-sessions')
  @HttpCode(201)
  @RequirePermissions('workforce.attendance.read.self')
  async createSession(
    @Body(zodPipe(createSessionSchema)) body: z.infer<typeof createSessionSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.createSession(body);
  }

  @Post('time-events/photo-checkin-sessions/:sessionId/evidence')
  @HttpCode(201)
  @RequirePermissions('workforce.attendance.read.self')
  async attachEvidence(
    @Param('sessionId') sessionId: string,
    @Body(zodPipe(attachEvidenceSchema)) body: z.infer<typeof attachEvidenceSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.attachEvidence(requireUuid(sessionId, 'sessionId'), body);
  }

  @Post('time-events/photo-checkin-sessions/:sessionId/commit')
  @HttpCode(200)
  @RequirePermissions('workforce.attendance.read.self')
  @Idempotent()
  async commitSession(
    @Param('sessionId') sessionId: string,
    @Body(zodPipe(commitSessionSchema)) body: CommitSessionInput,
  ): Promise<CommitResult> {
    return this.service.commitSession(requireUuid(sessionId, 'sessionId'), body);
  }

  // --- evidence review ---

  @Get('attendance-risk-assessments')
  @RequirePermissions('workforce.attendance.evidence.read')
  async listRiskAssessments(
    @Query(zodPipe(listRiskAssessmentsQuerySchema))
    query: z.infer<typeof listRiskAssessmentsQuerySchema>,
  ): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
    return this.service.listRiskAssessments({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      unreviewedOnly: query.unreviewed_only,
      ...(query.decision === undefined ? {} : { decision: query.decision }),
      ...(query.employment_id === undefined ? {} : { employmentId: query.employment_id }),
    });
  }

  @Post('attendance-risk-assessments/:assessmentId/review')
  @HttpCode(200)
  @RequirePermissions('workforce.attendance.correct.approve')
  @Idempotent()
  async review(
    @Param('assessmentId') assessmentId: string,
    @Body(zodPipe(reviewRiskAssessmentSchema)) body: z.infer<typeof reviewRiskAssessmentSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.reviewRiskAssessment(requireUuid(assessmentId, 'assessmentId'), body);
  }

  /**
   * ขอ URL ดูรูปหลักฐาน
   * ต้องมีสิทธิ์ evidence.read และถูกบันทึก audit ทุกครั้ง (spec §6.3, §17)
   */
  @Get('attendance-evidence/:evidenceId/download-url')
  @RequirePermissions('workforce.attendance.evidence.read')
  async downloadUrl(
    @Param('evidenceId') evidenceId: string,
  ): Promise<{ url: string; expires_at: string }> {
    return this.service.createEvidenceDownloadUrl(requireUuid(evidenceId, 'evidenceId'));
  }

  // --- policy groups ---

  @Post('attendance-policy-groups')
  @HttpCode(201)
  @RequirePermissions('workforce.settings.manage')
  @Idempotent()
  async createPolicyGroup(
    @Body(zodPipe(createPolicyGroupSchema)) body: CreatePolicyGroupInput,
  ): Promise<Record<string, unknown>> {
    return this.policyGroups.create(body);
  }

  @Post('attendance-policy-groups/:groupId/members')
  @HttpCode(201)
  @RequirePermissions('workforce.settings.manage')
  @Idempotent()
  async assignPolicyGroup(
    @Param('groupId') groupId: string,
    @Body(zodPipe(assignPolicyGroupSchema)) body: z.infer<typeof assignPolicyGroupSchema>,
  ): Promise<Record<string, unknown>> {
    return this.policyGroups.assign(requireUuid(groupId, 'groupId'), body);
  }
}
