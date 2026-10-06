/**
 * Steam store metadata (genres, categories, description) per app, from the public appdetails
 * endpoint. Cached in SQLite (metadata_cache, source "steam-store"), refreshed after 30 days,
 * requested one at a time with a minimum gap, and fully usable offline from the cache.
 */
import type { Clock } from "../../clock.ts";
import type { Store } from "../../db.ts";
import type { Logger } from "../../log.ts";
import type { FetchFn } from "../jellyfin/client.ts";

export const STORE_SOURCE = "steam-store";
export const STORE_URL = "https://store.steampowered.com/api/appdetails";

export const CAT_SHARED_SCREEN = 24;
export const CAT_SHARED_SCREEN_PVP = 37;
export const CAT_SHARED_SCREEN_COOP = 39;
export const CAT_FULL_CONTROLLER = 28;
export const CAT_PARTIAL_CONTROLLER = 18;
export const COUCH_CATEGORIES = [CAT_SHARED_SCREEN, CAT_SHARED_SCREEN_PVP, CAT_SHARED_SCREEN_COOP];

export interface StoreInfo {
  appId: string;
  /** False when the store has no page for the app (delisted, tool, region locked). */
  available: boolean;
  type: string | null;
  name: string | null;
  description: string | null;
  genres: string[];
  categories: number[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseAppDetails(appId: string, body: unknown): StoreInfo {
  const missing: StoreInfo = {
    appId,
    available: false,
    type: null,
    name: null,
    description: null,
    genres: [],
    categories: [],
  };
  if (!isObj(body)) return missing;
  const entry = body[appId];
  if (!isObj(entry) || entry.success !== true || !isObj(entry.data)) return missing;
  const d = entry.data;
  const genres = Array.isArray(d.genres)
    ? d.genres.flatMap((g) => (isObj(g) && typeof g.description === "string" ? [g.description] : []))
    : [];
  const categories = Array.isArray(d.categories)
    ? d.categories.flatMap((c) => (isObj(c) && Number.isFinite(Number(c.id)) ? [Number(c.id)] : []))
    : [];
  return {
    appId,
    available: true,
    type: typeof d.type === "string" ? d.type : null,
    name: typeof d.name === "string" ? d.name : null,
    description: typeof d.short_description === "string" ? decodeEntities(d.short_description) : null,
    genres,
    categories,
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

export interface StoreMetadataOptions {
  store: Store;
  fetch: FetchFn | null;
  clock: Clock;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  maxAgeDays?: number;
  backoffMs?: number;
}

export interface MetadataStatus {
  cached: number;
  pending: number;
  lastError: string | null;
  lastFetchAt: string | null;
  offline: boolean;
}

export class StoreMetadata {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minInterval: number;
  private readonly maxAgeMs: number;
  private readonly backoffMs: number;
  private running: Promise<void> | null = null;
  private queue: string[] = [];
  private lastRequestAt = 0;
  private blockedUntil = 0;
  private lastError: string | null = null;
  private lastFetchAt: string | null = null;
  private offline = false;

  constructor(private readonly o: StoreMetadataOptions) {
    this.sleep = o.sleep ?? ((ms) => Bun.sleep(ms));
    this.minInterval = o.minIntervalMs ?? 1500;
    this.maxAgeMs = (o.maxAgeDays ?? 30) * 86_400_000;
    this.backoffMs = o.backoffMs ?? 5 * 60_000;
  }

  get(appId: string): StoreInfo | null {
    return this.o.store.getCache<StoreInfo>(`steam:${appId}`, STORE_SOURCE)?.value ?? null;
  }

  all(): Map<string, StoreInfo> {
    const out = new Map<string, StoreInfo>();
    for (const [k, v] of this.o.store.getCacheBySource<StoreInfo>(STORE_SOURCE))
      out.set(k.replace(/^steam:/, ""), v.value);
    return out;
  }

  /** App ids that are missing from the cache or older than the refresh age. */
  stale(appIds: string[], force = false): string[] {
    const now = this.o.clock.now().getTime();
    const cache = this.o.store.getCacheBySource<StoreInfo>(STORE_SOURCE);
    return appIds.filter((id) => {
      if (force) return true;
      const c = cache.get(`steam:${id}`);
      return !c || now - Date.parse(c.fetchedAt) > this.maxAgeMs;
    });
  }

  status(): MetadataStatus {
    return {
      cached: this.o.store.getCacheBySource(STORE_SOURCE).size,
      pending: this.queue.length,
      lastError: this.lastError,
      lastFetchAt: this.lastFetchAt,
      offline: this.offline,
    };
  }

  /** Queue stale ids and process them in the background. Resolves when the queue drains. */
  refresh(appIds: string[], force = false): Promise<void> {
    if (!this.o.fetch) return Promise.resolve();
    for (const id of this.stale(appIds, force)) if (!this.queue.includes(id)) this.queue.push(id);
    if (!this.running)
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async drain(): Promise<void> {
    const fetchFn = this.o.fetch;
    if (!fetchFn) return;
    while (this.queue.length > 0) {
      const wait = Math.max(this.lastRequestAt + this.minInterval, this.blockedUntil) - Date.now();
      if (wait > 0) await this.sleep(wait);
      const id = this.queue[0] as string;
      this.lastRequestAt = Date.now();
      try {
        const res = await fetchFn(`${STORE_URL}?appids=${encodeURIComponent(id)}&l=english`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 429) {
          this.lastError = "store rate limit (429); backing off";
          this.blockedUntil = Date.now() + this.backoffMs;
          this.o.log.warn("store metadata: rate limited, backing off");
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const info = parseAppDetails(id, await res.json());
        this.o.store.putCache(`steam:${id}`, STORE_SOURCE, info, this.o.clock.now().toISOString());
        this.lastFetchAt = this.o.clock.now().toISOString();
        this.offline = false;
        this.lastError = null;
        this.queue.shift();
      } catch (e) {
        // Offline or the store is unreachable: keep using the cache and stop for now.
        this.lastError = `store metadata unavailable: ${(e as Error).message}`;
        this.offline = true;
        this.o.log.warn(this.lastError);
        this.queue = [];
      }
    }
  }
}
