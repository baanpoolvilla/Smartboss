import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CheckinModule } from './checkin/checkin.module';
import { CompensationModule } from './compensation/compensation.module';
import { DeviceModule } from './devices/device.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { DocumentsModule } from './documents/documents.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { OrganizationModule } from './organization/organization.module';
import { OutboxModule } from './outbox/outbox.module';
import { PayrollModule } from './payroll/payroll.module';
import { PeopleModule } from './people/people.module';
import { RequestContextMiddleware } from './shared/request-context.middleware';
import { SystemModule } from './system/system.module';
import { WorkflowModule } from './workflow/workflow.module';

/**
 * Modular monolith — module boundary ตาม spec §15
 *
 * Phase 1 มี: organization, people-employment, audit (+ infrastructure)
 * Phase 2+ จะเพิ่ม devices, mobile-identity, time-ingestion, attendance, scheduling,
 * leave, overtime, timesheets, approvals, payroll, documents-exports
 */
@Module({
  imports: [
    // ให้ทั้ง test ตรวจ permission coverage และ diagnostics ระดับ runtime
    // สำรวจ controller/handler ได้ โดยไม่ต้องมีทะเบียน route ที่ต้องดูแลด้วยมือ
    DiscoveryModule,
    InfrastructureModule,
    AuthModule,
    IdempotencyModule,
    OutboxModule,
    SystemModule,
    OrganizationModule,
    PeopleModule,
    CompensationModule,
    DeviceModule,
    IngestionModule,
    CheckinModule,
    AttendanceModule,
    WorkflowModule,
    PayrollModule,
    DocumentsModule,
    AuditModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
