import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import type { GamesResponse, ItemResponse, Profile, WatchResponse } from "@couch/core";
import { createApp } from "../src/app.ts";
import { Store } from "../src/db.ts";
import { makeTestApp, type TestApp, tempDir } from "./helpers.ts";

let t: TestApp;
afterEach(() => t?.cleanup());

const profiles = async () =>
  (await (await t.get("/api/profiles")).json()) as { profiles: Profile[]; active: Profile };
const item = async (key: string) => ((await (await t.get(`/api/items/${key}`)).json()) as ItemResponse).item;
const games = async () => ((await (await t.get("/api/games")).json()) as GamesResponse).items;

describe("profiles", () => {
  test("three presets, Solo active", async () => {
    t = makeTestApp();
    const p = await profiles();
    expect(p.profiles.map((x) => [x.name, x.size])).toEqual([
      ["Solo", 1],
      ["Two of us", 2],
      ["Group", 4],
    ]);
    expect(p.active.name).toBe("Solo");
  });
  test("switching", async () => {
    t = makeTestApp();
    const two = (await profiles()).profiles[1] as Profile;
    const r = await t.send("POST", "/api/profiles", { id: two.id });
    expect(r.status).toBe(200);
    expect((await profiles()).active.name).toBe("Two of us");
    expect((await t.send("POST", "/api/profiles", { id: 999 })).status).toBe(400);
    expect((await t.send("POST", "/api/profiles", { id: "1" })).status).toBe(400);
  });
});

describe("preferences", () => {
  test("favourite, hide and session length apply to the active profile only", async () => {
    t = makeTestApp();
    const [solo, two] = (await profiles()).profiles as [Profile, Profile];
    await t.send("POST", "/api/prefs", { key: "steam:620", favourite: true });
    await t.send("POST", "/api/prefs", { key: "steam:2379780", hidden: true });
    await t.send("POST", "/api/prefs", { key: "steam:1145360", sessionLength: "short" });
    expect((await item("steam:620")).favourite).toBe(true);
    expect((await games()).map((i) => i.key)).not.toContain("steam:2379780");
    expect((await item("steam:1145360")).tags).toMatchObject({
      sessionLength: "short",
      sessionLengthOverridden: true,
    });

    await t.send("POST", "/api/profiles", { id: two.id });
    expect((await item("steam:620")).favourite).toBe(false);
    expect((await games()).map((i) => i.key)).toContain("steam:2379780");
    expect((await item("steam:1145360")).tags.sessionLength).toBe("long");

    await t.send("POST", "/api/profiles", { id: solo.id });
    expect((await item("steam:620")).favourite).toBe(true);
  });

  test("hidden media leaves Watch; the hidden list offers it back", async () => {
    t = makeTestApp();
    const w = (await (await t.get("/api/watch")).json()) as WatchResponse;
    const key = w.rows[0]?.items[0]?.key as string;
    await t.send("POST", "/api/prefs", { key, hidden: true });
    const w2 = (await (await t.get("/api/watch")).json()) as WatchResponse;
    expect(w2.rows[0]?.items.map((i) => i.key)).not.toContain(key);
    const hidden = (await (await t.get("/api/hidden")).json()) as { items: { key: string }[] };
    expect(hidden.items.map((i) => i.key)).toEqual([key]);
    await t.send("POST", "/api/prefs", { key, hidden: false });
    expect(((await (await t.get("/api/hidden")).json()) as { items: unknown[] }).items).toEqual([]);
  });

  test("clearing a session length override returns to the genre default", async () => {
    t = makeTestApp();
    await t.send("POST", "/api/prefs", { key: "steam:1145360", sessionLength: "short" });
    await t.send("POST", "/api/prefs", { key: "steam:1145360", sessionLength: null });
    expect((await item("steam:1145360")).tags.sessionLengthOverridden).toBeUndefined();
  });

  test("validation", async () => {
    t = makeTestApp();
    expect((await t.send("POST", "/api/prefs", { key: "nope", favourite: true })).status).toBe(400);
    expect((await t.send("POST", "/api/prefs", { key: "steam:620", favourite: "yes" })).status).toBe(400);
    expect((await t.send("POST", "/api/prefs", { key: "steam:620", sessionLength: "forever" })).status).toBe(
      400,
    );
    expect((await t.send("POST", "/api/prefs", { key: "jellyfin:abc", sessionLength: "short" })).status).toBe(
      400,
    );
  });
});

test("preferences and the active profile persist across a restart", async () => {
  t = makeTestApp();
  const file = path.join(t.deps.dataDir, "test.sqlite");
  const two = (await profiles()).profiles[1] as Profile;
  await t.send("POST", "/api/prefs", { key: "steam:620", favourite: true });
  await t.send("POST", "/api/profiles", { id: two.id });
  await t.send("POST", "/api/prefs", { key: "steam:413150", favourite: true });
  await t.send("PUT", "/api/ui-state", { screen: "watch", focusedKey: "tile:x" });
  t.deps.store.close();

  // A new service process on the same database file.
  const store = new Store(file);
  const app2 = createApp({ ...t.deps, store });
  const get = async <T>(p: string) => (await (await app2.fetch(new Request(`http://x${p}`))).json()) as T;
  expect((await get<{ active: Profile }>("/api/profiles")).active.name).toBe("Two of us");
  expect((await get<ItemResponse>("/api/items/steam:413150")).item.favourite).toBe(true);
  expect((await get<ItemResponse>("/api/items/steam:620")).item.favourite).toBe(false);
  expect((await get<{ state: { screen: string } }>("/api/ui-state")).state.screen).toBe("watch");
  store.setActiveProfile(1);
  expect((await get<ItemResponse>("/api/items/steam:620")).item.favourite).toBe(true);
  t.deps.store = store;
});

test("a fresh database seeds profiles exactly once", () => {
  const d = tempDir();
  const f = path.join(d.dir, "s.sqlite");
  new Store(f).close();
  const s = new Store(f);
  expect(s.profiles().length).toBe(3);
  s.close();
  d.cleanup();
});
