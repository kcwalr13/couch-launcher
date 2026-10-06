/** Builds a fully wired App from the environment. Shared by `serve` and tests. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type App, createApp } from "./app.ts";
import { type Clock, fixedClock, systemClock } from "./clock.ts";
import { type Config, type ConfigFs, loadConfigFile, parseConfig } from "./config.ts";
import { Store } from "./db.ts";
import { createLogger, type Logger } from "./log.ts";
import { hostPlatform } from "./platform/index.ts";
import type { Platform } from "./platform/types.ts";

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
  const app = createApp({ config, platform, store, clock, log, mock });
  return { app, config, platform, store, log, port: config.server.port, host: config.server.host, mock };
}
