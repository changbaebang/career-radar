import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup-network.ts"],
    // Several tests spawn CLIs or build workspace packages; on a cold CI runner they take
    // 5-15 s, well over vitest's 5 s default. Real hangs are still caught by spawnSync's own
    // timeouts (60-180 s) in the tests that spawn processes.
    testTimeout: 30_000,
  },
});
