/**
 * The local service: wires config, platform, store and adapters into the HTTP API.
 * `createApp` has no global state, so tests create as many as they like.
 */
import type { StatusResponse } from "@couch/core";
import type { Clock } from "./clock.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { errorJson, json, Router } from "./http/router.ts";
import { defaultWebAssets, serveStatic, type WebAssets } from "./http/static.ts";
import type { Logger } from "./log.ts";
import type { Platform } from "./platform/types.ts";
import { VERSION } from "./version.ts";

export interface AppDeps {
  config: Config;
  platform: Platform;
  store: Store;
  clock: Clock;
  log: Logger;
  mock: boolean;
  web?: WebAssets;
}

export interface App {
  fetch(req: Request): Promise<Response>;
  deps: AppDeps;
}

export function createApp(deps: AppDeps): App {
  const { config, platform, store, clock, mock } = deps;
  const router = new Router();
  const web = deps.web ?? defaultWebAssets();

  const uiScale = () => {
    const s = Number(store.getSetting("ui.scale"));
    return Number.isFinite(s) && s > 0 ? s : config.ui.scale;
  };

  router.get("/api/status", () => {
    const now = clock.now().toISOString();
    const body: StatusResponse = {
      version: VERSION,
      mock,
      platform: platform.id,
      now,
      steam: {
        state: mock ? "mock" : "not_configured",
        detail: mock ? "Mock mode: fixture library" : "Not scanned yet",
        itemCount: 0,
        checkedAt: null,
        root: null,
        userId: null,
        libraries: [],
      },
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
      metadata: { state: mock ? "mock" : "ok", detail: "", itemCount: 0, checkedAt: null },
      uiScale: uiScale(),
    };
    return json(body);
  });

  return {
    deps,
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
        deps.log.error(`${req.method} ${url.pathname} failed`, e);
        return errorJson(500, "internal error");
      }
    },
  };
}
