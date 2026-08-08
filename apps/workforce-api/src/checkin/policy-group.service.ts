import { Injectable } from '@nestjs/common';
import type { CreatePolicyGroupInput } from '@workforce/contracts';
import { AppError, EffectivePeriod, LocalDate, uuidv7 } from '@workforce/domain';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { CheckinRepository } from './checkin.repository';

@Injectable()
export class PolicyGroupService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: CheckinRepository,
  ) {}

  async create(input: CreatePolicyGroupInput): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      // ตรวจช่วงเวลาให้ถูกต้องก่อนแตะ DB เพื่อให้ error message อธิบายตรงจุด
      EffectivePeriod.parse(input.effective_from, input.effective_to);

      const row = await this.repository.insertPolicyGroup(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code,
        name: input.name,
        allowedMethods: input.allowed_methods,
        photoRequired: input.photo_required,
        photoRandomPercent: input.photo_random_percent,
        locationRequired: input.location_required,
        allowedSiteIds: input.allowed_site_ids,
        radiusM: input.radius_m,
        maxAccuracyM: input.max_accuracy_m,
        captureDeadlineSeconds: input.capture_deadline_seconds,
        allowOfflineCapture: input.allow_offline_capture,
        offlineMaxAgeMinutes: input.offline_max_age_minutes,
        requireEnrolledDevice: input.require_enrolled_device,
        requireLiveCapture: input.require_live_capture,
        riskAction: input.risk_action,
        photoRetentionDays: input.photo_retention_days,
        effectiveFrom: input.effective_from,
        effectiveTo: input.effective_to,
      });

      await uow.audit({
        action: 'attendance.policy-group.create',
        resourceType: 'attendance_policy_group',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: row.companyId,
        after: {
          code: row.code,
          photo_required: row.photoRequired,
          risk_action: row.riskAction,
          photo_retention_days: row.photoRetentionDays,
        },
      });

      return { id: row.id, code: row.code, name: row.name, effective_from: row.effectiveFrom };
    });
  }

  async assign(
    groupId: string,
    input: { employment_id: string; effective_from: string; effective_to: string | null; supersede_current: boolean },
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const group = await this.repository.findPolicyGroupById(uow.tx, groupId);
      if (group === undefined) throw AppError.notFound('attendance policy group');

      const period = EffectivePeriod.parse(input.effective_from, input.effective_to);

      if (input.supersede_current) {
        const open = await this.repository.findOpenPolicyMember(uow.tx, input.employment_id);
        if (open !== undefined) {
          const openPeriod = EffectivePeriod.parse(open.effectiveFrom, null);
          if (!openPeriod.from.isBefore(period.from)) {
            throw AppError.validation(
              'cannot supersede a membership that starts on or after the new effective_from',
            );
          }
          await this.repository.closePolicyMember(
            uow.tx,
            open.id,
            openPeriod.closeBefore(period.from).to?.toString() as string,
          );
        }
      }

      const id = uuidv7();
      await this.repository.insertPolicyMember(uow.tx, {
        id,
        tenantId: uow.tenantId,
        policyGroupId: groupId,
        employmentId: input.employment_id,
        effectiveFrom: input.effective_from,
        effectiveTo: input.effective_to,
      });

      await uow.audit({
        action: 'attendance.policy-group.assign',
        resourceType: 'attendance_policy_group_member',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: group.companyId,
        after: {
          policy_group_id: groupId,
          employment_id: input.employment_id,
          effective_from: input.effective_from,
        },
      });

      return { id, policy_group_id: groupId, employment_id: input.employment_id };
    });
  }

  /** ใช้ใน test และ diagnostics: นโยบายที่มีผลกับพนักงาน ณ วันที่ระบุ */
  async resolveFor(employmentId: string, asOf: string): Promise<Record<string, unknown> | null> {
    LocalDate.parse(asOf);
    return this.uow.run(async (uow) => {
      const row = await this.repository.resolvePolicyForEmployment(uow.tx, employmentId, asOf);
      return row === null || row === undefined ? null : { id: row.id, code: row.code };
    });
  }
}
