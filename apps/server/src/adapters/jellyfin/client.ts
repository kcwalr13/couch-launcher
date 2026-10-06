/**
 * Minimal Jellyfin REST client.
 * Auth: `Authorization: MediaBrowser Client=..., Device=..., DeviceId=..., Version=..., Token="<api key>"`.
 * The legacy X-Emby-Token header and api_key query are gated behind EnableLegacyAuthorization
 * (on by default in 10.11, off in the next major), so they are not used. See DECISIONS D-012.
 */
import { VERSION } from "../../version.ts";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Current (10.9+) endpoint paths. The /Users/{id}/Items/... forms are obsolete in 10.11. */
export const JF = {
  publicInfo: "/System/Info/Public",
  systemInfo: "/System/Info",
  users: "/Users",
  resume: "/UserItems/Resume",
  nextUp: "/Shows/NextUp",
  latest: "/Items/Latest",
  items: "/Items",
  item: (id: string) => `/Items/${encodeURIComponent(id)}`,
  image: (id: string, type: "Primary" | "Backdrop" | "Thumb", index?: number) =>
    `/Items/${encodeURIComponent(id)}/Images/${type}${index !== undefined ? `/${index}` : ""}`,
  sessions: "/Sessions",
  playing: (sessionId: string) => `/Sessions/${encodeURIComponent(sessionId)}/Playing`,
} as const;

export class JellyfinError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "auth" | "http" | "parse",
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface JellyfinClientOptions {
  url: string;
  apiKey: string;
  deviceId: string;
  deviceName: string;
  fetch: FetchFn;
  timeoutMs?: number;
}

function q(v: string): string {
  // Header values are quoted; strip characters that would break the quoting.
  return v.replace(/["\\\r\n,]/g, "");
}

export function authorizationHeader(o: { apiKey: string; deviceId: string; deviceName: string }): string {
  return `MediaBrowser Client="Couch Launcher", Device="${q(o.deviceName)}", DeviceId="${q(o.deviceId)}", Version="${VERSION}", Token="${q(o.apiKey)}"`;
}

export type Query = Record<string, string | number | boolean | undefined>;

export function buildUrl(base: string, path: string, query: Query = {}): string {
  const u = new URL(base.replace(/\/+$/, "") + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

export class JellyfinClient {
  constructor(private readonly o: JellyfinClientOptions) {}

  get baseUrl(): string {
    return this.o.url;
  }

  private async request(method: string, path: string, query: Query, auth: boolean): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 5000);
    const headers: Record<string, string> = { accept: "application/json" };
    if (auth) headers.authorization = authorizationHeader(this.o);
    let res: Response;
    try {
      res = await this.o.fetch(buildUrl(this.o.url, path, query), { method, headers, signal: ctrl.signal });
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? "timed out" : (e as Error).message;
      throw new JellyfinError(`cannot reach Jellyfin: ${msg}`, "unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403)
      throw new JellyfinError("Jellyfin rejected the API key", "auth", res.status);
    if (!res.ok) throw new JellyfinError(`Jellyfin answered ${res.status} for ${path}`, "http", res.status);
    return res;
  }

  async getJson<T>(path: string, query: Query = {}, auth = true): Promise<T> {
    const res = await this.request("GET", path, query, auth);
    try {
      return (await res.json()) as T;
    } catch {
      throw new JellyfinError(`invalid JSON from ${path}`, "parse");
    }
  }

  async getBytes(path: string, query: Query = {}): Promise<{ body: Uint8Array; type: string }> {
    const res = await this.request("GET", path, query, true);
    return {
      body: new Uint8Array(await res.arrayBuffer()),
      type: res.headers.get("content-type") ?? "image/jpeg",
    };
  }

  async post(path: string, query: Query = {}): Promise<number> {
    const res = await this.request("POST", path, query, true);
    return res.status;
  }
}
