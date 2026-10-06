/**
 * The local service: wires config, platform, store and adapters into the HTTP API.
 * `createApp` has no global state, so tests create as many as they like.
 */
import os from "node:os";
import path from "node:path";
import type {
  GameSort,
  GamesResponse,
  HomeResponse,
  ItemResponse,
  StatusResponse,
  UnifiedItem,
  WatchResponse,
} from "@couch/core";
import { byRecentActivity, parseKey } from "@couch/core";
import type { FetchFn } from "./adapters/jellyfin/client.ts";
import { allMediaItems, JellyfinSource, watchRows } from "./adapters/jellyfin/jellyfin.ts";
import { StoreMetadata } from "./adapters/steam/store-metadata.ts";
import type { Clock } from "./clock.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { errorJson, json, Router, readJson } from "./http/router.ts";
import { defaultWebAssets, serveStatic, type WebAssets } from "./http/static.ts";
import type { Logger } from "./log.ts";
import type { Platform, ProcessRunner, ReadFs } from "./platform/types.ts";
import { ArtService } from "./services/art.ts";
import { Launcher } from "./services/launcher.ts";
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
    /** Jellyfin server. */
    jellyfin: FetchFn;
    /** Steam CDN artwork. null = local art only. */
    art: FetchFn | null;
  };
  web?: WebAssets;
  /** Injectable sleep (tests make waiting instant). */
  sleep?: (ms: number) => Promise<void>;
  /** Mock mode only: handles for simulating outages from UI tests. */
  mockControls?: { jellyfin?: { down: boolean; sessionsDelay: number } };
}

export interface App {
  fetch(req: Request): Promise<Response>;
  deps: AppDeps;
  library: Library;
  metadata: StoreMetadata;
  jellyfin: JellyfinSource | null;
  launcher: Launcher;
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

  let deviceId = store.getSetting("device.id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    store.setSetting("device.id", deviceId);
  }
  const jellyfin =
    config.jellyfin.url && config.jellyfin.api_key
      ? new JellyfinSource({
          url: config.jellyfin.url,
          apiKey: config.jellyfin.api_key,
          userId: config.jellyfin.user_id,
          fetch: deps.net.jellyfin,
          store,
          clock,
          log,
          deviceId,
          deviceName: `Couch Launcher (${os.hostname()})`,
          mock,
        })
      : null;

  const art = new ArtService({
    platform,
    steamFs: deps.steamFs,
    library,
    jellyfin,
    cdnFetch: deps.net.art,
    cacheDir: path.join(deps.dataDir, "art"),
    log,
  });

  const launcher = new Launcher({
    config,
    platform,
    proc: deps.proc,
    library,
    jellyfin,
    log,
    sleep: deps.sleep,
  });

  /** Every item (games and media) with the profile's prefs applied. Hidden items included. */
  const allItems = async (profileId: number): Promise<UnifiedItem[]> => {
    const games = await library.allGames();
    const media = jellyfin ? await jellyfin.getRows() : { rows: null };
    const items = [...games, ...(media.rows ? allMediaItems(media.rows) : [])];
    return applyPrefs(items, store.prefs(profileId));
  };

  const CONTINUE_GAME_DAYS = 30;
  const CONTINUE_LIMIT = 12;

  const jellyfinStatus = async (): Promise<StatusResponse["jellyfin"]> => {
    if (!jellyfin)
      return {
        state: "not_configured",
        detail: config.jellyfin.url ? "No API key in config.toml" : "No server URL in config.toml",
        itemCount: 0,
        checkedAt: null,
        server: config.jellyfin.url || null,
        serverName: null,
        version: null,
      };
    return jellyfin.status();
  };

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
      jellyfin: await jellyfinStatus(),
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

  router.get("/api/watch", async () => {
    const profile = store.activeProfile();
    if (!jellyfin) {
      const body: WatchResponse = {
        now: nowIso(),
        status: "not_configured",
        cached: false,
        rows: watchRows(null),
      };
      return json(body);
    }
    const { rows, cached } = await jellyfin.getRows();
    const prefs = store.prefs(profile.id);
    const visible = watchRows(rows).map((r) => ({
      ...r,
      items: applyPrefs(r.items, prefs).filter((i) => !i.hidden),
    }));
    const body: WatchResponse = {
      now: nowIso(),
      status: rows && !cached ? (mock ? "mock" : "ok") : "unreachable",
      cached,
      rows: visible,
    };
    return json(body);
  });

  router.get("/api/home", async () => {
    const profile = store.activeProfile();
    const now = clock.now().getTime();
    const items = (await allItems(profile.id)).filter((i) => !i.hidden);
    const recentGames = items.filter(
      (i) =>
        i.kind === "game" &&
        i.lastActivityAt &&
        now - Date.parse(i.lastActivityAt) <= CONTINUE_GAME_DAYS * 86_400_000,
    );
    const resume = items.filter((i) => i.mediaLists?.includes("resume"));
    const continueRow = [...recentGames, ...resume]
      .sort((a, b) => byRecentActivity(a, b))
      .slice(0, CONTINUE_LIMIT);
    const body: HomeResponse = { now: nowIso(), profile, continueRow };
    return json(body);
  });

  router.get("/api/items/:key", async (_req, params) => {
    if (!parseKey(params.key as string)) return errorJson(400, "invalid item key");
    const profile = store.activeProfile();
    const item = (await allItems(profile.id)).find((i) => i.key === params.key);
    if (!item) return errorJson(404, "item not found");
    const body: ItemResponse = { now: nowIso(), item };
    return json(body);
  });

  router.post("/api/launch/:key", async (_req, params, url) => {
    if (!parseKey(params.key as string)) return errorJson(400, "invalid item key");
    const profile = store.activeProfile();
    const item = (await allItems(profile.id)).find((i) => i.key === params.key);
    if (!item) return errorJson(404, "item not found");
    const res = await launcher.launch(item, url.searchParams.get("from") === "start");
    return json(res, res.ok ? 200 : 502);
  });

  router.get("/api/ui-state", () => json({ state: store.getUiState(store.activeProfile().id) }));

  router.put("/api/ui-state", async (req) => {
    const b = (await readJson(req)) as Record<string, unknown> | undefined;
    const screens = ["home", "play", "watch", "detail", "tonight", "profiles", "settings"];
    if (!b || typeof b.screen !== "string" || !screens.includes(b.screen))
      return errorJson(400, "invalid screen");
    const focusedKey = typeof b.focusedKey === "string" && b.focusedKey.length <= 200 ? b.focusedKey : null;
    let params: Record<string, string> | undefined;
    if (b.params && typeof b.params === "object") {
      params = {};
      for (const [k, v] of Object.entries(b.params as Record<string, unknown>).slice(0, 10))
        if (typeof v === "string" && k.length <= 40 && v.length <= 200) params[k] = v;
    }
    store.putUiState(store.activeProfile().id, { screen: b.screen, focusedKey, params }, nowIso());
    return json({ ok: true });
  });

  router.get("/api/art/:key/:kind", async (_req, params) => {
    const kind = params.kind;
    if (kind !== "poster" && kind !== "hero") return errorJson(400, "kind must be poster or hero");
    if (!parseKey(params.key as string)) return errorJson(400, "invalid item key");
    const img = await art.get(params.key as string, kind);
    if (!img) return new Response(null, { status: 404, headers: { "cache-control": "max-age=300" } });
    return new Response(img.body, {
      headers: { "content-type": img.type, "cache-control": "private, max-age=3600" },
    });
  });

  if (mock && deps.mockControls?.jellyfin) {
    const jf = deps.mockControls.jellyfin;
    // Mock mode only (never registered otherwise): lets UI tests take the fake NAS offline.
    router.post("/api/mock/jellyfin", async (req) => {
      const body = (await readJson(req)) as { down?: boolean; sessionsDelay?: number } | undefined;
      if (typeof body?.down === "boolean") jf.down = body.down;
      if (typeof body?.sessionsDelay === "number") jf.sessionsDelay = body.sessionsDelay;
      await jellyfin?.getRows(true);
      return json({ down: jf.down, sessionsDelay: jf.sessionsDelay });
    });
    // Mock mode only: the commands launches would have run.
    router.get("/api/mock/launches", () => {
      const spawned = (deps.proc as { spawned?: unknown[] }).spawned ?? [];
      return json({ spawned, plays: (jf as { plays?: unknown[] }).plays ?? [] });
    });
    // Mock mode only: back to a clean slate between UI tests.
    router.post("/api/mock/reset", async (req) => {
      const body = (await readJson(req)) as { clearCache?: boolean; down?: boolean } | undefined;
      jf.down = body?.down ?? false;
      jf.sessionsDelay = 0;
      const spawned = (deps.proc as { spawned?: unknown[] }).spawned;
      if (spawned) spawned.length = 0;
      const plays = (jf as { plays?: unknown[] }).plays;
      if (plays) plays.length = 0;
      store.db.exec(
        "DELETE FROM item_pref; DELETE FROM suggestion_event; DELETE FROM ui_state; DELETE FROM app_setting WHERE key <> 'device.id';",
      );
      store.setActiveProfile((store.profiles()[0] as { id: number }).id);
      await jellyfin?.getRows(true);
      if (body?.clearCache) store.db.exec("DELETE FROM metadata_cache WHERE source = 'jellyfin';");
      return json({ ok: true });
    });
  }

  router.get("/api/profiles", () => json({ profiles: store.profiles(), active: store.activeProfile() }));

  return {
    deps,
    library,
    jellyfin,
    launcher,
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
