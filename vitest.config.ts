import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "app/**/layout.tsx",
        "components/ui/**",
        "**/*.d.ts",
      ],
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "inngest/**/*.ts",
        "lib/**/*.ts",
        "proxy.ts",
        "services/**/*.ts",
      ],
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        branches: 67,
        functions: 77,
        lines: 80,
        statements: 74,
      },
    },
    exclude: ["tests/e2e/**", "node_modules/**", ".worktrees/**"],
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
