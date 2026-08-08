import { Module } from '@nestjs/common';
import { InfrastructureModule, OutboxModule } from '@workforce/api';

/**
 * worker ใช้เฉพาะสองโมดูลนี้ — ไม่ดึง AppModule ทั้งก้อนเข้ามา
 * เพราะจะลาก controller และ HTTP guard ที่โปรเซสนี้ไม่ได้ใช้ติดมาด้วย
 */
@Module({
  imports: [InfrastructureModule, OutboxModule],
})
export class WorkerModule {}
