import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    target: "node22",
  },
  test: {
    globals: false,
    environment: "node",
    include: [
      "apps/api/tests/**/*.test.ts",
      "packages/shared/src/**/*.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
