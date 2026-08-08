import { Module } from '@nestjs/common';
import { DeviceController } from './device.controller';
import { DeviceRepository } from './device.repository';
import { DeviceService } from './device.service';

@Module({
  controllers: [DeviceController],
  providers: [DeviceService, DeviceRepository],
  exports: [DeviceService, DeviceRepository],
})
export class DeviceModule {}
