import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import { createLinuxPlatform } from "./linux.ts";
import type { Platform, PlatformDeps, PlatformId, ProcessRunner, ReadFs } from "./types.ts";
import { createWindowsPlatform } from "./windows.ts";

export type * from "./types.ts";

/** The real, read-only filesystem. */
export const nodeReadFs: ReadFs = {
  exists: (p) => existsSync(p),
  stat: (p) => {
    try {
      const s = statSync(p);
      return { isDir: s.isDirectory(), isFile: s.isFile(), size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  },
  readFile: (p) => readFileSync(p),
  readText: (p) => readFileSync(p, "utf8"),
  readdir: (p) => readdirSync(p),
  realpath: (p) => realpathSync(p),
};

export const realProcessRunner: ProcessRunner = {
  async run(c) {
    const p = Bun.spawn([c.cmd, ...c.args], { cwd: c.cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { code, stdout, stderr };
  },
  spawnDetached(c) {
    const p = Bun.spawn([c.cmd, ...c.args], {
      cwd: c.cwd,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    p.unref();
  },
};

/** The single runtime platform check in the codebase. */
export function hostPlatformId(): PlatformId {
  return process.platform === "win32" ? "windows" : "linux";
}

export function createPlatform(id: PlatformId, deps: PlatformDeps): Platform {
  return id === "windows" ? createWindowsPlatform(deps) : createLinuxPlatform(deps);
}

export function hostPlatform(overrides: Partial<PlatformDeps> = {}): Platform {
  return createPlatform(hostPlatformId(), {
    env: process.env,
    home: os.homedir(),
    fs: nodeReadFs,
    proc: realProcessRunner,
    ...overrides,
  });
}
