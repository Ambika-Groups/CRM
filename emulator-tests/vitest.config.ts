import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@ag/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)) } },
  test: { testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false, include: ["*.test.ts"] },
});
