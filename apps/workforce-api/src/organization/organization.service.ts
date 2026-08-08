import { Injectable } from '@nestjs/common';
import type {
  Company,
  CreateCompanyInput,
  CreateOrgUnitInput,
  CreatePositionInput,
  CreateSiteInput,
  OrgUnit,
  Position,
  Site,
  UpdateCompanyInput,
} from '@workforce/contracts';
import type { schema } from '@workforce/db';
import { AppError, uuidv7 } from '@workforce/domain';
import { FieldEncryptionService } from '../infrastructure/crypto/field-encryption';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { buildPage, fetchLimit, type PageResult } from '../shared/pagination';
import { OrganizationRepository } from './organization.repository';

type CompanyRow = typeof schema.companies.$inferSelect;
type OrgUnitRow = typeof schema.orgUnits.$inferSelect;
type SiteRow = typeof schema.sites.$inferSelect;
type PositionRow = typeof schema.positions.$inferSelect;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: OrganizationRepository,
    private readonly encryption: FieldEncryptionService,
  ) {}

  // --- companies ---

  async createCompany(input: CreateCompanyInput): Promise<Company> {
    return this.uow.run(async (uow) => {
      const existing = await this.repository.findCompanyByCode(uow.tx, input.code);
      if (existing !== undefined) {
        throw AppError.conflict(`company code ${input.code} already exists`);
      }

      const row = await this.repository.insertCompany(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        code: input.code,
        legalName: input.legal_name,
        displayName: input.display_name,
        taxIdEncrypted: input.tax_id === undefined ? null : this.encryption.encrypt(input.tax_id),
        timeZone: input.time_zone,
        currency: input.currency,
      });

      await uow.audit({
        action: 'organization.company.create',
        resourceType: 'company',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: row.id,
        after: toCompanyAudit(row),
      });

      await uow.publish({
        aggregateType: 'company',
        aggregateId: row.id,
        eventType: 'organization.company.created',
        payload: { company_id: row.id, code: row.code },
      });

      return toCompany(row);
    });
  }

  async getCompany(id: string): Promise<Company> {
    return this.uow.run(async (uow) => {
      const row = await this.repository.findCompanyById(uow.tx, id);
      // RLS ทำให้ company ของ tenant อื่นไม่ปรากฏ ผลลัพธ์จึงเป็น 404 เหมือนของที่ไม่มีจริง
      // — 403 จะเป็นการยืนยันว่ามีของชิ้นนี้อยู่ (ADR-0005)
      if (row === undefined) throw AppError.notFound('company');
      return toCompany(row);
    });
  }

  async listCompanies(query: {
    cursor: string | null;
    limit: number;
    status?: string;
  }): Promise<PageResult<Company>> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listCompanies(uow.tx, {
        cursor: query.cursor,
        limit: fetchLimit(query.limit),
        ...(query.status === undefined ? {} : { status: query.status }),
      });
      const page = buildPage(rows, query.limit);
      return { items: page.items.map(toCompany), next_cursor: page.next_cursor };
    });
  }

  async updateCompany(id: string, input: UpdateCompanyInput): Promise<Company> {
    return this.uow.run(async (uow) => {
      const before = await this.repository.findCompanyById(uow.tx, id);
      if (before === undefined) throw AppError.notFound('company');

      const patch: Partial<typeof schema.companies.$inferInsert> = {};
      if (input.legal_name !== undefined) patch.legalName = input.legal_name;
      if (input.display_name !== undefined) patch.displayName = input.display_name;
      if (input.time_zone !== undefined) patch.timeZone = input.time_zone;
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.status !== undefined) patch.status = input.status;
      if (input.tax_id !== undefined) patch.taxIdEncrypted = this.encryption.encrypt(input.tax_id);

      if (Object.keys(patch).length === 0) return toCompany(before);

      const after = await this.repository.updateCompany(uow.tx, id, patch);
      if (after === undefined) throw AppError.notFound('company');

      await uow.audit({
        action: 'organization.company.update',
        resourceType: 'company',
        resourceId: id,
        resourceVersion: after.version,
        outcome: 'SUCCESS',
        companyId: id,
        before: toCompanyAudit(before),
        after: toCompanyAudit(after),
      });

      return toCompany(after);
    });
  }

  // --- org units ---

  async createOrgUnit(input: CreateOrgUnitInput): Promise<OrgUnit> {
    return this.uow.run(async (uow) => {
      const company = await this.repository.findCompanyById(uow.tx, input.company_id);
      if (company === undefined) throw AppError.notFound('company');

      if (input.parent_id !== null) {
        const parent = await this.repository.findOrgUnitById(uow.tx, input.parent_id);
        if (parent === undefined) throw AppError.notFound('parent org unit');
        if (parent.companyId !== input.company_id) {
          throw AppError.validation('parent org unit belongs to a different company');
        }
      }

      const row = await this.repository.insertOrgUnit(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: input.company_id,
        parentId: input.parent_id,
        code: input.code,
        name: input.name,
        kind: input.kind,
      });

      await uow.audit({
        action: 'organization.org-unit.create',
        resourceType: 'org_unit',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: row.companyId,
        after: { code: row.code, name: row.name, kind: row.kind },
      });

      return toOrgUnit(row);
    });
  }

  async listOrgUnits(query: {
    cursor: string | null;
    limit: number;
    companyId?: string;
  }): Promise<PageResult<OrgUnit>> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listOrgUnits(uow.tx, {
        cursor: query.cursor,
        limit: fetchLimit(query.limit),
        ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
      });
      const page = buildPage(rows, query.limit);
      return { items: page.items.map(toOrgUnit), next_cursor: page.next_cursor };
    });
  }

  // --- sites ---

  async createSite(input: CreateSiteInput): Promise<Site> {
    return this.uow.run(async (uow) => {
      const company = await this.repository.findCompanyById(uow.tx, input.company_id);
      if (company === undefined) throw AppError.notFound('company');

      const row = await this.repository.insertSite(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code,
        name: input.name,
        timeZone: input.time_zone,
        latitude: input.latitude === null ? null : input.latitude.toFixed(6),
        longitude: input.longitude === null ? null : input.longitude.toFixed(6),
        radiusM: input.radius_m,
      });

      await uow.audit({
        action: 'organization.site.create',
        resourceType: 'site',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: row.companyId,
        after: { code: row.code, name: row.name },
      });

      return toSite(row);
    });
  }

  async listSites(query: {
    cursor: string | null;
    limit: number;
    companyId?: string;
  }): Promise<PageResult<Site>> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listSites(uow.tx, {
        cursor: query.cursor,
        limit: fetchLimit(query.limit),
        ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
      });
      const page = buildPage(rows, query.limit);
      return { items: page.items.map(toSite), next_cursor: page.next_cursor };
    });
  }

  // --- positions ---

  async createPosition(input: CreatePositionInput): Promise<Position> {
    return this.uow.run(async (uow) => {
      const company = await this.repository.findCompanyById(uow.tx, input.company_id);
      if (company === undefined) throw AppError.notFound('company');

      const row = await this.repository.insertPosition(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code,
        title: input.title,
      });

      await uow.audit({
        action: 'organization.position.create',
        resourceType: 'position',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: row.companyId,
        after: { code: row.code, title: row.title },
      });

      return toPosition(row);
    });
  }

  async listPositions(query: {
    cursor: string | null;
    limit: number;
    companyId?: string;
  }): Promise<PageResult<Position>> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listPositions(uow.tx, {
        cursor: query.cursor,
        limit: fetchLimit(query.limit),
        ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
      });
      const page = buildPage(rows, query.limit);
      return { items: page.items.map(toPosition), next_cursor: page.next_cursor };
    });
  }
}

/** เลขผู้เสียภาษีไม่เคยออกจาก API — ส่งแค่ว่ามีบันทึกไว้หรือไม่ (spec §16) */
function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    code: row.code,
    legal_name: row.legalName,
    display_name: row.displayName,
    has_tax_id: row.taxIdEncrypted !== null,
    time_zone: row.timeZone,
    currency: row.currency,
    status: row.status as Company['status'],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toCompanyAudit(row: CompanyRow): Record<string, unknown> {
  return {
    code: row.code,
    legal_name: row.legalName,
    display_name: row.displayName,
    time_zone: row.timeZone,
    currency: row.currency,
    status: row.status,
    // ชื่อ field ลงท้าย tax_id → redactSensitive จะปิดค่าให้เอง
    tax_id_present: row.taxIdEncrypted !== null,
  };
}

function toOrgUnit(row: OrgUnitRow): OrgUnit {
  return {
    id: row.id,
    company_id: row.companyId,
    parent_id: row.parentId,
    code: row.code,
    name: row.name,
    kind: row.kind as OrgUnit['kind'],
    status: row.status as OrgUnit['status'],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    company_id: row.companyId,
    code: row.code,
    name: row.name,
    time_zone: row.timeZone,
    latitude: row.latitude,
    longitude: row.longitude,
    radius_m: row.radiusM,
    status: row.status as Site['status'],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toPosition(row: PositionRow): Position {
  return {
    id: row.id,
    company_id: row.companyId,
    code: row.code,
    title: row.title,
    status: row.status as Position['status'],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}
