import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OutboxDispatcher, type DispatchResult } from '@workforce/api';
import { getConfig, loadDotenvFile } from '@workforce/config';
import { WorkerModule } from './worker.module';

// อ่าน .env ก่อนแตะ config เหมือนที่ API ทำ — ไม่งั้นค่าที่ตั้งไว้ในไฟล์จะไม่ถูกเห็น
loadDotenvFile();

/**
 * โปรเซส worker — งานเบื้องหลังที่ไม่ควรแย่งทรัพยากรกับคำขอของผู้ใช้
 *
 * แยกจาก API ด้วยเหตุผลจริง ไม่ใช่เพื่อให้ผังสวย: การส่ง outbox ที่ค้างสะสม
 * อาจกิน connection pool จนหมด ถ้าอยู่โปรเซสเดียวกับ API หน้าเว็บจะช้าตามไปด้วย
 *
 * ปลอดภัยที่จะรันหลายชุดพร้อมกัน — dispatcher หยิบงานด้วย FOR UPDATE SKIP LOCKED
 * แต่ละข้อความจึงถูกหยิบโดย worker ตัวเดียวเท่านั้น (ADR-0008)
 */
async function main(): Promise<void> {
  const logger = new Logger('worker');
  const config = getConfig();

  const context = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: false,
  });
  context.enableShutdownHooks();

  const dispatcher = context.get(OutboxDispatcher);
  const intervalMs = config.OUTBOX_POLL_INTERVAL_MS;

  let stopping = false;
  let inFlight: Promise<DispatchResult> | null = null;

  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.log(`${signal} — รอรอบที่ทำอยู่ให้จบก่อนปิด`);

    // รอรอบปัจจุบันให้จบ ไม่ตัดกลางคัน: ข้อความที่ claim ไว้แล้วจะได้ไม่ค้าง
    // รอ visibility timeout หมดอายุก่อนถูกหยิบใหม่
    void Promise.resolve(inFlight)
      .catch(() => undefined)
      .then(async () => {
        await context.close();
        logger.log('ปิดเรียบร้อย');
        process.exit(0);
      });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  logger.log(`worker เริ่มทำงาน — poll ทุก ${String(intervalMs)} ms`);

  while (!stopping) {
    const current = dispatcher.dispatchBatch();
    inFlight = current;

    try {
      const result = await current;
      if (result.claimed > 0) {
        logger.log(
          `ส่ง ${String(result.dispatched)}/${String(result.claimed)} ข้อความ ` +
            `(ล้มเหลว ${String(result.failed)}, หมดสิทธิ์ลองใหม่ ${String(result.dead)})`,
        );
      }

      // มีงานค้างอยู่ก็วนต่อทันที ไม่ต้องรอครบรอบ — ช่วยไล่คิวหลังระบบล่ม
      if (result.claimed === 0 && !stopping) {
        await sleep(intervalMs);
      }
    } catch (error) {
      // รอบเดียวล้มไม่ควรทำให้ worker ตาย — ปัญหาชั่วคราวอย่าง DB ล้มจะหายเอง
      logger.error(`รอบ dispatch ล้มเหลว: ${error instanceof Error ? error.message : String(error)}`);
      if (!stopping) await sleep(intervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
