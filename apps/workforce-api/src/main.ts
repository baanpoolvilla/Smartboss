import 'reflect-metadata';
import { loadDotenvFile } from '@workforce/config';
import { startApplication } from './bootstrap';

loadDotenvFile();

startApplication().catch((error: unknown) => {
  // config ที่ไม่ครบต้องทำให้ process ตาย ไม่ใช่รันต่อด้วยค่า fallback (spec §21)
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
