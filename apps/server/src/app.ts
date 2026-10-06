/**
 * The local service: wires config, platform, store and adapters into the HTTP API.
 * `createApp` has no global state, so tests create as many as they like.
 */
import type { GameSort, GamesResponse, StatusResponse } from "@couch/core";
import type { FetchFn } from "./adapters/jellyfin/client.ts";
import { StoreMetadata } from "./adapters/steam/store-metadata.ts";
import type { Clock } from "./clock.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { errorJson, json, Router } from "./http/router.ts";
import { defaultWebAssets, serveStatic, type WebAssets } from "./http/static.ts";
import type { Logger } from "./log.ts";
import type { Platform, ProcessRunner, ReadFs } from "./platform/types.ts";
import { applyPrefs, Library, sortGames } from "./services/library.ts";
import { VERSION } from "./version.ts";

export interface AppDeps {
  config: Config;
  /** Platform used for Steam discovery, launch commands and the kiosk browser. */
  platform: Platform;
  /** Read-only filesystem for everything under the Steam root. */
  steamFs: ReadFs;
  /** Starts launch commands. In mock mode it records instead of running. */
  proc: ProcessRunner;
  store: Store;
  clock: Clock;
  log: Logger;
  mock: boolean;
  /** Writable directory for the art cache. */
  dataDir: string;
  net: {
    /** Steam store metadata. null = offline. */
    store: FetchFn | null;
  };
  web?: WebAssets;
}

export interface App {
  fetch(req: Request): Promise<Response>;
  deps: AppDeps;
  library: Library;
  metadata: StoreMetadata;
}

const SORTS: GameSort[] = ["recent", "az", "playtime"];

export function createApp(deps: AppDeps): App {
  const { config, platform, store, clock, mock, log } = deps;
  const router = new Router();
  const web = deps.web ?? defaultWebAssets();
  // Fixture fetches in mock mode need no rate limit.
  const metadata = new StoreMetadata({
    store,
    fetch: deps.net.store,
    clock,
    log,
    minIntervalMs: mock ? 0 : 1500,
  });
  const library = new Library({ config, platform, steamFs: deps.steamFs, store, clock, log, metadata, mock });

  const nowIso = () => clock.now().toISOString();
  const uiScale = () => {
    const s = Number(store.getSetting("ui.scale"));
    return Number.isFinite(s) && s > 0 ? s : config.ui.scale;
  };

  router.get("/api/status", async () => {
    await library.steam();
    const md = metadata.status();
    const body: StatusResponse = {
      version: VERSION,
      mock,
      platform: platform.id,
      now: nowIso(),
      steam: library.steamStatus(),
      jellyfin: {
        state: mock ? "mock" : config.jellyfin.url ? "degraded" : "not_configured",
        detail: mock
          ? "Mock mode: fixture server"
          : config.jellyfin.url
            ? "Not checked yet"
            : "No server URL in config",
        itemCount: 0,
        checkedAt: null,
        server: mock ? "mock" : config.jellyfin.url || null,
        serverName: null,
        version: null,
      },
      metadata: {
        state: mock ? "mock" : md.offline ? "degraded" : "ok",
        detail: md.lastError ?? `${md.cached} apps cached${md.pending ? `, ${md.pending} pending` : ""}`,
        itemCount: md.cached,
        checkedAt: md.lastFetchAt,
      },
      uiScale: uiScale(),
    };
    return json(body);
  });

  router.get("/api/games", async (_req, _p, url) => {
    const sortParam = url.searchParams.get("sort") as GameSort | null;
    const sort: GameSort = sortParam && SORTS.includes(sortParam) ? sortParam : "recent";
    const coop = url.searchParams.get("coop") === "1";
    const controller = url.searchParams.get("controller") === "1";
    const profile = store.activeProfile();
    let items = applyPrefs(await library.allGames(), store.prefs(profile.id)).filter((i) => !i.hidden);
    if (coop) items = items.filter((i) => i.tags.couchCoop === true);
    if (controller) items = items.filter((i) => i.tags.controller === "full");
    const body: GamesResponse = {
      now: nowIso(),
      sort,
      filters: { coop, controller },
      items: sortGames(items, sort),
    };
    return json(body);
  });

  return {
    deps,
    library,
    metadata,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const m = router.match(req.method, url.pathname);
      if (m === "method") return errorJson(405, "method not allowed");
      if (m === null) {
        if (url.pathname.startsWith("/api/") || (req.method !== "GET" && req.method !== "HEAD"))
          return errorJson(404, "not found");
        return serveStatic(web, url.pathname);
      }
      try {
        return await m.handler(req, m.params, url);
      } catch (e) {
        log.error(`${req.method} ${url.pathname} failed`, e);
        return errorJson(500, "internal error");
      }
    },
  };
}
