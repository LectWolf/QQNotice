import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    globalSetup: ["./test/setup.ts"],
    // E2E tests share the same MySQL test DB and call resetDb in beforeEach.
    // Running test files in parallel would corrupt each other. Serial is fine
    // — total runtime is < 10s.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
  },
});
