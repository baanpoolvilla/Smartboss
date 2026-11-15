import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Lets the existing colocated `*.test.ts` files under modules/** (e.g.
 * report-cutoff.test.ts, permissions.test.ts) actually resolve their `@/...`
 * imports when run — nothing pointed vitest at the app's own `@/*` → `./`
 * tsconfig path before this, so `npx vitest run` from apps/web failed to
 * load any of them.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      // See test/server-only-shim.ts — lets tests import server-only-marked
      // modules (e.g. lib/report-penalty-sweep.ts) without a bundler-only
      // package erroring out under plain Node.
      "server-only": resolve(__dirname, "test/server-only-shim.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["modules/**/*.test.ts"],
    // ไฟล์ใน __tests__/ เขียนด้วย node:test (รันผ่าน `pnpm test` / test:tenant-isolation)
    // ไม่ใช่ vitest — ถ้าไม่ตัดออก vitest จะฟ้อง "No test suite found" แล้วจบด้วย exit 1
    // ข้อตกลง: node:test อยู่ใน __tests__/ · vitest วางข้างไฟล์ที่ทดสอบ (*.test.ts)
    exclude: ["**/node_modules/**", "**/.next/**", "**/__tests__/**"],
  },
});
