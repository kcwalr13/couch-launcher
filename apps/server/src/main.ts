#!/usr/bin/env bun
/**
 * Couch Launcher service entry point.
 *   couch-launcher serve    run the local service (default)
 *   couch-launcher doctor   print what the service can find, read-only
 *   couch-launcher version
 * Environment:
 *   COUCH_MOCK=1            run entirely from fixtures (no Steam, no Jellyfin, launches are recorded)
 *   COUCH_NOW=<iso>         pin the clock (mock mode and tests)
 *   COUCH_CONFIG_DIR, COUCH_DATA_DIR   override the config and data directories
 *   COUCH_PORT              override server.port
 */
import { bootstrap } from "./bootstrap.ts";
import { VERSION } from "./version.ts";

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0] ?? "serve";
  if (cmd === "version" || cmd === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (cmd === "serve") {
    const { app, port, host, log } = await bootstrap(process.env);
    const server = Bun.serve({ port, hostname: host, fetch: app.fetch, idleTimeout: 60 });
    log.info(`Couch Launcher ${VERSION} listening on http://${server.hostname}:${server.port}`);
    return await new Promise<number>(() => {});
  }
  if (cmd === "doctor") {
    const { doctor } = await import("./doctor.ts");
    return doctor(process.env);
  }
  console.error(`unknown command: ${cmd}\nusage: couch-launcher [serve|doctor|version]`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  },
);
