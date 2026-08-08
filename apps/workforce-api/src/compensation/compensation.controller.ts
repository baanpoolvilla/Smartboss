import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  createCompensationSchema,
  listCompensationQuerySchema,
  type Compensation,
  type CreateCompensationInput,
} from '@workforce/contracts';
import type { z } from 'zod';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { decodeCursor, type PageResult } from '../shared/pagination';
import { zodPipe } from '../shared/zod-validation.pipe';
import { CompensationService } from './compensation.service';

@Controller()
export class CompensationController {
  constructor(private readonly service: CompensationService) {}

  @Get('compensation-rates')
  @RequirePermissions('workforce.payroll.read')
  async list(
    @Query(zodPipe(listCompensationQuerySchema)) query: z.infer<typeof listCompensationQuerySchema>,
  ): Promise<PageResult<Compensation>> {
    return this.service.list({
      employmentId: query.employment_id,
      cursor: decodeCursor(query.cursor),
      limit: query.limit,
      ...(query.as_of === undefined ? {} : { asOf: query.as_of }),
    });
  }

  @Post('compensation-rates')
  @HttpCode(201)
  @RequirePermissions('workforce.payroll.prepare')
  @Idempotent()
  async create(
    @Body(zodPipe(createCompensationSchema)) body: CreateCompensationInput,
  ): Promise<Compensation> {
    return this.service.create(body);
  }
}
