/**
 * Aggregates every source into unified items and applies per-profile preferences.
 * Steam is rescanned at most every STEAM_TTL_MS (cheap: a few small files); store metadata
 * refreshes in the background; Jellyfin rows come from the Jellyfin source (with its own cache).
 */
import type { GameSort, SourceStatus, UnifiedItem } from "@couch/core";
import { isUtilityShortcut, shortcutItem, steamGameItem } from "../adapters/steam/items.ts";
import { type SteamScan, scanSteam } from "../adapters/steam/steam.ts";
import type { StoreMetadata } from "../adapters/steam/store-metadata.ts";
import type { Clock } from "../clock.ts";
import type { Config } from "../config.ts";
import type { ItemPref, Store } from "../db.ts";
import type { Logger } from "../log.ts";
import type { Platform, ReadFs } from "../platform/types.ts";

export const STEAM_TTL_MS = 15_000;

export interface LibraryDeps {
  config: Config;
  platform: Platform;
  steamFs: ReadFs;
  store: Store;
  clock: Clock;
  log: Logger;
  metadata: StoreMetadata;
  mock: boolean;
}

export class Library {
  private scan: SteamScan | null = null;
  private scannedAt = 0;
  private scanning: Promise<SteamScan> | null = null;

  constructor(private readonly d: LibraryDeps) {}

  /** The latest Steam scan, rescanning when older than the TTL (or when forced). */
  async steam(force = false): Promise<SteamScan> {
    const fresh = this.scan && Date.now() - this.scannedAt < STEAM_TTL_MS;
    if (fresh && !force && this.scan) return this.scan;
    if (!this.scanning) {
      this.scanning = scanSteam({
        platform: this.d.platform,
        fs: this.d.steamFs,
        configuredRoot: this.d.config.steam.root,
        configuredUser: this.d.config.steam.user_id,
      })
        .then((s) => {
          this.scan = s;
          this.scannedAt = Date.now();
          for (const w of s.warnings) this.d.log.warn(`steam: ${w}`);
          // Background metadata refresh for anything missing or older than 30 days.
          void this.d.metadata
            .refresh(s.games.map((g) => g.appId))
            .catch((e) => this.d.log.warn("metadata", e));
          return s;
        })
        .finally(() => {
          this.scanning = null;
        });
    }
    return this.scanning;
  }

  /** All installed games and shortcuts, without per-profile filtering. */
  async allGames(): Promise<UnifiedItem[]> {
    const s = await this.steam();
    const { genre_session_map: map, default_session_length: fallback } = this.d.config.picker;
    const meta = this.d.metadata.all();
    const games = s.games
      .filter((g) => {
        const info = meta.get(g.appId);
        // The store marks runtimes and tools that slipped past the id/name list.
        return !(info?.available && info.type && info.type !== "game");
      })
      .map((g) => steamGameItem(g, meta.get(g.appId) ?? null, map, fallback));
    const shortcuts = s.shortcuts
      .filter(
        (sc) => !isUtilityShortcut(sc, this.d.config.playback.client_shortcut, this.d.config.server.port),
      )
      .map((sc) => shortcutItem(sc, fallback));
    return [...games, ...shortcuts];
  }

  steamStatus(): SourceStatus & { root: string | null; userId: string | null; libraries: string[] } {
    const s = this.scan;
    if (!s)
      return {
        state: "degraded",
        detail: "Not scanned yet",
        itemCount: 0,
        checkedAt: null,
        root: null,
        userId: null,
        libraries: [],
      };
    const count = s.games.length + s.shortcuts.length;
    const unmounted = s.libraries.filter((l) => !l.ok).length;
    return {
      state: !s.root ? "unreachable" : this.d.mock ? "mock" : unmounted ? "degraded" : "ok",
      detail: !s.root
        ? "Steam library not found"
        : `${s.games.length} games, ${s.shortcuts.length} shortcuts in ${s.libraries.length} libraries${unmounted ? ` (${unmounted} not mounted)` : ""}${this.d.mock ? " (fixtures)" : ""}`,
      itemCount: count,
      checkedAt: new Date(this.scannedAt).toISOString(),
      root: s.root,
      userId: s.userId,
      libraries: s.libraries.map((l) => l.path),
    };
  }
}

/** Overlay a profile's preferences on items (favourite, hidden, session-length override). */
export function applyPrefs(items: UnifiedItem[], prefs: Map<string, ItemPref>): UnifiedItem[] {
  return items.map((i) => {
    const p = prefs.get(i.key);
    const out: UnifiedItem = { ...i, favourite: p?.favourite ?? false, hidden: p?.hidden ?? false };
    if (p?.sessionLengthOverride && i.kind === "game")
      out.tags = { ...i.tags, sessionLength: p.sessionLengthOverride, sessionLengthOverridden: true };
    return out;
  });
}

export function sortGames(items: UnifiedItem[], sort: GameSort): UnifiedItem[] {
  const byTitle = (a: UnifiedItem, b: UnifiedItem) =>
    a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.key.localeCompare(b.key);
  const copy = [...items];
  if (sort === "az") return copy.sort(byTitle);
  if (sort === "playtime")
    return copy.sort((a, b) => (b.playtimeMin ?? -1) - (a.playtimeMin ?? -1) || byTitle(a, b));
  return copy.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || byTitle(a, b));
}
