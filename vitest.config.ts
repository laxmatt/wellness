import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Two suites exercise the real ledger against one Postgres database, and
    // both drop its tables between tests. Run in parallel they delete each
    // other's fixtures and fail for reasons that have nothing to do with the
    // code. The whole suite is a few seconds either way.
    fileParallelism: false,
  },
});
