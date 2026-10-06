/** Locates the fixtures directory and builds the virtual Steam mounts for either platform. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { nodeReadFs } from "../platform/index.ts";
import type { PlatformId, ReadFs } from "../platform/types.ts";
import { type Mount, mappedFs } from "./mapped-fs.ts";

interface MountsFile {
  linux: Record<string, string>;
  windows: Record<string, string>;
  windowsFiles: Record<string, string>;
}

export function fixturesDir(env: Record<string, string | undefined> = process.env): string {
  return env.COUCH_FIXTURES_DIR || path.resolve(import.meta.dir, "..", "..", "..", "..", "fixtures");
}

export function steamFixtureFs(
  platformId: PlatformId,
  dir = fixturesDir(),
  real: ReadFs = nodeReadFs,
): ReadFs & { touched: string[]; root: string } {
  const steamDir = path.join(dir, "steam");
  const m = JSON.parse(readFileSync(path.join(steamDir, "mounts.json"), "utf8")) as MountsFile;
  const table = platformId === "windows" ? m.windows : m.linux;
  const mounts: Mount[] = Object.entries(table).map(([virtual, rel]) => ({
    virtual,
    real: path.join(steamDir, rel),
  }));
  const files: Mount[] =
    platformId === "windows"
      ? Object.entries(m.windowsFiles).map(([virtual, rel]) => ({ virtual, real: path.join(steamDir, rel) }))
      : [];
  const vpath = platformId === "windows" ? path.win32 : path.posix;
  const fs = mappedFs(real, vpath, mounts, files, platformId === "windows");
  return Object.assign(fs, { root: Object.keys(table)[0] as string });
}
