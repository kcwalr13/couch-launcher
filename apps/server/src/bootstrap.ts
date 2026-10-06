/** Builds a fully wired App from the environment. Shared by `serve` and tests. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type App, type AppDeps, createApp } from "./app.ts";
import { type Clock, fixedClock, systemClock } from "./clock.ts";
import { type Config, type ConfigFs, loadConfigFile, parseConfig } from "./config.ts";
import { Store } from "./db.ts";
import { createLogger, type Logger } from "./log.ts";
import { mockStoreFetch } from "./mock/fetch.ts";
import { fixturesDir, steamFixtureFs } from "./mock/fixtures.ts";
import { MOCK_JELLYFIN_KEY, MOCK_JELLYFIN_URL, mockJellyfin } from "./mock/jellyfin.ts";
import {
  createPlatform,
  hostPlatform,
  hostPlatformId,
  nodeReadFs,
  realProcessRunner,
} from "./platform/index.ts";
import type { Platform, ProcessRunner, ReadFs } from "./platform/types.ts";

export const nodeConfigFs: ConfigFs = {
  exists: (p) => existsSync(p),
  readText: (p) => readFileSync(p, "utf8"),
  writeText: (p, d) => writeFileSync(p, d, { encoding: "utf8", mode: 0o600 }),
  mkdirp: (p) => {
    mkdirSync(p, { recursive: true });
  },
};

export interface Booted {
  app: App;
  config: Config;
  platform: Platform;
  store: Store;
  log: Logger;
  port: number;
  host: string;
  mock: boolean;
}

export async function bootstrap(
  env: Record<string, string | undefined>,
  opts: { quietLog?: boolean } = {},
): Promise<Booted> {
  const log = createLogger({ quiet: opts.quietLog });
  const mock = env.COUCH_MOCK === "1" || env.COUCH_MOCK === "true";
  const platform = hostPlatform();
  const P = platform.path;

  // Config. Mock mode without an explicit config dir uses defaults and writes nothing.
  let config: Config;
  if (mock && !env.COUCH_CONFIG_DIR) {
    config = parseConfig({}).config;
  } else {
    const dir = env.COUCH_CONFIG_DIR || platform.configDir();
    const r = loadConfigFile(P.join(dir, "config.toml"), dir, nodeConfigFs);
    if (r.created) log.info(`created ${r.path} with defaults`);
    for (const w of r.warnings) log.warn(`config: ${w}`);
    config = r.config;
  }
  log.addSecret(config.jellyfin.api_key);
  if (env.COUCH_PORT) config.server.port = Number(env.COUCH_PORT);

  const dataDir = env.COUCH_DATA_DIR || (mock ? P.join(platform.dataDir(), "mock") : platform.dataDir());
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(P.join(dataDir, "couch-launcher.sqlite"));

  const clock: Clock = env.COUCH_NOW ? fixedClock(env.COUCH_NOW) : systemClock;

  // Mock mode: the real adapters run against fixtures mounted at virtual Steam paths, the store
  // and Jellyfin answer from fixture files, and launch commands are recorded, never run.
  let steamPlatform: Platform = platform;
  let steamFs: ReadFs = nodeReadFs;
  let proc: ProcessRunner = realProcessRunner;
  let storeFetch = globalThis.fetch as unknown as AppDeps["net"]["store"];
  let jellyfinFetch = globalThis.fetch as unknown as AppDeps["net"]["jellyfin"];
  let mockControls: AppDeps["mockControls"];
  if (mock) {
    const fx = fixturesDir(env);
    const id = hostPlatformId();
    steamFs = steamFixtureFs(id, fx);
    proc = recordingRunner(log);
    steamPlatform = createPlatform(id, {
      env: {},
      home: id === "windows" ? "C:\\Users\\deck" : "/home/deck",
      fs: steamFs,
      proc,
    });
    storeFetch = mockStoreFetch(fx);
    const jf = mockJellyfin(fx);
    jellyfinFetch = jf.fetch;
    mockControls = { jellyfin: jf };
    if (!config.jellyfin.url) {
      config.jellyfin.url = MOCK_JELLYFIN_URL;
      config.jellyfin.api_key = MOCK_JELLYFIN_KEY;
    }
  }
  const app = createApp({
    config,
    platform: steamPlatform,
    steamFs,
    proc,
    store,
    clock,
    log,
    mock,
    dataDir,
    mockControls,
    net: {
      store: storeFetch,
      jellyfin: jellyfinFetch,
      art: mock ? null : (globalThis.fetch as unknown as AppDeps["net"]["store"]),
    },
  });
  return { app, config, platform, store, log, port: config.server.port, host: config.server.host, mock };
}

/** Mock-mode process runner: logs and records every command instead of running it. */
export function recordingRunner(log: Logger): ProcessRunner & { spawned: { cmd: string; args: string[] }[] } {
  const spawned: { cmd: string; args: string[] }[] = [];
  return {
    spawned,
    async run(c) {
      log.info(`[mock] would run: ${c.cmd} ${c.args.join(" ")}`);
      return { code: 1, stdout: "", stderr: "mock mode" };
    },
    spawnDetached(c) {
      spawned.push({ cmd: c.cmd, args: c.args });
      log.info(`[mock] would start: ${c.cmd} ${c.args.join(" ")}`);
    },
  };
}
