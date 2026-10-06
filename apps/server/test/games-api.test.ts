import { afterEach, expect, test } from "bun:test";
import type { GamesResponse, StatusResponse } from "@couch/core";
import { makeTestApp, type TestApp } from "./helpers.ts";

let t: TestApp;
afterEach(() => t.cleanup());

async function games(q = "") {
  return (await (await t.get(`/api/games${q}`)).json()) as GamesResponse;
}

test("GET /api/games lists installed games and game shortcuts, most recent first", async () => {
  t = makeTestApp();
  await t.app.library.steam();
  await t.app.metadata.refresh((await t.app.library.steam()).games.map((g) => g.appId));
  const r = await games();
  expect(r.sort).toBe("recent");
  expect(r.items.length).toBe(14);
  expect(r.items.slice(0, 4).map((i) => i.title)).toEqual([
    "Balatro",
    "Hades",
    "Vampire Survivors",
    "Diablo IV",
  ]);
  expect(r.items.map((i) => i.title)).not.toContain("Jellyfin Desktop");
  expect(r.items.map((i) => i.title)).not.toContain("Proton 9.0");
  expect(r.items.find((i) => i.title === "Stardew Valley")?.tags).toMatchObject({
    couchCoop: true,
    controller: "full",
  });
});

test("sorts and filters", async () => {
  t = makeTestApp();
  await t.app.metadata.refresh((await t.app.library.steam()).games.map((g) => g.appId));
  expect((await games("?sort=az")).items.slice(0, 3).map((i) => i.title)).toEqual([
    "Balatro",
    "Celeste",
    "Cyberpunk 2077",
  ]);
  expect((await games("?sort=playtime")).items[0]?.title).toBe("Stardew Valley");
  expect((await games("?coop=1")).items.map((i) => i.title).sort()).toEqual([
    "It Takes Two",
    "Portal 2",
    "Stardew Valley",
    "Terraria",
    "Vampire Survivors",
  ]);
  const ctl = (await games("?controller=1")).items.map((i) => i.title);
  expect(ctl).not.toContain("RimWorld");
  expect(ctl).not.toContain("Terraria");
  expect(ctl).not.toContain("Diablo IV");
  expect((await games("?sort=bogus")).sort).toBe("recent");
});

test("status reports the Steam library", async () => {
  t = makeTestApp();
  const s = (await (await t.get("/api/status")).json()) as StatusResponse;
  expect(s.steam.state).toBe("mock");
  expect(s.steam.root).toBe("/home/deck/.local/share/Steam");
  expect(s.steam.libraries).toEqual(["/home/deck/.local/share/Steam", "/run/media/deck/SD/SteamLibrary"]);
  expect(s.steam.itemCount).toBe(16);
});
