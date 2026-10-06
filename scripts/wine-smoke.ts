/**
 * Optional Windows smoke test: runs the cross-compiled .exe under Wine (not part of `check`).
 *   bun run build --target windows && bun scripts/wine-smoke.ts
 * Checks: `version`, `serve` in mock mode answers /api/status with platform "windows",
 * and the UI is served. Extra checks are added per phase (see docs/DESIGN.md).
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dir, "..");
const exe = path.join(repo, "out", "couch-launcher-windows-x64.exe");
const prefix = process.env.WINEPREFIX || path.join(repo, "out", "wineprefix");
mkdirSync(prefix, { recursive: true });
const env = { ...process.env, WINEPREFIX: prefix, WINEDEBUG: "-all" };

if (!Bun.which("wine")) {
  console.log("wine not installed; skipping");
  process.exit(0);
}
if (!existsSync(exe)) {
  console.error("missing out/couch-launcher-windows-x64.exe; run `bun run build --target windows`");
  process.exit(1);
}

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

const v = Bun.spawnSync(["wine", exe, "version"], { env, stdout: "pipe", stderr: "pipe" });
check("version", v.stdout.toString().trim() === "0.1.0", v.stdout.toString().trim());

const port = 7803;
const server = Bun.spawn(["wine", exe, "serve"], {
  env: { ...env, COUCH_MOCK: "1", COUCH_PORT: String(port), COUCH_NOW: "2026-10-03T19:00:00.000Z" },
  stdout: "pipe",
  stderr: "pipe",
});
try {
  let status: { platform?: string; mock?: boolean } | null = null;
  for (let i = 0; i < 40 && !status; i++) {
    await Bun.sleep(500);
    try {
      status = (await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()) as typeof status;
    } catch {
      // not up yet
    }
  }
  check("serve answers /api/status", status !== null);
  check("platform is windows", status?.platform === "windows", String(status?.platform));
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  check("serves the embedded UI", html.includes('<div id="root">'));
  const extra = process.env.WINE_SMOKE_EXTRA;
  if (extra) {
    const mod = (await import(path.resolve(extra))) as {
      default: (base: string, check: (n: string, ok: boolean, d?: string) => void) => Promise<void>;
    };
    await mod.default(`http://127.0.0.1:${port}`, check);
  }
} finally {
  server.kill();
  Bun.spawnSync(["wineserver", "-k"], { env });
}
console.log(failed ? `\nwine smoke: ${failed} failed` : "\nwine smoke: all passed");
process.exit(failed ? 1 : 0);
