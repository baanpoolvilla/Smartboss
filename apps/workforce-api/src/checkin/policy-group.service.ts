import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import type { CreatePolicyGroupInput } from '@workforce/contracts';
import { AppError, EffectivePeriod, LocalDate, uuidv7, type Clock } from '@workforce/domain';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { APP_CONFIG, CLOCK } from '../shared/tokens';
import { CheckinRepository } from './checkin.repository';

@Injectable()
export class PolicyGroupService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: CheckinRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * วันที่ที่ใช้ resolve นโยบาย — ต้องมาจาก Clock ที่ฉีดเข้ามา ไม่ใช่ `new Date()`
   * ตรง ๆ เพราะเทสต์ใช้ FixedClock เดินเวลาเอง และวันที่ต้องเป็นวันตามโซนเวลา
   * ของบริษัท ไม่ใช่ของ UTC (ต่างกันจริงในช่วงเที่ยงคืนถึงเจ็ดโมงเช้าบ้านเรา)
   */
  private resolveAsOf(asOf: string | undefined): string {
    if (asOf === undefined) {
      return LocalDate.fromInstant(this.clock.now(), this.config.DEFAULT_TIME_ZONE).toString();
    }
    // ส่งค่าที่ไม่ใช่วันที่มาต้องได้ 400 ไม่ใช่ผลลัพธ์เพี้ยนเงียบ ๆ
    return LocalDate.parse(asOf).toString();
  }

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

  /**
   * รายการนโยบายทั้งหมด พร้อมจำนวนคนที่อยู่ในแต่ละกลุ่ม ณ วันนี้
   *
   * หน้าตั้งค่าต้องตอบคำถามเดียวให้ได้: "พนักงานคนนี้จะลงเวลาผ่านไหม"
   * ⇒ ต้องเห็นทั้งค่าที่ตั้งไว้ **และ** ว่ามีใครถูกจัดเข้ากลุ่มแล้วบ้าง
   * กลุ่มที่ตั้งไว้สวยแต่ไม่มีสมาชิกเลย = ทุกคนยังตกไปใช้ค่า default ที่เข้มมาก
   * (checkin.service.ts DEFAULT_POLICY) ซึ่งเป็นอาการที่หาสาเหตุยากที่สุด
   */
  async list(companyId: string | undefined, asOf?: string): Promise<{
    items: Record<string, unknown>[];
  }> {
    const on = this.resolveAsOf(asOf);
    return this.uow.run(async (uow) => {
      const groups = await this.repository.listPolicyGroups(uow.tx, {
        ...(companyId === undefined ? {} : { companyId }),
      });
      const members = await this.repository.listActivePolicyMembers(uow.tx, on);

      const countByGroup = new Map<string, number>();
      for (const member of members) {
        countByGroup.set(
          member.policyGroupId,
          (countByGroup.get(member.policyGroupId) ?? 0) + 1,
        );
      }

      return {
        items: groups.map((group) => ({
          id: group.id,
          company_id: group.companyId,
          code: group.code,
          name: group.name,
          allowed_methods: group.allowedMethods,
          photo_required: group.photoRequired,
          photo_random_percent: group.photoRandomPercent,
          location_required: group.locationRequired,
          allowed_site_ids: group.allowedSiteIds,
          radius_m: group.radiusM,
          max_accuracy_m: group.maxAccuracyM,
          capture_deadline_seconds: group.captureDeadlineSeconds,
          require_enrolled_device: group.requireEnrolledDevice,
          require_live_capture: group.requireLiveCapture,
          risk_action: group.riskAction,
          photo_retention_days: group.photoRetentionDays,
          effective_from: group.effectiveFrom,
          effective_to: group.effectiveTo,
          member_count: countByGroup.get(group.id) ?? 0,
        })),
      };
    });
  }

  /** employment_id → policy group ที่สังกัดอยู่ตอนนี้ (ใช้เติมช่องเลือกในหน้าจอ) */
  async listMemberships(asOf?: string): Promise<{
    items: { employment_id: string; policy_group_id: string }[];
  }> {
    const on = this.resolveAsOf(asOf);
    return this.uow.run(async (uow) => {
      const members = await this.repository.listActivePolicyMembers(uow.tx, on);
      return {
        items: members.map((member) => ({
          employment_id: member.employmentId,
          policy_group_id: member.policyGroupId,
        })),
      };
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
