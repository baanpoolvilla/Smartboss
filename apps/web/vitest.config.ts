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
    },
  },
  test: {
    environment: "node",
    include: ["modules/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
