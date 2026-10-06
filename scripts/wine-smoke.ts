/**
 * Optional Windows smoke test: runs the cross-compiled .exe under Wine (not part of `check`).
 *   bun run build --target windows && bun scripts/wine-smoke.ts
 * Checks: `version`, `serve` in mock mode answers /api/status with platform "windows",
 * and the UI is served. Extra checks are added per phase (see docs/DESIGN.md).
 */
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dir, "..");
const exe = path.join(repo, "out", "couch-launcher-windows-x64.exe");
const prefix = process.env.WINEPREFIX || path.join(os.tmpdir(), "couch-launcher-wineprefix");
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

async function withServer(
  port: number,
  extraEnv: Record<string, string>,
  body: (base: string) => Promise<void>,
): Promise<void> {
  const server = Bun.spawn(["wine", exe, "serve"], {
    env: { ...env, COUCH_PORT: String(port), ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await Bun.sleep(500);
      up = await fetch(`${base}/api/status`).then(
        (r) => r.ok,
        () => false,
      );
    }
    check(`serve on :${port} answers /api/status`, up);
    if (up) await body(base);
  } finally {
    server.kill();
    await server.exited;
  }
}

interface Json {
  platform?: string;
  steam?: { root?: string; itemCount?: number; libraries?: string[] };
  items?: unknown[];
}
const getJson = async (u: string): Promise<Json> => (await fetch(u)).json() as Promise<Json>;

// 1. Mock mode: fixtures mounted at virtual Windows paths inside the real Windows runtime.
const winFixtures = `Z:${path.join(repo, "fixtures").replaceAll("/", "\\")}`;
await withServer(
  7803,
  { COUCH_MOCK: "1", COUCH_NOW: "2026-10-03T19:00:00.000Z", COUCH_FIXTURES_DIR: winFixtures },
  async (base) => {
    const status = await getJson(`${base}/api/status`);
    check("platform is windows", status.platform === "windows", String(status.platform));
    check(
      "mock Steam root is the Windows default",
      status.steam?.root === "C:\\Program Files (x86)\\Steam",
      status.steam?.root,
    );
    check("mock Steam finds 16 items", status.steam?.itemCount === 16, String(status.steam?.itemCount));
    const html = await (await fetch(`${base}/`)).text();
    check("serves the embedded UI", html.includes('<div id="root">'));
    const extra = process.env.WINE_SMOKE_EXTRA;
    if (extra) {
      const mod = (await import(path.resolve(extra))) as {
        default: (base: string, check: (n: string, ok: boolean, d?: string) => void) => Promise<void>;
      };
      await mod.default(base, check);
    }
  },
);

// 2. Real mode: a Steam install on the Wine C: and D: drives, found through the registry.
const driveC = path.join(prefix, "drive_c");
const steamDir = path.join(driveC, "Program Files (x86)", "Steam");
const dDrive = path.join(prefix, "drive_d");
rmSync(steamDir, { recursive: true, force: true });
rmSync(dDrive, { recursive: true, force: true });
cpSync(path.join(repo, "fixtures", "steam", "root"), steamDir, { recursive: true });
cpSync(
  path.join(repo, "fixtures", "steam", "libraryfolders.windows.vdf"),
  path.join(steamDir, "steamapps", "libraryfolders.vdf"),
);
cpSync(path.join(repo, "fixtures", "steam", "library2"), path.join(dDrive, "SteamLibrary"), {
  recursive: true,
});
const dLink = path.join(prefix, "dosdevices", "d:");
rmSync(dLink, { force: true });
symlinkSync(dDrive, dLink);
Bun.spawnSync(
  [
    "wine",
    "reg",
    "add",
    "HKCU\\Software\\Valve\\Steam",
    "/v",
    "SteamPath",
    "/t",
    "REG_SZ",
    "/d",
    "c:/program files (x86)/steam",
    "/f",
  ],
  { env },
);
await withServer(7804, {}, async (base) => {
  const status = await getJson(`${base}/api/status`);
  check(
    "real mode: Steam root from the registry",
    status.steam?.root === "c:\\program files (x86)\\steam",
    status.steam?.root,
  );
  check(
    "real mode: both libraries",
    JSON.stringify(status.steam?.libraries) ===
      JSON.stringify(["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]),
    JSON.stringify(status.steam?.libraries),
  );
  check("real mode: 16 items", status.steam?.itemCount === 16, String(status.steam?.itemCount));
  const games = await getJson(`${base}/api/games`);
  check("real mode: /api/games lists 14 games", games.items?.length === 14, String(games.items?.length));
});
Bun.spawnSync(["wineserver", "-k"], { env });

console.log(failed ? `\nwine smoke: ${failed} failed` : "\nwine smoke: all passed");
process.exit(failed ? 1 : 0);
