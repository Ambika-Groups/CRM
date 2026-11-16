import { defineConfig } from "vitest/config";

// The whole-demo tests seed a few thousand records; on a busy machine (builds and browser checks running beside them)
// they need more than the default five seconds.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
