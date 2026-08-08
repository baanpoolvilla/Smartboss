import { Inject, Injectable } from '@nestjs/common';
import type {
  Assignment,
  CreateAssignmentInput,
  CreateEmploymentInput,
  CreatePersonInput,
  Employment,
  Person,
} from '@workforce/contracts';
import type { AppConfig } from '@workforce/config';
import type { schema } from '@workforce/db';
import {
  AppError,
  EffectivePeriod,
  LocalDate,
  uuidv7,
  type Clock,
  type DataScope,
} from '@workforce/domain';
import { FieldEncryptionService } from '../infrastructure/crypto/field-encryption';
import { UnitOfWork, type UnitOfWorkContext } from '../infrastructure/unit-of-work';
import { buildPage, fetchLimit, type PageResult } from '../shared/pagination';
import { RequestContextService } from '../shared/request-context';
import { APP_CONFIG, CLOCK } from '../shared/tokens';
import { PeopleRepository, type EmploymentWithPerson } from './people.repository';

type PersonRow = typeof schema.people.$inferSelect;
type EmploymentRow = EmploymentWithPerson;
type AssignmentRow = typeof schema.employmentAssignments.$inferSelect;

@Injectable()
export class PeopleService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: PeopleRepository,
    private readonly encryption: FieldEncryptionService,
    private readonly requestContext: RequestContextService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // --- people ---

  async createPerson(input: CreatePersonInput): Promise<Person> {
    return this.uow.run(async (uow) => {
      let nationalIdEncrypted: Buffer | null = null;
      let nationalIdHash: Buffer | null = null;

      if (input.national_id !== null) {
        nationalIdHash = this.encryption.blindIndex(input.national_id);
        const duplicate = await this.repository.findPersonByNationalIdHash(uow.tx, nationalIdHash);
        if (duplicate !== undefined) {
          // ไม่บอกว่าซ้ำกับใคร — นั่นคือการเปิดเผยข้อมูลของบุคคลที่สาม
          throw AppError.conflict('a person with this national ID already exists');
        }
        nationalIdEncrypted = this.encryption.encrypt(input.national_id);
      }

      const row = await this.repository.insertPerson(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        firstName: input.first_name,
        lastName: input.last_name,
        preferredName: input.preferred_name,
        email: input.email,
        phone: input.phone,
        dateOfBirth: input.date_of_birth,
        nationalIdEncrypted,
        nationalIdHash,
      });

      await uow.audit({
        action: 'people.person.create',
        resourceType: 'person',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        after: toPersonAudit(row),
      });

      return toPerson(row);
    });
  }

  async getPerson(id: string): Promise<Person> {
    return this.uow.run(async (uow) => {
      const row = await this.repository.findPersonById(uow.tx, id);
      if (row === undefined) throw AppError.notFound('person');
      return toPerson(row);
    });
  }

  async listPeople(query: {
    cursor: string | null;
    limit: number;
    search?: string;
  }): Promise<PageResult<Person>> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listPeople(uow.tx, {
        cursor: query.cursor,
        limit: fetchLimit(query.limit),
        ...(query.search === undefined ? {} : { search: query.search }),
      });
      const page = buildPage(rows, query.limit);
      return { items: page.items.map(toPerson), next_cursor: page.next_cursor };
    });
  }

  async updatePerson(id: string, input: Partial<CreatePersonInput>): Promise<Person> {
    return this.uow.run(async (uow) => {
      const before = await this.repository.findPersonById(uow.tx, id);
      if (before === undefined) throw AppError.notFound('person');

      const patch: Partial<typeof schema.people.$inferInsert> = {};
      if (input.first_name !== undefined) patch.firstName = input.first_name;
      if (input.last_name !== undefined) patch.lastName = input.last_name;
      if (input.preferred_name !== undefined) patch.preferredName = input.preferred_name;
      if (input.email !== undefined) patch.email = input.email;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.date_of_birth !== undefined) patch.dateOfBirth = input.date_of_birth;
      if (input.national_id !== undefined) {
        if (input.national_id === null) {
          patch.nationalIdEncrypted = null;
          patch.nationalIdHash = null;
        } else {
          patch.nationalIdEncrypted = this.encryption.encrypt(input.national_id);
          patch.nationalIdHash = this.encryption.blindIndex(input.national_id);
        }
      }

      if (Object.keys(patch).length === 0) return toPerson(before);

      const after = await this.repository.updatePerson(uow.tx, id, patch);
      if (after === undefined) throw AppError.notFound('person');

      await uow.audit({
        action: 'people.person.update',
        resourceType: 'person',
        resourceId: id,
        resourceVersion: after.version,
        outcome: 'SUCCESS',
        before: toPersonAudit(before),
        after: toPersonAudit(after),
      });

      return toPerson(after);
    });
  }

  // --- employments ---

  async createEmployment(input: CreateEmploymentInput): Promise<Employment> {
    return this.uow.run(async (uow) => {
      const person = await this.repository.findPersonById(uow.tx, input.person_id);
      if (person === undefined) throw AppError.notFound('person');

      const row = await this.repository.insertEmployment(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: input.company_id,
        personId: input.person_id,
        employeeCode: input.employee_code,
        employmentType: input.employment_type,
        hiredOn: input.hired_on,
        status: 'ACTIVE',
        primarySiteId: input.primary_site_id,
        timeZone: input.time_zone,
      });

      await uow.audit({
        action: 'people.employment.create',
        resourceType: 'employment',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: row.companyId,
        after: toEmploymentAudit(row),
      });

      await uow.publish({
        aggregateType: 'employment',
        aggregateId: row.id,
        eventType: 'people.employment.created',
        payload: { employment_id: row.id, company_id: row.companyId, hired_on: row.hiredOn },
      });

      return toEmployment({ ...row, person });
    });
  }

  async getEmployment(id: string): Promise<Employment> {
    return this.uow.run(async (uow) => {
      const row = await this.loadEmploymentInScope(uow, id);
      return toEmployment(row);
    });
  }

  async listEmployments(query: {
    cursor: string | null;
    limit: number;
    companyId?: string;
    status?: string;
    personId?: string;
    asOf?: string;
  }): Promise<PageResult<Employment>> {
    return this.uow.run(async (uow) => {
      const scopeFilter = await this.resolveScopeFilter(uow, query.asOf);

      const rows = await this.repository.listEmployments(uow.tx, {
        cursor: query.cursor,
        limit: fetchLimit(query.limit),
        ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.personId === undefined ? {} : { personId: query.personId }),
        ...(query.asOf === undefined ? {} : { activeOn: query.asOf }),
        ...(scopeFilter === null ? {} : { employmentIds: scopeFilter }),
      });

      const page = buildPage(rows, query.limit);
      return { items: page.items.map(toEmployment), next_cursor: page.next_cursor };
    });
  }

  async terminateEmployment(
    id: string,
    input: { terminated_on: string; reason: string },
  ): Promise<Employment> {
    return this.uow.run(async (uow) => {
      const before = await this.repository.lockEmployment(uow.tx, id);
      if (before === undefined) throw AppError.notFound('employment');

      if (before.status === 'TERMINATED') {
        throw AppError.conflict('employment is already terminated');
      }

      const terminatedOn = LocalDate.parse(input.terminated_on);
      if (terminatedOn.isBefore(LocalDate.parse(before.hiredOn))) {
        throw AppError.validation('terminated_on must not be before hired_on');
      }

      const after = await this.repository.updateEmployment(uow.tx, id, {
        status: 'TERMINATED',
        terminatedOn: input.terminated_on,
      });
      if (after === undefined) throw AppError.notFound('employment');

      await uow.audit({
        action: 'people.employment.terminate',
        resourceType: 'employment',
        resourceId: id,
        resourceVersion: after.version,
        outcome: 'SUCCESS',
        companyId: after.companyId,
        reason: input.reason,
        before: toEmploymentAudit(before),
        after: toEmploymentAudit(after),
      });

      // Phase 2 ผูก consumer ที่สร้าง biometric deletion job ทุกเครื่อง (spec §6.2)
      await uow.publish({
        aggregateType: 'employment',
        aggregateId: id,
        eventType: 'people.employment.terminated',
        payload: { employment_id: id, terminated_on: input.terminated_on },
      });

      // อ่านกลับเพื่อเอาข้อมูลบุคคลมาด้วย — lockEmployment คืนเฉพาะแถว employment
      const withPerson = await this.repository.findEmploymentById(uow.tx, id);
      if (withPerson === undefined) throw AppError.notFound('employment');
      return toEmployment(withPerson);
    });
  }

  // --- assignments (effective-dated) ---

  async listAssignments(employmentId: string): Promise<PageResult<Assignment>> {
    return this.uow.run(async (uow) => {
      await this.loadEmploymentInScope(uow, employmentId);
      const rows = await this.repository.listAssignments(uow.tx, employmentId);
      return { items: rows.map(toAssignment), next_cursor: null };
    });
  }

  async createAssignment(
    employmentId: string,
    input: CreateAssignmentInput,
  ): Promise<Assignment> {
    return this.uow.run(async (uow) => {
      // ล็อกก่อนอ่าน/เขียนช่วงเวลา เพื่อให้การตรวจ overlap ไม่โดนแซง (ADR-0012)
      const employment = await this.repository.lockEmployment(uow.tx, employmentId);
      if (employment === undefined) throw AppError.notFound('employment');

      const period = EffectivePeriod.parse(input.effective_from, input.effective_to);
      if (period.from.isBefore(LocalDate.parse(employment.hiredOn))) {
        throw AppError.validation('effective_from must not be before the hire date');
      }

      if (input.supersede_current) {
        const open = await this.repository.findOpenAssignment(uow.tx, employmentId);
        if (open !== undefined) {
          const openPeriod = EffectivePeriod.parse(open.effectiveFrom, null);
          if (!openPeriod.from.isBefore(period.from)) {
            throw AppError.validation(
              'cannot supersede an assignment that starts on or after the new effective_from',
            );
          }
          await this.repository.closeAssignment(
            uow.tx,
            open.id,
            openPeriod.closeBefore(period.from).to?.toString() as string,
          );
        }
      }

      const row = await this.repository.insertAssignment(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        employmentId,
        orgUnitId: input.org_unit_id,
        positionId: input.position_id,
        managerEmploymentId: input.manager_employment_id,
        siteId: input.site_id,
        effectiveFrom: input.effective_from,
        effectiveTo: input.effective_to,
      });

      await uow.audit({
        action: 'people.assignment.create',
        resourceType: 'employment_assignment',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: employment.companyId,
        after: toAssignmentAudit(row),
      });

      return toAssignment(row);
    });
  }

  // --- scope helpers ---

  /**
   * แปลง permission scope เป็นรายการ employment ที่ผู้เรียกเห็นได้
   * คืน `null` = ไม่จำกัด (scope ระดับ tenant)
   */
  private async resolveScopeFilter(
    uow: UnitOfWorkContext,
    asOf: string | undefined,
  ): Promise<string[] | null> {
    const principal = this.requestContext.requirePrincipal();
    const scope: DataScope | undefined = principal.scopes['workforce.attendance.read'];

    // ผู้ที่มีสิทธิ์จัดการบุคคลเห็นได้ทั้ง tenant อยู่แล้ว
    if (principal.permissions.has('workforce.people.manage')) return null;
    if (scope === undefined || scope === 'TENANT' || scope === 'COMPANY') return null;

    const asOfDate = asOf ?? this.clock.today(this.config.DEFAULT_TIME_ZONE).toString();
    const self = principal.employmentId;
    if (self === null) return [];

    if (scope === 'SELF') return [self];

    const managed = await this.repository.listManagedEmploymentIds(uow.tx, self, asOfDate);
    return [...new Set([self, ...managed])];
  }

  private async loadEmploymentInScope(
    uow: UnitOfWorkContext,
    id: string,
  ): Promise<EmploymentRow> {
    const row = await this.repository.findEmploymentById(uow.tx, id);
    if (row === undefined) throw AppError.notFound('employment');

    const allowed = await this.resolveScopeFilter(uow, undefined);
    // นอก scope ตอบ 404 เหมือนของที่ไม่มี — ไม่ยืนยันว่ามีพนักงานคนนี้อยู่
    if (allowed !== null && !allowed.includes(id)) throw AppError.notFound('employment');
    return row;
  }
}

function toPerson(row: PersonRow): Person {
  const displayName =
    row.preferredName.trim() === '' ? `${row.firstName} ${row.lastName}` : row.preferredName;

  return {
    id: row.id,
    first_name: row.firstName,
    last_name: row.lastName,
    preferred_name: row.preferredName,
    display_name: displayName,
    email: row.email,
    phone: row.phone,
    date_of_birth: row.dateOfBirth,
    // เลขบัตรประชาชนไม่เคยออกจาก API ไม่ว่าผู้เรียกจะมีสิทธิ์อะไร (spec §16)
    has_national_id: row.nationalIdEncrypted !== null,
    status: row.status as Person['status'],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toPersonAudit(row: PersonRow): Record<string, unknown> {
  return {
    first_name: row.firstName,
    last_name: row.lastName,
    preferred_name: row.preferredName,
    email: row.email,
    phone: row.phone,
    date_of_birth: row.dateOfBirth,
    national_id_present: row.nationalIdEncrypted !== null,
    status: row.status,
  };
}

function toEmployment(row: EmploymentRow): Employment {
  return {
    id: row.id,
    company_id: row.companyId,
    person_id: row.personId,
    employee_code: row.employeeCode,
    // ชื่อเล่นถ้ามี ไม่งั้นใช้ชื่อจริง — หน้าจอส่วนใหญ่มีที่แสดงจำกัด
    display_name:
      row.person.preferredName !== null && row.person.preferredName !== ''
        ? row.person.preferredName
        : row.person.firstName,
    full_name: `${row.person.firstName} ${row.person.lastName}`.trim(),
    employment_type: row.employmentType as Employment['employment_type'],
    hired_on: row.hiredOn,
    terminated_on: row.terminatedOn,
    status: row.status as Employment['status'],
    primary_site_id: row.primarySiteId,
    time_zone: row.timeZone,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toEmploymentAudit(row: typeof schema.employments.$inferSelect): Record<string, unknown> {
  return {
    employee_code: row.employeeCode,
    employment_type: row.employmentType,
    hired_on: row.hiredOn,
    terminated_on: row.terminatedOn,
    status: row.status,
    primary_site_id: row.primarySiteId,
  };
}

function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    employment_id: row.employmentId,
    org_unit_id: row.orgUnitId,
    position_id: row.positionId,
    manager_employment_id: row.managerEmploymentId,
    site_id: row.siteId,
    effective_from: row.effectiveFrom,
    effective_to: row.effectiveTo,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toAssignmentAudit(row: AssignmentRow): Record<string, unknown> {
  return {
    org_unit_id: row.orgUnitId,
    position_id: row.positionId,
    manager_employment_id: row.managerEmploymentId,
    site_id: row.siteId,
    effective_from: row.effectiveFrom,
    effective_to: row.effectiveTo,
  };
}
