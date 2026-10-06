/**
 * Jellyfin source: Resume, Next Up, Latest and unwatched movies mapped to unified items,
 * images, status and the remote-control calls used by the playback handoff.
 * Rows are cached in SQLite so Watch keeps working (from the cache) when the NAS is unreachable.
 */
import type { MediaList, SourceStatus, UnifiedItem, WatchRow } from "@couch/core";
import { makeKey } from "@couch/core";
import type { Clock } from "../../clock.ts";
import type { Store } from "../../db.ts";
import type { Logger } from "../../log.ts";
import { artUrls } from "../steam/items.ts";
import { type FetchFn, JellyfinClient, JellyfinError, JF } from "./client.ts";

export const JELLYFIN_SOURCE = "jellyfin";
const ROWS_CACHE_KEY = "jellyfin:rows";
export const TICKS_PER_SECOND = 10_000_000;
const FIELDS = "Overview,Genres,DateCreated,ProductionYear,OfficialRating";

/** The subset of BaseItemDto the launcher reads. */
export interface BaseItemDto {
  Id: string;
  Name?: string;
  Type?: string;
  SeriesName?: string;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  RunTimeTicks?: number;
  ProductionYear?: number;
  OfficialRating?: string;
  Overview?: string;
  Genres?: string[];
  DateCreated?: string;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  SeriesPrimaryImageTag?: string;
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  UserData?: {
    PlaybackPositionTicks?: number;
    Played?: boolean;
    LastPlayedDate?: string;
    PlayedPercentage?: number;
  };
}

interface QueryResult {
  Items?: BaseItemDto[];
}

export interface ImageRef {
  itemId: string;
  type: "Primary" | "Backdrop";
  tag?: string;
}

/** Which Jellyfin image to show for an item. Episodes use their series' art. */
export function imageRefs(d: BaseItemDto): { poster: ImageRef | null; hero: ImageRef | null } {
  if (d.Type === "Episode") {
    const poster =
      d.SeriesId && d.SeriesPrimaryImageTag
        ? { itemId: d.SeriesId, type: "Primary" as const, tag: d.SeriesPrimaryImageTag }
        : null;
    const bd = d.ParentBackdropItemId && d.ParentBackdropImageTags?.[0];
    const hero = bd ? { itemId: d.ParentBackdropItemId as string, type: "Backdrop" as const, tag: bd } : null;
    return { poster, hero };
  }
  const p = d.ImageTags?.Primary;
  const b = d.BackdropImageTags?.[0];
  return {
    poster: p ? { itemId: d.Id, type: "Primary", tag: p } : null,
    hero: b ? { itemId: d.Id, type: "Backdrop", tag: b } : null,
  };
}

function minutes(ticks: number | undefined): number | null {
  return ticks ? Math.round(ticks / TICKS_PER_SECOND / 60) : null;
}

export function formatRuntime(min: number | null): string | null {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

export function mapItem(d: BaseItemDto, lists: MediaList[]): UnifiedItem | null {
  if (!d.Id || (d.Type !== "Movie" && d.Type !== "Episode")) return null;
  const key = makeKey("jellyfin", d.Id);
  const durationSec = d.RunTimeTicks ? Math.round(d.RunTimeTicks / TICKS_PER_SECOND) : 0;
  const positionSec = Math.round((d.UserData?.PlaybackPositionTicks ?? 0) / TICKS_PER_SECOND);
  const isEpisode = d.Type === "Episode";
  const se =
    isEpisode && d.ParentIndexNumber !== undefined && d.IndexNumber !== undefined
      ? `S${d.ParentIndexNumber}:E${d.IndexNumber}`
      : null;
  const subtitle = isEpisode
    ? [se, d.Name].filter(Boolean).join(" · ")
    : [d.ProductionYear, d.OfficialRating, formatRuntime(minutes(d.RunTimeTicks))]
        .filter(Boolean)
        .join(" · ");
  return {
    key,
    kind: isEpisode ? "episode" : "movie",
    source: "jellyfin",
    title: isEpisode ? (d.SeriesName ?? d.Name ?? "Episode") : (d.Name ?? "Movie"),
    subtitle: subtitle || null,
    summary: d.Overview ?? null,
    art: artUrls(key),
    lastActivityAt: d.UserData?.LastPlayedDate ?? null,
    addedAt: d.DateCreated ?? null,
    progress: durationSec ? { positionSec: positionSec > 0 ? positionSec : 0, durationSec } : null,
    playtimeMin: null,
    tags: { genres: d.Genres ?? [], couchCoop: null, controller: null, sessionLength: null },
    launch: { type: "jellyfin", itemId: d.Id, positionSec: positionSec > 0 ? positionSec : 0 },
    mediaLists: lists,
  };
}

export interface JellyfinRows {
  resume: UnifiedItem[];
  nextUp: UnifiedItem[];
  latestMovies: UnifiedItem[];
  latestShows: UnifiedItem[];
  unwatchedMovies: UnifiedItem[];
  images: Record<string, { poster: ImageRef | null; hero: ImageRef | null }>;
  fetchedAt: string;
}

export interface JellyfinSourceOptions {
  url: string;
  apiKey: string;
  userId: string;
  fetch: FetchFn;
  store: Store;
  clock: Clock;
  log: Logger;
  deviceId: string;
  deviceName: string;
  mock: boolean;
  /** Re-fetch rows when the in-memory copy is older than this. */
  ttlMs?: number;
}

export interface Session {
  Id: string;
  Client?: string;
  DeviceName?: string;
  LastActivityDate?: string;
  SupportsRemoteControl?: boolean;
  UserId?: string;
}

export class JellyfinSource {
  readonly client: JellyfinClient;
  private userId: string | null;
  private rows: JellyfinRows | null = null;
  private rowsAt = 0;
  private inflight: Promise<JellyfinRows | null> | null = null;
  private lastError: JellyfinError | null = null;
  private lastOkAt: string | null = null;
  private serverName: string | null = null;
  private version: string | null = null;

  constructor(private readonly o: JellyfinSourceOptions) {
    this.client = new JellyfinClient({
      url: o.url,
      apiKey: o.apiKey,
      deviceId: o.deviceId,
      deviceName: o.deviceName,
      fetch: o.fetch,
      timeoutMs: 4000,
    });
    this.userId = o.userId || null;
  }

  get url(): string {
    return this.o.url;
  }

  /** The configured user, or the first enabled user on the server (API keys carry no user). */
  async user(): Promise<string> {
    if (this.userId) return this.userId;
    const users = await this.client.getJson<
      { Id: string; Name?: string; Policy?: { IsDisabled?: boolean } }[]
    >(JF.users);
    const u = users.find((x) => !x.Policy?.IsDisabled);
    if (!u) throw new JellyfinError("no enabled Jellyfin users", "http");
    this.o.log.info(`jellyfin: no user_id configured; using "${u.Name ?? u.Id}"`);
    this.userId = u.Id;
    return u.Id;
  }

  /** Rows from memory, refreshed from the server when stale; the SQLite cache when unreachable. */
  async getRows(force = false): Promise<{ rows: JellyfinRows | null; cached: boolean }> {
    const ttl = this.o.ttlMs ?? 30_000;
    if (!force && this.rows && Date.now() - this.rowsAt < ttl && !this.lastError)
      return { rows: this.rows, cached: false };
    if (!this.inflight)
      this.inflight = this.fetchRows().finally(() => {
        this.inflight = null;
      });
    const fresh = await this.inflight;
    if (fresh) return { rows: fresh, cached: false };
    const cached = this.o.store.getCache<JellyfinRows>(ROWS_CACHE_KEY, JELLYFIN_SOURCE)?.value ?? null;
    return { rows: cached, cached: cached !== null };
  }

  private async fetchRows(): Promise<JellyfinRows | null> {
    try {
      const userId = await this.user();
      const c = this.client;
      const common = {
        userId,
        fields: FIELDS,
        enableImageTypes: "Primary,Backdrop,Thumb",
        imageTypeLimit: 1,
      };
      const [resume, nextUp, latestMovies, latestEpisodes, unwatched] = await Promise.all([
        c.getJson<QueryResult>(JF.resume, { ...common, mediaTypes: "Video", limit: 24 }),
        c.getJson<QueryResult>(JF.nextUp, { ...common, limit: 24, enableResumable: false }),
        c.getJson<BaseItemDto[]>(JF.latest, { ...common, includeItemTypes: "Movie", limit: 24 }),
        c.getJson<BaseItemDto[]>(JF.latest, {
          ...common,
          includeItemTypes: "Episode",
          groupItems: false,
          limit: 60,
        }),
        c.getJson<QueryResult>(JF.items, {
          ...common,
          includeItemTypes: "Movie",
          recursive: true,
          isPlayed: false,
          sortBy: "DateCreated",
          sortOrder: "Descending",
          limit: 200,
        }),
      ]);
      const images: JellyfinRows["images"] = {};
      const map = (list: BaseItemDto[] | undefined, tag: MediaList) =>
        (list ?? []).flatMap((d) => {
          const item = mapItem(d, [tag]);
          if (!item) return [];
          images[d.Id] = imageRefs(d);
          return [item];
        });
      // Recently added shows: newest unplayed episode per series.
      const seen = new Set<string>();
      const showEpisodes = (latestEpisodes ?? []).filter((d) => {
        if (d.UserData?.Played) return false;
        const s = d.SeriesId ?? d.Id;
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      });
      const rows: JellyfinRows = {
        resume: map(resume.Items, "resume"),
        nextUp: map(nextUp.Items, "nextup"),
        latestMovies: map(
          (latestMovies ?? []).filter((d) => !d.UserData?.Played),
          "latestMovies",
        ),
        latestShows: map(showEpisodes, "latestShows"),
        unwatchedMovies: map(unwatched.Items, "unwatchedMovies"),
        images,
        fetchedAt: this.o.clock.now().toISOString(),
      };
      this.rows = rows;
      this.rowsAt = Date.now();
      this.lastError = null;
      this.lastOkAt = rows.fetchedAt;
      this.o.store.putCache(ROWS_CACHE_KEY, JELLYFIN_SOURCE, rows, rows.fetchedAt);
      return rows;
    } catch (e) {
      this.lastError = e instanceof JellyfinError ? e : new JellyfinError((e as Error).message, "http");
      this.o.log.warn(`jellyfin: ${this.lastError.message}`);
      this.rows = null;
      return null;
    }
  }

  /** Reachability (public info, no auth) plus the result of the last authenticated call. */
  async status(): Promise<
    SourceStatus & { server: string; serverName: string | null; version: string | null }
  > {
    const base = { server: this.o.url, serverName: this.serverName, version: this.version };
    try {
      const info = await this.client.getJson<{ ServerName?: string; Version?: string }>(
        JF.publicInfo,
        {},
        false,
      );
      this.serverName = info.ServerName ?? null;
      this.version = info.Version ?? null;
    } catch (e) {
      return {
        ...base,
        state: "unreachable",
        detail: `${(e as Error).message}${this.rows || this.hasCache() ? "; showing cached items" : ""}`,
        itemCount: 0,
        checkedAt: this.o.clock.now().toISOString(),
      };
    }
    const { rows } = await this.getRows();
    const count = rows ? new Set(allMediaItems(rows).map((i) => i.key)).size : 0;
    const err = this.lastError;
    return {
      server: this.o.url,
      serverName: this.serverName,
      version: this.version,
      state: err ? "degraded" : this.o.mock ? "mock" : "ok",
      detail: err
        ? err.message
        : `${this.serverName ?? "Jellyfin"} ${this.version ?? ""}`.trim() +
          (this.o.mock ? " (fixtures)" : ""),
      itemCount: count,
      checkedAt: this.lastOkAt,
    };
  }

  hasCache(): boolean {
    return this.o.store.getCache(ROWS_CACHE_KEY, JELLYFIN_SOURCE) !== null;
  }

  /** Image bytes for an item's poster or hero, or null when it has none. */
  async image(itemId: string, kind: "poster" | "hero"): Promise<{ body: Uint8Array; type: string } | null> {
    const { rows } = await this.getRows();
    const ref = rows?.images[itemId]?.[kind] ?? null;
    if (!ref) return null;
    const width = kind === "poster" ? 600 : 1920;
    try {
      return await this.client.getBytes(
        JF.image(ref.itemId, ref.type, ref.type === "Backdrop" ? 0 : undefined),
        {
          fillWidth: width,
          quality: 90,
          tag: ref.tag,
        },
      );
    } catch (e) {
      if (e instanceof JellyfinError && e.status === 404) return null;
      throw e;
    }
  }

  async sessions(): Promise<Session[]> {
    const userId = await this.user();
    return this.client.getJson<Session[]>(JF.sessions, {
      controllableByUserId: userId,
      activeWithinSeconds: 120,
    });
  }

  async play(sessionId: string, itemId: string, positionSec: number): Promise<void> {
    await this.client.post(JF.playing(sessionId), {
      playCommand: "PlayNow",
      itemIds: itemId,
      startPositionTicks: Math.max(0, Math.round(positionSec)) * TICKS_PER_SECOND,
    });
  }

  webUrl(itemId: string): string {
    return `${this.o.url}/web/#/details?id=${encodeURIComponent(itemId)}`;
  }
}

/** Every media item across rows, de-duplicated by key, lists merged. */
export function allMediaItems(rows: JellyfinRows): UnifiedItem[] {
  const out = new Map<string, UnifiedItem>();
  for (const list of [rows.resume, rows.nextUp, rows.latestMovies, rows.latestShows, rows.unwatchedMovies]) {
    for (const i of list) {
      const prev = out.get(i.key);
      if (prev) prev.mediaLists = [...new Set([...(prev.mediaLists ?? []), ...(i.mediaLists ?? [])])];
      else out.set(i.key, { ...i, mediaLists: [...(i.mediaLists ?? [])] });
    }
  }
  return [...out.values()];
}

export function watchRows(rows: JellyfinRows | null): WatchRow[] {
  return [
    { id: "continue", title: "Continue Watching", items: rows?.resume ?? [] },
    { id: "nextup", title: "Next Up", items: rows?.nextUp ?? [] },
    { id: "movies", title: "Recently Added Movies", items: rows?.latestMovies ?? [] },
    { id: "shows", title: "Recently Added Shows", items: rows?.latestShows ?? [] },
  ];
}
