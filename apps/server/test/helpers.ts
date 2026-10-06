import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type App, type AppDeps, createApp } from "../src/app.ts";
import { fixedClock } from "../src/clock.ts";
import { type Config, defaultConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { createLogger } from "../src/log.ts";
import { mockStoreFetch } from "../src/mock/fetch.ts";
import { steamFixtureFs } from "../src/mock/fixtures.ts";
import { createPlatform } from "../src/platform/index.ts";
import type {
  Command,
  FileStat,
  PlatformDeps,
  PlatformId,
  ProcessRunner,
  ReadFs,
  RunResult,
} from "../src/platform/types.ts";

/** The fixed "now" every fixture is written against: a Saturday evening. */
export const FIXTURE_NOW = "2026-10-03T19:00:00.000Z";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
export const FIXTURES = path.join(REPO_ROOT, "fixtures");

export function tempDir(prefix = "couch-test-"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** An in-memory read-only filesystem keyed by absolute path. Directories are implied by files. */
export function memFs(
  files: Record<string, string | Uint8Array>,
  sep: "/" | "\\" = "/",
  caseInsensitive = false,
): ReadFs {
  const norm = (p: string) => {
    let s = p.replace(/[\\/]+$/, "");
    if (caseInsensitive) s = s.toLowerCase();
    return s;
  };
  const map = new Map<string, string | Uint8Array>();
  for (const [k, v] of Object.entries(files)) map.set(norm(k), v);
  const isDir = (p: string) => {
    const n = norm(p) + sep;
    for (const k of map.keys()) if (k.startsWith(n)) return true;
    return false;
  };
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    exists: (p) => map.has(norm(p)) || isDir(p),
    stat: (p): FileStat | null => {
      const f = map.get(norm(p));
      if (f !== undefined)
        return {
          isDir: false,
          isFile: true,
          size: typeof f === "string" ? f.length : f.byteLength,
          mtimeMs: 0,
        };
      return isDir(p) ? { isDir: true, isFile: false, size: 0, mtimeMs: 0 } : null;
    },
    readFile: (p) => {
      const f = map.get(norm(p));
      if (f === undefined) throw new Error(`ENOENT ${p}`);
      return typeof f === "string" ? enc.encode(f) : f;
    },
    readText: (p) => {
      const f = map.get(norm(p));
      if (f === undefined) throw new Error(`ENOENT ${p}`);
      return typeof f === "string" ? f : dec.decode(f);
    },
    readdir: (p) => {
      const n = norm(p) + sep;
      const out = new Set<string>();
      for (const k of map.keys()) if (k.startsWith(n)) out.add(k.slice(n.length).split(sep)[0] as string);
      if (out.size === 0) throw new Error(`ENOENT ${p}`);
      return [...out];
    },
    realpath: (p) => p,
  };
}

export interface RecordingProc extends ProcessRunner {
  runs: Command[];
  spawned: Command[];
}

export function recordingProc(
  responses: (c: Command) => RunResult = () => ({ code: 1, stdout: "", stderr: "" }),
): RecordingProc {
  const runs: Command[] = [];
  const spawned: Command[] = [];
  return {
    runs,
    spawned,
    async run(c) {
      runs.push(c);
      return responses(c);
    },
    spawnDetached(c) {
      spawned.push(c);
    },
  };
}

export function testPlatform(id: PlatformId, deps: Partial<PlatformDeps> = {}) {
  return createPlatform(id, {
    env: {},
    home: id === "windows" ? "C:\\Users\\kyle" : "/home/kyle",
    fs: memFs({}),
    proc: recordingProc(),
    ...deps,
  });
}

export interface TestApp {
  app: App;
  deps: AppDeps;
  cleanup: () => void;
  get: (p: string) => Promise<Response>;
  send: (method: string, p: string, body?: unknown) => Promise<Response>;
}

/** Fixture-backed deps for one platform, as mock mode wires them. */
export function fixtureDeps(id: PlatformId = "linux") {
  const steamFs = steamFixtureFs(id);
  const proc = recordingProc();
  const platform = createPlatform(id, {
    env: {},
    home: id === "windows" ? "C:\\Users\\deck" : "/home/deck",
    fs: steamFs,
    proc,
  });
  return { steamFs, proc, platform };
}

export function makeTestApp(
  over: Partial<AppDeps> & { configure?: (c: Config) => void; platformId?: PlatformId } = {},
): TestApp & { proc: RecordingProc } {
  const t = tempDir();
  const config = defaultConfig();
  over.configure?.(config);
  const fx = fixtureDeps(over.platformId ?? "linux");
  const deps: AppDeps = {
    config,
    platform: fx.platform,
    steamFs: fx.steamFs,
    proc: fx.proc,
    store: new Store(path.join(t.dir, "test.sqlite")),
    clock: fixedClock(FIXTURE_NOW),
    log: createLogger({ quiet: true, capture: true }),
    mock: true,
    dataDir: t.dir,
    net: { store: mockStoreFetch(FIXTURES) },
    ...over,
  };
  const app = createApp(deps);
  const base = "http://127.0.0.1:7744";
  return {
    app,
    deps,
    proc: deps.proc as RecordingProc,
    cleanup: () => {
      deps.store.close();
      t.cleanup();
    },
    get: (p) => app.fetch(new Request(base + p)),
    send: (method, p, body) =>
      app.fetch(
        new Request(base + p, {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
  };
}
