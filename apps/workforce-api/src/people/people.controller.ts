import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createAssignmentSchema,
  createEmploymentSchema,
  createPersonSchema,
  listEmploymentsQuerySchema,
  listPeopleQuerySchema,
  terminateEmploymentSchema,
  updatePersonSchema,
  type Assignment,
  type CreateAssignmentInput,
  type CreateEmploymentInput,
  type CreatePersonInput,
  type Employment,
  type Person,
} from '@workforce/contracts';
import type { z } from 'zod';
import { requireUuid } from '../organization/organization.controller';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { decodeCursor, type PageResult } from '../shared/pagination';
import { zodPipe } from '../shared/zod-validation.pipe';
import { PeopleService } from './people.service';

@Controller()
export class PeopleController {
  constructor(private readonly service: PeopleService) {}

  @Get('people')
  @RequirePermissions('workforce.people.read')
  async listPeople(
    @Query(zodPipe(listPeopleQuerySchema)) query: z.infer<typeof listPeopleQuerySchema>,
  ): Promise<PageResult<Person>> {
    return this.service.listPeople({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.search === undefined ? {} : { search: query.search }),
    });
  }

  @Post('people')
  @HttpCode(201)
  @RequirePermissions('workforce.people.manage')
  @Idempotent()
  async createPerson(@Body(zodPipe(createPersonSchema)) body: CreatePersonInput): Promise<Person> {
    return this.service.createPerson(body);
  }

  @Get('people/:personId')
  @RequirePermissions('workforce.people.read')
  async getPerson(@Param('personId') personId: string): Promise<Person> {
    return this.service.getPerson(requireUuid(personId, 'personId'));
  }

  @Patch('people/:personId')
  @RequirePermissions('workforce.people.manage')
  async updatePerson(
    @Param('personId') personId: string,
    @Body(zodPipe(updatePersonSchema)) body: Partial<CreatePersonInput>,
  ): Promise<Person> {
    return this.service.updatePerson(requireUuid(personId, 'personId'), body);
  }

  @Get('employments')
  @RequirePermissions('workforce.people.read')
  async listEmployments(
    @Query(zodPipe(listEmploymentsQuerySchema)) query: z.infer<typeof listEmploymentsQuerySchema>,
  ): Promise<PageResult<Employment>> {
    return this.service.listEmployments({
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.company_id === undefined ? {} : { companyId: query.company_id }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.person_id === undefined ? {} : { personId: query.person_id }),
      ...(query.as_of === undefined ? {} : { asOf: query.as_of }),
    });
  }

  @Post('employments')
  @HttpCode(201)
  @RequirePermissions('workforce.people.manage')
  @Idempotent()
  async createEmployment(
    @Body(zodPipe(createEmploymentSchema)) body: CreateEmploymentInput,
  ): Promise<Employment> {
    return this.service.createEmployment(body);
  }

  @Get('employments/:employmentId')
  @RequirePermissions('workforce.people.read')
  async getEmployment(@Param('employmentId') employmentId: string): Promise<Employment> {
    return this.service.getEmployment(requireUuid(employmentId, 'employmentId'));
  }

  @Post('employments/:employmentId/terminate')
  @HttpCode(200)
  @RequirePermissions('workforce.people.manage')
  @Idempotent()
  async terminateEmployment(
    @Param('employmentId') employmentId: string,
    @Body(zodPipe(terminateEmploymentSchema)) body: z.infer<typeof terminateEmploymentSchema>,
  ): Promise<Employment> {
    return this.service.terminateEmployment(requireUuid(employmentId, 'employmentId'), body);
  }

  @Get('employments/:employmentId/assignments')
  @RequirePermissions('workforce.people.read')
  async listAssignments(
    @Param('employmentId') employmentId: string,
  ): Promise<PageResult<Assignment>> {
    return this.service.listAssignments(requireUuid(employmentId, 'employmentId'));
  }

  @Post('employments/:employmentId/assignments')
  @HttpCode(201)
  @RequirePermissions('workforce.people.manage')
  @Idempotent()
  async createAssignment(
    @Param('employmentId') employmentId: string,
    @Body(zodPipe(createAssignmentSchema)) body: CreateAssignmentInput,
  ): Promise<Assignment> {
    return this.service.createAssignment(requireUuid(employmentId, 'employmentId'), body);
  }
}
