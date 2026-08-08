import { Module } from '@nestjs/common';
import { OutboxDispatcher } from './outbox.dispatcher';

/**
 * Phase 1 มีเฉพาะ producer + dispatcher ที่เรียกได้ตามต้องการ
 * Phase 2 จะย้าย scheduling ไป BullMQ/Redis (spec §15) โดย producer ไม่ต้องแก้
 * เพราะ producer เขียนลงตาราง `outbox_messages` อย่างเดียว
 */
@Module({
  providers: [OutboxDispatcher],
  exports: [OutboxDispatcher],
})
export class OutboxModule {}
