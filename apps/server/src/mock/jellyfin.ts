/**
 * A fixture-backed Jellyfin server, exposed as a fetch function. Mock mode and tests use it so the
 * real Jellyfin adapter (client, mapping, caching, handoff) runs unchanged.
 * It checks the MediaBrowser auth header like the real server and records remote-control calls.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FetchFn } from "../adapters/jellyfin/client.ts";

export const MOCK_JELLYFIN_URL = "http://jellyfin.mock:8096";
export const MOCK_JELLYFIN_KEY = "mock-api-key";

export interface MockJellyfin {
  fetch: FetchFn;
  /** Simulate the NAS being unreachable. */
  down: boolean;
  /** GET /Sessions returns no sessions for this many calls (the client is "starting"). */
  sessionsDelay: number;
  /** Remote-control play commands received. */
  plays: { sessionId: string; query: Record<string, string> }[];
  requests: string[];
}

export function mockJellyfin(fixtures: string): MockJellyfin {
  const dir = path.join(fixtures, "jellyfin");
  const file = (n: string) =>
    new Response(readFileSync(path.join(dir, n)), { headers: { "content-type": "application/json" } });
  const state: MockJellyfin = {
    down: false,
    sessionsDelay: 0,
    plays: [],
    requests: [],
    fetch: async (input, init) => {
      const u = new URL(input);
      const method = init?.method ?? "GET";
      state.requests.push(`${method} ${u.pathname}${u.search}`);
      if (state.down || u.origin !== MOCK_JELLYFIN_URL) throw new TypeError("fetch failed: ECONNREFUSED");
      const p = u.pathname;
      if (p === "/System/Info/Public") return file("system-info-public.json");
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      if (!auth.startsWith("MediaBrowser ") || !auth.includes(`Token="${MOCK_JELLYFIN_KEY}"`))
        return new Response("Unauthorized", { status: 401 });
      if (p === "/Users") return file("users.json");
      if (p === "/UserItems/Resume") return file("resume.json");
      if (p === "/Shows/NextUp") return file("nextup.json");
      if (p === "/Items/Latest")
        return file(
          u.searchParams.get("includeItemTypes") === "Movie" ? "latest-movies.json" : "latest-episodes.json",
        );
      if (p === "/Items") return file("unwatched-movies.json");
      if (p === "/Sessions") {
        if (state.sessionsDelay > 0) {
          state.sessionsDelay--;
          return Response.json([]);
        }
        return file("sessions.json");
      }
      const play = /^\/Sessions\/([^/]+)\/Playing$/.exec(p);
      if (play && method === "POST") {
        state.plays.push({
          sessionId: decodeURIComponent(play[1] as string),
          query: Object.fromEntries(u.searchParams),
        });
        return new Response(null, { status: 204 });
      }
      const img = /^\/Items\/([0-9a-f]+)\/Images\/(Primary|Backdrop)(?:\/\d+)?$/.exec(p);
      if (img) {
        const f = path.join(dir, "images", `${img[1]}-${img[2]}.png`);
        if (existsSync(f)) return new Response(readFileSync(f), { headers: { "content-type": "image/png" } });
        return new Response("Not found", { status: 404 });
      }
      return new Response("Not found", { status: 404 });
    },
  };
  return state;
}
