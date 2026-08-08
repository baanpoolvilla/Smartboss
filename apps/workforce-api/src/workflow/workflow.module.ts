import { Module } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { OvertimeService } from './overtime.service';
import { TimesheetService } from './timesheet.service';
import { LeaveController, OvertimeController, TimesheetController } from './workflow.controller';

@Module({
  controllers: [LeaveController, OvertimeController, TimesheetController],
  providers: [LeaveService, OvertimeService, TimesheetService],
  exports: [LeaveService, OvertimeService, TimesheetService],
})
export class WorkflowModule {}
