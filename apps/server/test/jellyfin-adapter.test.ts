import { afterEach, describe, expect, test } from "bun:test";
import type { StatusResponse, WatchResponse } from "@couch/core";
import { mapItem } from "../src/adapters/jellyfin/jellyfin.ts";
import { makeTestApp, type TestApp } from "./helpers.ts";

let t: TestApp;
afterEach(() => t.cleanup());

const watch = async () => (await (await t.get("/api/watch")).json()) as WatchResponse;
const status = async () => (await (await t.get("/api/status")).json()) as StatusResponse;
const row = (w: WatchResponse, id: string) => w.rows.find((r) => r.id === id)?.items ?? [];

describe("fixture responses map to unified items", () => {
  test("rows, order and fields", async () => {
    t = makeTestApp();
    const w = await watch();
    expect(w.status).toBe("mock");
    expect(w.cached).toBe(false);
    expect(w.rows.map((r) => r.title)).toEqual([
      "Continue Watching",
      "Next Up",
      "Recently Added Movies",
      "Recently Added Shows",
    ]);
    expect(row(w, "continue").map((i) => `${i.title} | ${i.subtitle}`)).toEqual([
      "Severance | S2:E4 · Woe's Hollow",
      "Paddington 2 | 2017 · PG · 1 h 43 min",
      "Arrival | 2016 · PG-13 · 1 h 56 min",
    ]);
    expect(row(w, "nextup").map((i) => `${i.title} | ${i.subtitle}`)).toEqual(["Bluey | S3:E11 · Housework"]);
    expect(row(w, "movies").map((i) => i.title)).toEqual([
      "Dune: Part Two",
      "Mad Max: Fury Road",
      "The Grand Budapest Hotel",
      "Paddington 2",
      "Wallace & Gromit: Vengeance Most Fowl",
      "Spirited Away",
      "Arrival",
    ]);
    expect(row(w, "shows").map((i) => `${i.title} | ${i.subtitle}`)).toEqual([
      "The Bear | S4:E1 · Groundhog Day",
      "Shōgun | S1:E1 · Anjin",
      "Severance | S2:E4 · Woe's Hollow",
      "Bluey | S3:E11 · Housework",
    ]);
    const arrival = row(w, "continue")[2];
    expect(arrival).toMatchObject({
      kind: "movie",
      source: "jellyfin",
      progress: { positionSec: 4440, durationSec: 6960 },
      lastActivityAt: "2026-09-29T17:00:00.0000000Z",
      addedAt: "2026-03-17T19:00:00.0000000Z",
      tags: { genres: ["Drama", "Science Fiction"] },
      mediaLists: ["resume"],
    });
    expect(arrival?.launch).toEqual({
      type: "jellyfin",
      itemId: String(arrival?.key.slice("jellyfin:".length)),
      positionSec: 4440,
    });
    expect(arrival?.art.poster).toBe(`/api/art/${arrival?.key}/poster`);
    const sev = row(w, "continue")[0];
    expect(sev).toMatchObject({ kind: "episode", progress: { positionSec: 600, durationSec: 3120 } });
  });

  test("unsupported item types are dropped", () => {
    expect(mapItem({ Id: "x", Type: "Series" }, [])).toBeNull();
    expect(mapItem({ Id: "x", Type: "Movie", Name: "M" }, [])?.progress).toBeNull();
  });

  test("the user is auto-detected and sent on every call", async () => {
    t = makeTestApp();
    await watch();
    const calls = t.jf.requests.filter((r) => !r.includes("/System/Info/Public"));
    expect(calls[0]).toBe("GET /Users");
    expect(calls.slice(1).every((r) => r.includes("userId=8a1b2c3d4e5f60718293a4b5c6d7e8f9"))).toBe(true);
  });

  test("a configured user skips the lookup", async () => {
    t = makeTestApp({ configure: (c) => (c.jellyfin.user_id = "abc") });
    await watch();
    expect(t.jf.requests).not.toContain("GET /Users");
  });
});

describe("status and outages", () => {
  test("healthy status names the server", async () => {
    t = makeTestApp();
    const s = await status();
    expect(s.jellyfin).toMatchObject({ state: "mock", serverName: "dxp2800", version: "10.11.2" });
    expect(s.jellyfin.itemCount).toBe(11);
  });

  test("unreachable with a cache: status says so and Watch shows cached items", async () => {
    t = makeTestApp();
    await watch();
    t.jf.down = true;
    // Force past the in-memory TTL.
    const w = (await (await t.app.fetch(new Request("http://x/api/watch"))).json()) as WatchResponse;
    expect(w.status).toBe("mock"); // still fresh in memory
    await t.app.jellyfin?.getRows(true);
    const w2 = await watch();
    expect(w2.status).toBe("unreachable");
    expect(w2.cached).toBe(true);
    expect(row(w2, "continue").length).toBe(3);
    const s = await status();
    expect(s.jellyfin.state).toBe("unreachable");
    expect(s.jellyfin.detail).toContain("cached");
  });

  test("unreachable with no cache: empty rows", async () => {
    t = makeTestApp();
    t.jf.down = true;
    const w = await watch();
    expect(w.status).toBe("unreachable");
    expect(w.cached).toBe(false);
    expect(w.rows.every((r) => r.items.length === 0)).toBe(true);
    expect((await status()).jellyfin.state).toBe("unreachable");
  });

  test("a wrong API key is reported, and the key never leaks", async () => {
    t = makeTestApp({ configure: (c) => (c.jellyfin.api_key = "wrong-key-123") });
    const s = await status();
    expect(s.jellyfin.state).toBe("degraded");
    expect(s.jellyfin.detail).toContain("rejected the API key");
    const all = JSON.stringify(s) + JSON.stringify(await watch()) + (t.deps.log.lines ?? []).join("\n");
    expect(all).not.toContain("wrong-key-123");
  });

  test("not configured", async () => {
    t = makeTestApp({ configure: (c) => (c.jellyfin.url = "") });
    expect((await status()).jellyfin.state).toBe("not_configured");
    const w = await watch();
    expect(w.status).toBe("not_configured");
  });
});

describe("images", () => {
  test("movie and episode art; missing art is null", async () => {
    t = makeTestApp();
    const w = await watch();
    const movie = row(w, "continue")[2];
    const img = await t.app.jellyfin?.image(movie?.key.slice(9) as string, "poster");
    expect(img?.type).toBe("image/png");
    expect(img?.body.length).toBeGreaterThan(100);
    const ep = row(w, "continue")[0];
    await t.app.jellyfin?.image(ep?.key.slice(9) as string, "hero");
    expect(t.jf.requests.at(-1)).toMatch(/^GET \/Items\/[0-9a-f]+\/Images\/Backdrop\/0\?fillWidth=1920/);
    const shogun = row(w, "shows")[1];
    expect(await t.app.jellyfin?.image(shogun?.key.slice(9) as string, "poster")).toBeNull();
  });
});
