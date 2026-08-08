import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * เทสต์ของโมดูล workforce (HR / ลงเวลา / เงินเดือน) — แยก config จาก Next.js
 *
 * NestJS DI ต้องใช้ metadata จาก `emitDecoratorMetadata` ซึ่ง esbuild (ตัว transform
 * เริ่มต้นของ Vitest) ไม่ปล่อยออกมา จึงใช้ SWC แทน — เป็นวิธีที่ NestJS แนะนำเอง
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  // ปิดการค้นหา PostCSS config: ไม่งั้น Vite จะไปเจอ postcss config ของ apps/web (Tailwind)
  css: { postcss: { plugins: [] } },
  resolve: {
    // ชี้ไปที่ src ตรง ๆ เพื่อให้รัน test ได้โดยไม่ต้อง build ก่อน
    alias: {
      '@workforce/attendance-engine': resolve(__dirname, 'packages/workforce/attendance-engine/src/index.ts'),
      '@workforce/payroll-engine': resolve(__dirname, 'packages/workforce/payroll-engine/src/index.ts'),
      '@workforce/config': resolve(__dirname, 'packages/workforce/config/src/index.ts'),
      '@workforce/contracts': resolve(__dirname, 'packages/workforce/contracts/src/index.ts'),
      '@workforce/db': resolve(__dirname, 'packages/workforce/db/src/index.ts'),
      '@workforce/domain': resolve(__dirname, 'packages/workforce/domain/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/workforce/**/*.test.ts', 'apps/workforce-*/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'attendance/**'],
    // PGlite เป็น WASM instance ต่อ test file — ตั้ง timeout เผื่อรอบแรกที่ต้องโหลด
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // แต่ละไฟล์สร้าง database ของตัวเอง จึงขนานกันได้ปลอดภัย
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['packages/workforce/*/src/**/*.ts', 'apps/workforce-*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/cli/**', '**/testing/**', '**/dist/**'],
    },
  },
});
