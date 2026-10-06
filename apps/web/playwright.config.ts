import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const PORT = 7790;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = path.join(repo, "apps", "web", "test-results", "server-data");

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1920, height: 1080 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: `rm -rf "${dataDir}" && bun apps/server/src/main.ts serve`,
    cwd: repo,
    url: `http://127.0.0.1:${PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      COUCH_MOCK: "1",
      COUCH_NOW: "2026-10-03T19:00:00.000Z",
      COUCH_PORT: String(PORT),
      COUCH_DATA_DIR: dataDir,
    },
  },
});
