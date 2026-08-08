import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DeviceModule } from '../devices/device.module';
import { DeviceActivationService } from './device-activation.service';
import { DeviceAuthGuard } from './device-auth.guard';
import {
  DeviceActivationController,
  DeviceIngestionController,
  LegacyIngestionController,
} from './ingestion.controller';
import { IngestionService } from './ingestion.service';

/**
 * Device ingestion boundary (spec §1.2)
 *
 * แยก module ออกจาก business API แม้จะ deploy อยู่ process เดียวกัน เพื่อให้
 * แยกออกไปเป็น service ของตัวเองได้ในอนาคตโดยไม่ต้องรื้อ
 */
@Module({
  imports: [DeviceModule],
  controllers: [DeviceIngestionController, DeviceActivationController, LegacyIngestionController],
  providers: [
    IngestionService,
    DeviceActivationService,
    { provide: APP_GUARD, useClass: DeviceAuthGuard },
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
