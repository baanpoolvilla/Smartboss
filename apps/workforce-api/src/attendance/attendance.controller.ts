import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  addHolidayDatesSchema,
  approveAdjustmentSchema,
  bulkUpsertAssignmentsSchema,
  createAdjustmentSchema,
  createHolidayCalendarSchema,
  createRosterPeriodSchema,
  createShiftSchema,
  createWorkPolicySchema,
  listAttendanceResultsQuerySchema,
  listExceptionsQuerySchema,
  recalculateSchema,
  resolveExceptionSchema,
  setRecurringPatternSchema,
  type CreateAdjustmentInput,
  type CreateShiftInput,
  type CreateWorkPolicyInput,
  type SetRecurringPatternInput,
} from '@workforce/contracts';
import type { z } from 'zod';
import { requireUuid } from '../organization/organization.controller';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { zodPipe } from '../shared/zod-validation.pipe';
import { AttendanceService } from './attendance.service';
import { SchedulingService } from './scheduling.service';

@Controller()
export class SchedulingController {
  constructor(private readonly service: SchedulingService) {}

  @Get('shifts')
  @RequirePermissions('workforce.scheduling.read')
  async listShifts(@Query('company_id') companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listShifts(
      companyId === undefined ? undefined : requireUuid(companyId, 'company_id'),
    );
  }

  @Get('work-policies')
  @RequirePermissions('workforce.scheduling.read')
  async listWorkPolicies(
    @Query('company_id') companyId?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listWorkPolicies(
      companyId === undefined ? undefined : requireUuid(companyId, 'company_id'),
    );
  }

  @Get('roster-periods')
  @RequirePermissions('workforce.scheduling.read')
  async listRosterPeriods(
    @Query('company_id') companyId?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listRosterPeriods(
      companyId === undefined ? undefined : requireUuid(companyId, 'company_id'),
    );
  }

  @Get('shift-assignments')
  @RequirePermissions('workforce.scheduling.read')
  async listShiftAssignments(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('employment_id') employmentId?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listShiftAssignments({
      from,
      to,
      ...(employmentId === undefined ? {} : { employmentId: requireUuid(employmentId, 'employment_id') }),
    });
  }

  @Post('work-policies')
  @HttpCode(201)
  @RequirePermissions('workforce.scheduling.manage')
  @Idempotent()
  async createWorkPolicy(
    @Body(zodPipe(createWorkPolicySchema)) body: CreateWorkPolicyInput,
  ): Promise<Record<string, unknown>> {
    return this.service.createWorkPolicy(body);
  }

  @Post('shifts')
  @HttpCode(201)
  @RequirePermissions('workforce.scheduling.manage')
  @Idempotent()
  async createShift(
    @Body(zodPipe(createShiftSchema)) body: CreateShiftInput,
  ): Promise<Record<string, unknown>> {
    return this.service.createShift(body);
  }

  @Post('recurring-work-patterns')
  @HttpCode(201)
  @RequirePermissions('workforce.scheduling.manage')
  @Idempotent()
  async setPattern(
    @Body(zodPipe(setRecurringPatternSchema)) body: SetRecurringPatternInput,
  ): Promise<Record<string, unknown>> {
    return this.service.setRecurringPattern(body);
  }

  @Post('roster-periods')
  @HttpCode(201)
  @RequirePermissions('workforce.scheduling.manage')
  @Idempotent()
  async createRoster(
    @Body(zodPipe(createRosterPeriodSchema)) body: z.infer<typeof createRosterPeriodSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.createRosterPeriod(body);
  }

  @Post('roster-periods/:rosterId/shift-assignments:bulk-upsert')
  @HttpCode(200)
  @RequirePermissions('workforce.scheduling.manage')
  @Idempotent()
  async bulkUpsert(
    @Param('rosterId') rosterId: string,
    @Body(zodPipe(bulkUpsertAssignmentsSchema)) body: z.infer<typeof bulkUpsertAssignmentsSchema>,
  ): Promise<{ upserted: number }> {
    return this.service.bulkUpsertAssignments(requireUuid(rosterId, 'rosterId'), body.assignments);
  }

  /** publish คือจุดที่ตารางเริ่มมีผลกับการคำนวณเวลาและพนักงานมองเห็น */
  @Post('roster-periods/:rosterId/publish')
  @HttpCode(200)
  @RequirePermissions('workforce.scheduling.publish')
  @Idempotent()
  async publishRoster(@Param('rosterId') rosterId: string): Promise<Record<string, unknown>> {
    return this.service.publishRoster(requireUuid(rosterId, 'rosterId'));
  }

  @Get('holiday-calendars')
  @RequirePermissions('workforce.scheduling.read')
  async listCalendars(
    @Query('company_id') companyId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listHolidayCalendars({
      ...(companyId === undefined ? {} : { companyId: requireUuid(companyId, 'company_id') }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
  }

  /**
   * ลบวันหยุดหนึ่งวัน — ใช้ POST ไม่ใช่ DELETE เพราะต้องผ่าน @Idempotent()
   * ซึ่งอ่าน Idempotency-Key แบบเดียวกับ mutation ตัวอื่น
   *
   * path เป็น /delete ไม่ใช่ :delete แบบ biometric-enrollments เพราะที่นี่
   * suffix ต่อท้าย **พารามิเตอร์** ไม่ใช่ต่อท้าย segment คงที่ — ติดกันแล้ว
   * router จะอ่านชื่อพารามิเตอร์เป็น "holidayDateId:delete"
   */
  @Post('holiday-dates/:holidayDateId/delete')
  @HttpCode(200)
  @RequirePermissions('workforce.scheduling.manage')
  @Idempotent()
  async deleteHolidayDate(
    @Param('holidayDateId') holidayDateId: string,
  ): Promise<{ deleted: number }> {
    return this.service.deleteHolidayDate(requireUuid(holidayDateId, 'holidayDateId'));
  }

  @Post('holiday-calendars')
  @HttpCode(201)
  @RequirePermissions('workforce.scheduling.manage')
  @Idempotent()
  async createCalendar(
    @Body(zodPipe(createHolidayCalendarSchema)) body: z.infer<typeof createHolidayCalendarSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.createHolidayCalendar(body);
  }

  @Post('holiday-calendars/:calendarId/dates')
  @HttpCode(201)
  @RequirePermissions('workforce.scheduling.manage')
  @Idempotent()
  async addHolidays(
    @Param('calendarId') calendarId: string,
    @Body(zodPipe(addHolidayDatesSchema)) body: z.infer<typeof addHolidayDatesSchema>,
  ): Promise<{ added: number }> {
    return this.service.addHolidayDates(requireUuid(calendarId, 'calendarId'), body.dates);
  }
}

@Controller()
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  /** สรุปสถิติสำหรับหน้า dashboard */
  /**
   * กระดานลงเวลาของทีมสำหรับวันหนึ่ง — เปิดให้ทุกคนที่เข้าระบบได้
   *
   * @RequirePermissions() เปล่า เพราะทั้งทีมควรเห็นว่าใครมาถึงแล้วบ้าง
   * คืนเฉพาะ ชื่อ + เวลา + สถานะสาย/ปกติ (ดู listTimeEventBoard)
   */
  @Get('time-event-board')
  @RequirePermissions()
  async timeEventBoard(
    @Query('date') date: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listTimeEventBoard(date);
  }

  @Get('attendance-summary')
  @RequirePermissions('workforce.attendance.read.all')
  async summary(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('company_id') companyId?: string,
  ): Promise<Record<string, unknown>> {
    return this.service.summarize({
      from,
      to,
      ...(companyId === undefined ? {} : { companyId: requireUuid(companyId, 'company_id') }),
    });
  }

  @Get('attendance-results')
  @RequirePermissions('workforce.attendance.read.all')
  async listResults(
    @Query(zodPipe(listAttendanceResultsQuerySchema))
    query: z.infer<typeof listAttendanceResultsQuerySchema>,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listResults({
      from: query.from,
      to: query.to,
      ...(query.employment_id === undefined ? {} : { employmentId: query.employment_id }),
      ...(query.company_id === undefined ? {} : { companyId: query.company_id }),
    });
  }

  @Post('attendance-results:recalculate')
  @HttpCode(200)
  @RequirePermissions('workforce.attendance.read.all')
  @Idempotent()
  async recalculate(
    @Body(zodPipe(recalculateSchema)) body: z.infer<typeof recalculateSchema>,
  ): Promise<{ recalculated: number }> {
    return this.service.recalculateRange(body.employment_id, body.from, body.to);
  }

  @Get('attendance-exceptions')
  @RequirePermissions('workforce.attendance.read.all')
  async listExceptions(
    @Query(zodPipe(listExceptionsQuerySchema)) query: z.infer<typeof listExceptionsQuerySchema>,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listExceptions({
      ...(query.company_id === undefined ? {} : { companyId: query.company_id }),
      ...(query.employment_id === undefined ? {} : { employmentId: query.employment_id }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });
  }

  @Post('attendance-exceptions/:exceptionId/resolve')
  @HttpCode(200)
  @RequirePermissions('workforce.attendance.correct.approve')
  @Idempotent()
  async resolveException(
    @Param('exceptionId') exceptionId: string,
    @Body(zodPipe(resolveExceptionSchema)) body: z.infer<typeof resolveExceptionSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.resolveException(requireUuid(exceptionId, 'exceptionId'), body);
  }

  @Post('attendance-correction-requests')
  @HttpCode(201)
  @RequirePermissions('workforce.attendance.correct.request')
  @Idempotent()
  async requestAdjustment(
    @Body(zodPipe(createAdjustmentSchema)) body: CreateAdjustmentInput,
  ): Promise<Record<string, unknown>> {
    return this.service.requestAdjustment(body);
  }

  @Post('attendance-correction-requests/:adjustmentId/approve')
  @HttpCode(200)
  @RequirePermissions('workforce.attendance.correct.approve')
  @Idempotent()
  async approveAdjustment(
    @Param('adjustmentId') adjustmentId: string,
    @Body(zodPipe(approveAdjustmentSchema)) body: z.infer<typeof approveAdjustmentSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.approveAdjustment(requireUuid(adjustmentId, 'adjustmentId'), body);
  }
}
