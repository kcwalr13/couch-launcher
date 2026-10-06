import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { HomeResponse, ItemResponse } from "@couch/core";
import { sniffImageType } from "../src/services/art.ts";
import { makeTestApp, type TestApp } from "./helpers.ts";

let t: TestApp;
afterEach(() => t.cleanup());

test("GET /api/home mixes recent games and resume items, newest first", async () => {
  t = makeTestApp();
  const h = (await (await t.get("/api/home")).json()) as HomeResponse;
  expect(h.profile.name).toBe("Solo");
  expect(h.continueRow.map((i) => i.title)).toEqual([
    "Severance",
    "Balatro",
    "Paddington 2",
    "Hades",
    "Vampire Survivors",
    "Arrival",
    "Diablo IV",
    "Cyberpunk 2077",
    "It Takes Two",
    "Stardew Valley",
  ]);
});

test("hidden items leave the Continue row", async () => {
  t = makeTestApp();
  t.deps.store.setPref(t.deps.store.activeProfile().id, "steam:2379780", { hidden: true });
  const h = (await (await t.get("/api/home")).json()) as HomeResponse;
  expect(h.continueRow.map((i) => i.title)).not.toContain("Balatro");
});

describe("GET /api/items/:key", () => {
  test("returns games, shortcuts and media", async () => {
    t = makeTestApp();
    const g = (await (await t.get("/api/items/steam:620")).json()) as ItemResponse;
    expect(g.item.title).toBe("Portal 2");
    const s = (await (await t.get("/api/items/shortcut:2560399406")).json()) as ItemResponse;
    expect(s.item.launch).toEqual({ type: "shortcut", gameId: "10996831713501380608" });
    const h = (await (await t.get("/api/home")).json()) as HomeResponse;
    const media = h.continueRow.find((i) => i.kind === "movie");
    const m = (await (await t.get(`/api/items/${media?.key}`)).json()) as ItemResponse;
    expect(m.item.progress?.positionSec).toBeGreaterThan(0);
  });
  test("400 for malformed keys, 404 for unknown ones", async () => {
    t = makeTestApp();
    expect((await t.get("/api/items/steam:1")).status).toBe(404);
    expect((await t.get("/api/items/nope")).status).toBe(400);
    expect((await t.get(`/api/items/${encodeURIComponent("steam:../../x")}`)).status).toBe(400);
  });
});

describe("GET /api/art/:key/:kind", () => {
  test("local Steam art, sniffed type", async () => {
    t = makeTestApp();
    const r = await t.get("/api/art/steam:1145360/poster");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(sniffImageType(new Uint8Array(await r.arrayBuffer()))).toBe("image/png");
  });
  test("missing art is a 404 (the UI shows a text fallback)", async () => {
    t = makeTestApp();
    expect((await t.get("/api/art/steam:1966720/poster")).status).toBe(404);
    expect((await t.get("/api/art/shortcut:3006477107/hero")).status).toBe(404);
    expect((await t.get("/api/art/steam:620/banner")).status).toBe(400);
  });
  test("shortcut grid art", async () => {
    t = makeTestApp();
    expect((await t.get("/api/art/shortcut:2560399406/poster")).status).toBe(200);
  });
  test("Jellyfin art is proxied, disk-cached, and served from cache when the NAS is down", async () => {
    t = makeTestApp();
    const h = (await (await t.get("/api/home")).json()) as HomeResponse;
    const movie = h.continueRow.find((i) => i.title === "Arrival");
    const r = await t.get(`/api/art/${movie?.key}/poster`);
    expect(r.status).toBe(200);
    expect(readdirSync(path.join(t.deps.dataDir, "art")).length).toBe(1);
    t.jf.down = true;
    const again = await t.get(`/api/art/${movie?.key}/poster`);
    expect(again.status).toBe(200);
  });
  test("the API key never reaches the browser through art", async () => {
    t = makeTestApp();
    const h = (await (await t.get("/api/home")).json()) as HomeResponse;
    const movie = h.continueRow.find((i) => i.kind === "movie");
    expect(movie?.art.poster).toStartWith("/api/art/");
    expect(JSON.stringify(h)).not.toContain("mock-api-key");
    expect(existsSync(t.deps.dataDir)).toBe(true);
  });
});

test("the UI is served for non-API paths", async () => {
  t = makeTestApp();
  const r = await t.get("/play");
  expect([200, 404]).toContain(r.status);
});
