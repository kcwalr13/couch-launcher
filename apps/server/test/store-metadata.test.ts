import { afterEach, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { StoreMetadata } from "../src/adapters/steam/store-metadata.ts";
import { fixedClock } from "../src/clock.ts";
import { Store } from "../src/db.ts";
import { createLogger } from "../src/log.ts";
import { tempDir } from "./helpers.ts";

let t: ReturnType<typeof tempDir>;
let store: Store;
beforeEach(() => {
  t = tempDir();
  store = new Store(path.join(t.dir, "s.sqlite"));
});
afterEach(() => {
  store.close();
  t.cleanup();
});

const body = (id: string, genre = "Action") =>
  Response.json({
    [id]: {
      success: true,
      data: {
        type: "game",
        name: `App ${id}`,
        genres: [{ id: "1", description: genre }],
        categories: [{ id: 28, description: "Full controller support" }],
      },
    },
  });

function make(fetchImpl: (url: string) => Promise<Response>, now = "2026-10-03T19:00:00Z") {
  const sleeps: number[] = [];
  const urls: string[] = [];
  const md = new StoreMetadata({
    store,
    clock: fixedClock(now),
    log: createLogger({ quiet: true }),
    fetch: async (u) => {
      urls.push(u);
      return fetchImpl(u);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    minIntervalMs: 1500,
  });
  return { md, sleeps, urls };
}

test("fetches missing apps one at a time with a gap, then serves from cache", async () => {
  const { md, sleeps, urls } = make(async (u) => body(new URL(u).searchParams.get("appids") as string));
  await md.refresh(["1", "2", "3"]);
  expect(urls.length).toBe(3);
  expect(urls[0]).toBe("https://store.steampowered.com/api/appdetails?appids=1&l=english");
  expect(sleeps.length).toBeGreaterThanOrEqual(2);
  expect(sleeps.every((s) => s <= 1500)).toBe(true);
  expect(md.get("2")?.genres).toEqual(["Action"]);
  await md.refresh(["1", "2", "3"]);
  expect(urls.length).toBe(3);
});

test("refreshes entries older than 30 days", async () => {
  const first = make(
    async (u) => body(new URL(u).searchParams.get("appids") as string),
    "2026-08-01T00:00:00Z",
  );
  await first.md.refresh(["1"]);
  const later = make(
    async (u) => body(new URL(u).searchParams.get("appids") as string, "RPG"),
    "2026-10-03T00:00:00Z",
  );
  expect(later.md.stale(["1"])).toEqual(["1"]);
  await later.md.refresh(["1"]);
  expect(later.md.get("1")?.genres).toEqual(["RPG"]);
  const soon = make(async () => body("1"), "2026-10-10T00:00:00Z");
  expect(soon.md.stale(["1"])).toEqual([]);
});

test("offline: keeps the cache, records the error, stops the queue", async () => {
  const ok = make(async (u) => body(new URL(u).searchParams.get("appids") as string));
  await ok.md.refresh(["1"]);
  const off = make(async () => {
    throw new TypeError("network down");
  });
  await off.md.refresh(["1", "2", "3"], true);
  expect(off.urls.length).toBe(1);
  expect(off.md.status().offline).toBe(true);
  expect(off.md.get("1")?.name).toBe("App 1");
});

test("a 429 backs off before retrying", async () => {
  let n = 0;
  const { md, sleeps } = make(async (u) =>
    n++ === 0 ? new Response("", { status: 429 }) : body(new URL(u).searchParams.get("appids") as string),
  );
  await md.refresh(["7"]);
  expect(md.get("7")).not.toBeNull();
  expect(Math.max(...sleeps)).toBeGreaterThan(60_000);
});

test("apps without a store page are cached as unavailable (no refetch loop)", async () => {
  const { md, urls } = make(async () => Response.json({ "9": { success: false } }));
  await md.refresh(["9"]);
  await md.refresh(["9"]);
  expect(urls.length).toBe(1);
  expect(md.get("9")?.available).toBe(false);
});
