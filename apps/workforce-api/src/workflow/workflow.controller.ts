import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  cancelLeaveSchema,
  relabelLeaveSchema,
  closeTimesheetPeriodSchema,
  createLeaveTypeSchema,
  createTimesheetPeriodSchema,
  decideLeaveSchema,
  finalApproveOvertimeSchema,
  grantLeaveBalanceSchema,
  preApproveOvertimeSchema,
  reopenTimesheetPeriodSchema,
  submitLeaveSchema,
  submitOvertimeSchema,
  type SubmitLeaveInput,
  type SubmitOvertimeInput,
} from '@workforce/contracts';
import type { z } from 'zod';
import { requireUuid } from '../organization/organization.controller';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { zodPipe } from '../shared/zod-validation.pipe';
import { LeaveService, type LeaveBalance } from './leave.service';
import { OvertimeService } from './overtime.service';
import { TimesheetService } from './timesheet.service';

@Controller()
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  @Post('leave-types')
  @HttpCode(201)
  @RequirePermissions('workforce.leave.manage')
  @Idempotent()
  async createType(
    @Body(zodPipe(createLeaveTypeSchema)) body: z.infer<typeof createLeaveTypeSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.createLeaveType(body);
  }

  @Post('leave-balances:grant')
  @HttpCode(201)
  @RequirePermissions('workforce.leave.manage')
  @Idempotent()
  async grant(
    @Body(zodPipe(grantLeaveBalanceSchema)) body: z.infer<typeof grantLeaveBalanceSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.grantOpeningBalance(body);
  }

  @Get('leave-balances')
  @RequirePermissions('workforce.leave.manage')
  async balance(
    @Query('employment_id') employmentId: string,
    @Query('period_year') periodYear: string,
  ): Promise<{ items: LeaveBalance[] }> {
    return this.service.getBalance(
      requireUuid(employmentId, 'employment_id'),
      Number(periodYear),
    );
  }

  /**
   * ประเภทการลา — ทุกคนต้องอ่านได้เพื่อเลือกตอนขอลา
   * ไม่มีอะไรเป็นความลับในนี้ (ชื่อ/รหัส/ได้ค่าจ้างหรือไม่)
   */
  @Get('leave-types')
  @RequirePermissions()
  async listLeaveTypes(
    @Query('company_id') companyId?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listTypes(
      companyId === undefined ? undefined : requireUuid(companyId, 'company_id'),
    );
  }

  /**
   * ปฏิทินวันหยุดรวมของทีม — เปิดให้ทุกคนที่เข้าระบบได้
   *
   * @RequirePermissions() เปล่า = ขอแค่เป็น principal ที่ยืนยันตัวตนแล้ว
   * เพราะทั้งทีมต้องเห็นว่าใครหยุดวันไหนถึงจะวางแผนงานได้ ส่วนเหตุผล
   * และประเภทการลาไม่ถูกส่งออกมา (ดู leave.service listCalendar)
   */
  @Get('leave-calendar')
  @RequirePermissions()
  async leaveCalendar(
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listCalendar({ from, to });
  }

  /**
   * ใบลาของตัวเอง — ใช้ตอนพนักงานอยากดู/ยกเลิกใบที่ตัวเองยื่นไว้ ไม่ต้องมี
   * workforce.leave.manage (ตัวนั้นเห็นของทุกคนในบริษัท เกินความจำเป็น)
   */
  @Get('me/leave-requests')
  @RequirePermissions('workforce.leave.request')
  async myLeaveRequests(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listMyRequests({
      ...(status === undefined ? {} : { status }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
  }

  @Get('leave-requests')
  @RequirePermissions('workforce.leave.manage')
  async listLeaveRequests(
    @Query('company_id') companyId?: string,
    @Query('employment_id') employmentId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listRequests({
      ...(companyId === undefined ? {} : { companyId }),
      ...(employmentId === undefined ? {} : { employmentId }),
      ...(status === undefined ? {} : { status }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
  }

  @Post('leave-requests')
  @HttpCode(201)
  @RequirePermissions('workforce.leave.request')
  @Idempotent()
  async submit(
    @Body(zodPipe(submitLeaveSchema)) body: SubmitLeaveInput,
  ): Promise<Record<string, unknown>> {
    return this.service.submitRequest(body);
  }

  @Post('leave-requests/:requestId/decide')
  @HttpCode(200)
  @RequirePermissions('workforce.leave.approve')
  @Idempotent()
  async decide(
    @Param('requestId') requestId: string,
    @Body(zodPipe(decideLeaveSchema)) body: z.infer<typeof decideLeaveSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.decideRequest(requireUuid(requestId, 'requestId'), body);
  }

  /** ยกเลิกใบลาของตัวเอง — สิทธิ์เดียวกับที่ใช้ยื่น */
  @Post('leave-requests/:requestId/cancel')
  @HttpCode(200)
  @RequirePermissions('workforce.leave.request')
  @Idempotent()
  async cancel(
    @Param('requestId') requestId: string,
    @Body(zodPipe(cancelLeaveSchema)) body: z.infer<typeof cancelLeaveSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.cancelRequest(requireUuid(requestId, 'requestId'), body.reason);
  }

  /**
   * เปลี่ยนชื่อที่ขึ้นบนปฏิทินของใบลา — ของตัวเองแก้ได้ด้วยสิทธิ์ขอลาพื้นฐาน
   * (service ตรวจความเป็นเจ้าของเอง และยอมให้คนที่อนุมัติได้แก้ของคนอื่น)
   */
  @Post('leave-requests/:requestId/relabel')
  @HttpCode(200)
  @RequirePermissions('workforce.leave.request')
  @Idempotent()
  async relabel(
    @Param('requestId') requestId: string,
    @Body(zodPipe(relabelLeaveSchema)) body: z.infer<typeof relabelLeaveSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.relabelRequest(requireUuid(requestId, 'requestId'), body.display_label);
  }

  /**
   * ยกเลิกใบลาแทนคนอื่น — ฝ่ายบุคคล/หัวหน้าที่มีสิทธิ์อนุมัติ
   *
   * แยก endpoint ไม่ใช่ทำ guard ให้รับแบบ OR ตามข้อตกลงใน shared/decorators.ts
   * ("ถ้าต้องการ OR ให้แยกเป็นคนละ endpoint") — และแยกแล้วดีกว่าจริงตรงที่
   * audit log บอกได้ทันทีว่าเป็นการยกเลิกของตัวเองหรือยกเลิกแทนคนอื่น
   *
   * ต้องมีเส้นทางนี้เพราะบทบาทฝ่ายบุคคล (HR_OFFICER) จงใจไม่มีสิทธิ์ประเภท
   * self-service เลย — คนคนหนึ่งถือสองบทบาท: EMPLOYEE สำหรับเรื่องของตัวเอง
   * และ HR_OFFICER สำหรับงานบริหาร ฝ่ายบุคคลจึงยิงเส้นทาง /cancel ไม่ได้
   */
  @Post('leave-requests/:requestId/cancel-for')
  @HttpCode(200)
  @RequirePermissions('workforce.leave.approve')
  @Idempotent()
  async cancelFor(
    @Param('requestId') requestId: string,
    @Body(zodPipe(cancelLeaveSchema)) body: z.infer<typeof cancelLeaveSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.cancelRequest(requireUuid(requestId, 'requestId'), body.reason);
  }
}

@Controller()
export class OvertimeController {
  constructor(private readonly service: OvertimeService) {}

  @Post('overtime-requests')
  @HttpCode(201)
  @RequirePermissions('workforce.overtime.request')
  @Idempotent()
  async submit(
    @Body(zodPipe(submitOvertimeSchema)) body: SubmitOvertimeInput,
  ): Promise<Record<string, unknown>> {
    return this.service.submit(body);
  }

  @Post('overtime-requests/:requestId/pre-approve')
  @HttpCode(200)
  @RequirePermissions('workforce.overtime.approve')
  @Idempotent()
  async preApprove(
    @Param('requestId') requestId: string,
    @Body(zodPipe(preApproveOvertimeSchema)) body: z.infer<typeof preApproveOvertimeSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.preApprove(requireUuid(requestId, 'requestId'), body.reason);
  }

  @Post('overtime-requests/:requestId/final-approve')
  @HttpCode(200)
  @RequirePermissions('workforce.overtime.approve')
  @Idempotent()
  async finalApprove(
    @Param('requestId') requestId: string,
    @Body(zodPipe(finalApproveOvertimeSchema)) body: z.infer<typeof finalApproveOvertimeSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.finalApprove(requireUuid(requestId, 'requestId'), body);
  }

  @Get('overtime-requests')
  @RequirePermissions('workforce.overtime.manage')
  async list(
    @Query('employment_id') employmentId: string | undefined,
    @Query('status') status: string | undefined,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.list({
      ...(employmentId === undefined ? {} : { employmentId: requireUuid(employmentId, 'employment_id') }),
      ...(status === undefined ? {} : { status }),
    });
  }
}

@Controller()
export class TimesheetController {
  constructor(private readonly service: TimesheetService) {}

  @Post('timesheet-periods')
  @HttpCode(201)
  @RequirePermissions('workforce.timesheet.review')
  @Idempotent()
  async createPeriod(
    @Body(zodPipe(createTimesheetPeriodSchema)) body: z.infer<typeof createTimesheetPeriodSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.createPeriod(body);
  }

  /** สร้าง snapshot จาก attendance result ฝั่ง server — ไม่รับตัวเลขจาก client */
  @Post('timesheet-periods/:periodId/generate')
  @HttpCode(200)
  @RequirePermissions('workforce.timesheet.review')
  @Idempotent()
  async generate(@Param('periodId') periodId: string): Promise<{ employments: number }> {
    return this.service.generate(requireUuid(periodId, 'periodId'));
  }

  @Get('timesheet-periods')
  @RequirePermissions('workforce.timesheet.review')
  async listPeriods(@Query('company_id') companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listPeriods(
      companyId === undefined ? undefined : requireUuid(companyId, 'company_id'),
    );
  }

  @Get('timesheet-periods/:periodId/timesheets')
  @RequirePermissions('workforce.timesheet.review')
  async list(@Param('periodId') periodId: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listTimesheets(requireUuid(periodId, 'periodId'));
  }

  @Post('timesheet-periods/:periodId/close')
  @HttpCode(200)
  @RequirePermissions('workforce.timesheet.close')
  @Idempotent()
  async close(
    @Param('periodId') periodId: string,
    @Body(zodPipe(closeTimesheetPeriodSchema)) body: z.infer<typeof closeTimesheetPeriodSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.close(requireUuid(periodId, 'periodId'), body);
  }

  @Post('timesheet-periods/:periodId/reopen')
  @HttpCode(200)
  @RequirePermissions('workforce.timesheet.reopen')
  @Idempotent()
  async reopen(
    @Param('periodId') periodId: string,
    @Body(zodPipe(reopenTimesheetPeriodSchema)) body: z.infer<typeof reopenTimesheetPeriodSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.reopen(requireUuid(periodId, 'periodId'), body.reason);
  }
}
