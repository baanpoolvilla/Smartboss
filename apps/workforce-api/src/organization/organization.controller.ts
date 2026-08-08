import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createCompanySchema,
  createOrgUnitSchema,
  createPositionSchema,
  createSiteSchema,
  listCompaniesQuerySchema,
  listOrgUnitsQuerySchema,
  listPositionsQuerySchema,
  listSitesQuerySchema,
  updateCompanySchema,
  type Company,
  type CreateCompanyInput,
  type CreateOrgUnitInput,
  type CreatePositionInput,
  type CreateSiteInput,
  type OrgUnit,
  type Position,
  type Site,
  type UpdateCompanyInput,
} from '@workforce/contracts';
import { AppError, isUuid } from '@workforce/domain';
import type { z } from 'zod';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { decodeCursor, type PageResult } from '../shared/pagination';
import { zodPipe } from '../shared/zod-validation.pipe';
import { OrganizationService } from './organization.service';

/** Controller ทำหน้าที่ HTTP อย่างเดียว — business rule อยู่ใน service (ADR-0004) */
@Controller()
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  @Get('companies')
  @RequirePermissions('workforce.people.read')
  async listCompanies(
    @Query(zodPipe(listCompaniesQuerySchema)) query: z.infer<typeof listCompaniesQuerySchema>,
  ): Promise<PageResult<Company>> {
    return this.service.listCompanies({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.status === undefined ? {} : { status: query.status }),
    });
  }

  @Post('companies')
  @HttpCode(201)
  @RequirePermissions('workforce.settings.manage')
  @Idempotent()
  async createCompany(
    @Body(zodPipe(createCompanySchema)) body: CreateCompanyInput,
  ): Promise<Company> {
    return this.service.createCompany(body);
  }

  @Get('companies/:companyId')
  @RequirePermissions('workforce.people.read')
  async getCompany(@Param('companyId') companyId: string): Promise<Company> {
    return this.service.getCompany(requireUuid(companyId, 'companyId'));
  }

  @Patch('companies/:companyId')
  @RequirePermissions('workforce.settings.manage')
  async updateCompany(
    @Param('companyId') companyId: string,
    @Body(zodPipe(updateCompanySchema)) body: UpdateCompanyInput,
  ): Promise<Company> {
    return this.service.updateCompany(requireUuid(companyId, 'companyId'), body);
  }

  @Get('org-units')
  @RequirePermissions('workforce.people.read')
  async listOrgUnits(
    @Query(zodPipe(listOrgUnitsQuerySchema)) query: z.infer<typeof listOrgUnitsQuerySchema>,
  ): Promise<PageResult<OrgUnit>> {
    return this.service.listOrgUnits({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.company_id === undefined ? {} : { companyId: query.company_id }),
    });
  }

  @Post('org-units')
  @HttpCode(201)
  @RequirePermissions('workforce.settings.manage')
  @Idempotent()
  async createOrgUnit(
    @Body(zodPipe(createOrgUnitSchema)) body: CreateOrgUnitInput,
  ): Promise<OrgUnit> {
    return this.service.createOrgUnit(body);
  }

  @Get('sites')
  @RequirePermissions('workforce.people.read')
  async listSites(
    @Query(zodPipe(listSitesQuerySchema)) query: z.infer<typeof listSitesQuerySchema>,
  ): Promise<PageResult<Site>> {
    return this.service.listSites({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.company_id === undefined ? {} : { companyId: query.company_id }),
    });
  }

  @Post('sites')
  @HttpCode(201)
  @RequirePermissions('workforce.settings.manage')
  @Idempotent()
  async createSite(@Body(zodPipe(createSiteSchema)) body: CreateSiteInput): Promise<Site> {
    return this.service.createSite(body);
  }

  @Get('positions')
  @RequirePermissions('workforce.people.read')
  async listPositions(
    @Query(zodPipe(listPositionsQuerySchema)) query: z.infer<typeof listPositionsQuerySchema>,
  ): Promise<PageResult<Position>> {
    return this.service.listPositions({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.company_id === undefined ? {} : { companyId: query.company_id }),
    });
  }

  @Post('positions')
  @HttpCode(201)
  @RequirePermissions('workforce.settings.manage')
  @Idempotent()
  async createPosition(
    @Body(zodPipe(createPositionSchema)) body: CreatePositionInput,
  ): Promise<Position> {
    return this.service.createPosition(body);
  }
}

export function requireUuid(value: string, field: string): string {
  if (!isUuid(value)) throw AppError.validation(`${field} must be a UUID`);
  return value;
}
