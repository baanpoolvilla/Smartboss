import { Module } from '@nestjs/common';
import { AuditController, AuditQueryService } from './audit.controller';

@Module({
  controllers: [AuditController],
  providers: [AuditQueryService],
})
export class AuditModule {}
