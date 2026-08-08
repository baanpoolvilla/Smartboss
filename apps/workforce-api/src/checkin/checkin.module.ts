import { Module } from '@nestjs/common';
import { CheckinController } from './checkin.controller';
import { CheckinRepository } from './checkin.repository';
import { CheckinService } from './checkin.service';
import { PolicyGroupService } from './policy-group.service';

@Module({
  controllers: [CheckinController],
  providers: [CheckinService, PolicyGroupService, CheckinRepository],
  exports: [CheckinService, PolicyGroupService, CheckinRepository],
})
export class CheckinModule {}
