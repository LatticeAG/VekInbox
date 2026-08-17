import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Exercise workspace source in a clean checkout. Package exports point at
    // dist for published consumers, which intentionally does not exist before
    // a local build.
    alias: {
      "@latticeag/vekinbox-shared": fromRoot("./packages/shared/src/index.ts"),
      "@latticeag/vekinbox-db": fromRoot("./packages/db/src/index.ts"),
      "@latticeag/vekinbox-queue": fromRoot("./packages/queue/src/index.ts"),
      "@latticeag/vekinbox": fromRoot("./packages/sdk/src/index.ts"),
      "@latticeag/vekinbox-core": fromRoot("./packages/core/src/index.ts"),
      "@latticeag/vekinbox-integration-core": fromRoot(
        "./packages/integration-core/src/index.ts",
      ),
      "@latticeag/vekinbox-langchain": fromRoot("./packages/langchain/src/index.ts"),
      "@latticeag/vekinbox-ai-sdk": fromRoot("./packages/ai-sdk/src/index.ts"),
    },
  },
  esbuild: {
    target: "node22",
  },
  test: {
    globals: false,
    environment: "node",
    include: [
      "apps/api/tests/**/*.test.ts",
      "apps/worker/src/**/*.test.ts",
      "apps/web/tests/**/*.test.ts",
      "packages/shared/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
