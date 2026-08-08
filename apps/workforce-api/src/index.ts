/**
 * จุดที่โปรเซสอื่นในระบบ (worker, device-gateway) หยิบโมดูลไปใช้
 *
 * ทั้งสามโปรเซสใช้ InfrastructureModule ตัวเดียวกันโดยตั้งใจ — connection pool,
 * การเข้ารหัสฟิลด์ และ RLS context จึงมีพฤติกรรมเหมือนกันทุกที่
 * ถ้าแยกเป็นคนละชุดจะเพี้ยนกันเงียบ ๆ ตอน config ต่างกันแค่นิดเดียว
 */
export { AppModule } from './app.module';
export { configureApplication, createApplication, startApplication } from './bootstrap';
export { InfrastructureModule } from './infrastructure/infrastructure.module';
export { OutboxModule } from './outbox/outbox.module';
export {
  OutboxDispatcher,
  type DispatchResult,
  type OutboxMessage,
  type OutboxSink,
} from './outbox/outbox.dispatcher';
export { APP_CONFIG, CLOCK, DATABASE_HANDLE, OBJECT_STORAGE } from './shared/tokens';
