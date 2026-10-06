/**
 * Fixture-backed fetch for mock mode: answers Steam store appdetails from fixtures/steam/store.
 * (The Jellyfin mock server is added in mock/jellyfin.ts.)
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FetchFn } from "../adapters/jellyfin/client.ts";

export function mockStoreFetch(fixtures: string): FetchFn {
  return async (input) => {
    const u = new URL(input);
    if (u.hostname !== "store.steampowered.com") return new Response("not found", { status: 404 });
    const id = u.searchParams.get("appids") ?? "";
    const f = path.join(fixtures, "steam", "store", `${id.replace(/\D/g, "")}.json`);
    if (!existsSync(f)) return Response.json({ [id]: { success: false } });
    return new Response(readFileSync(f), { headers: { "content-type": "application/json" } });
  };
}
