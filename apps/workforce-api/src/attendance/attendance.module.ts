import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { AttendanceController, SchedulingController } from './attendance.controller';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceService } from './attendance.service';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [WorkflowModule],
  controllers: [SchedulingController, AttendanceController],
  providers: [AttendanceService, SchedulingService, AttendanceRepository],
  exports: [AttendanceService, SchedulingService, AttendanceRepository],
})
export class AttendanceModule {}
