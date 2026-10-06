import { afterEach, describe, expect, test } from "bun:test";
import type { TonightResponse } from "@couch/core";
import { createApp } from "../src/app.ts";
import { fixedClock } from "../src/clock.ts";
import { makeTestApp, type TestApp } from "./helpers.ts";

let t: TestApp;
afterEach(() => t.cleanup());

async function setup() {
  t = makeTestApp();
  await t.app.metadata.refresh((await t.app.library.steam()).games.map((g) => g.appId));
}

const ask = async (body: Record<string, unknown>, app = t.app) =>
  (await (
    await app.fetch(
      new Request("http://x/api/tonight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
  ).json()) as TonightResponse;

const cards = (r: TonightResponse) => r.picks.map((p) => [p.slot, p.item.title, p.score, p.reason]);

describe("golden fixture evening (Saturday 3 Oct 2026, 19:00)", () => {
  test("two of us, one hour, either", async () => {
    await setup();
    const r = await ask({ time: 60, profileId: 2, mode: "either" });
    expect(cards(r)).toEqual([
      ["best", "It Takes Two", 58, "Played on 24 Sep, couch co-op for two"],
      ["finish", "Vampire Survivors", 58, "Played on Wednesday, couch co-op for two"],
      ["wildcard", "Bluey", 46, "7 minutes long, the next episode"],
    ]);
    expect(r.remaining).toBe(11);
  });

  test("solo, 30 minutes, watch: only what fits in half an hour", async () => {
    await setup();
    const r = await ask({ time: 30, profileId: 1, mode: "watch" });
    expect(cards(r)).toEqual([
      ["best", "Bluey", 46, "7 minutes long, the next episode"],
      ["finish", "Paddington 2", 46, "18 minutes left, started on Thursday"],
    ]);
  });

  test("solo, all evening, play", async () => {
    await setup();
    const r = await ask({ time: "evening", profileId: 1, mode: "play" });
    expect(cards(r)).toEqual([
      ["best", "Cyberpunk 2077", 44, "Played on Monday, full controller support"],
      ["finish", "Hades", 44, "Played on Thursday, full controller support"],
      ["wildcard", "Portal 2", 10, "Installed but never played, full controller support"],
    ]);
  });

  test("reroll shows the next three and records skips; skipped items drop for 7 days", async () => {
    await setup();
    const first = await ask({ time: 60, profileId: 2, mode: "either" });
    const shown = first.picks.map((p) => p.item.key);
    const second = await ask({
      time: 60,
      profileId: 2,
      mode: "either",
      page: 1,
      exclude: shown,
      skipped: shown,
    });
    expect(second.picks.length).toBe(3);
    for (const p of second.picks) expect(shown).not.toContain(p.item.key);

    // A new picker session the same evening: the skipped items drop (30 points) and lose the top spot.
    const again = await ask({ time: 60, profileId: 2, mode: "either" });
    expect(again.picks[0]?.item.key).not.toBe(shown[0]);
    expect(again.picks[0]?.signals.some((s) => s.id === "recentlySkipped")).toBe(false);
    for (const p of again.picks.filter((p) => shown.includes(p.item.key))) {
      expect(p.signals.find((s) => s.id === "recentlySkipped")?.score).toBe(-30);
      expect(p.score).toBe((first.picks.find((f) => f.item.key === p.item.key)?.score ?? 0) - 30);
    }
    const events = t.deps.store.suggestionEvents(2, "2000-01-01");
    expect(events.filter((e) => e.action === "skipped").map((e) => e.itemKey)).toEqual(shown);
    expect(events.filter((e) => e.action === "shown").length).toBe(9);

    // Eight days later the penalty has expired: Vampire Survivors (skipped, still played within
    // 14 days) is back on top with no skip signal anywhere.
    const later = createApp({ ...t.deps, clock: fixedClock("2026-10-11T19:00:00.000Z") });
    const r = await ask({ time: 60, profileId: 2, mode: "either" }, later);
    expect(r.picks[0]?.item.key).toBe(shown[1]);
    expect(r.picks.flatMap((p) => p.signals).some((s) => s.id === "recentlySkipped")).toBe(false);
  });

  test("skips are per profile", async () => {
    await setup();
    const first = await ask({ time: "evening", profileId: 1, mode: "play" });
    const best = first.picks[0]?.item.key;
    await ask({ time: "evening", profileId: 1, mode: "play", page: 1, exclude: [best], skipped: [best] });
    const solo = await ask({ time: "evening", profileId: 1, mode: "play" });
    expect(solo.picks[0]?.item.key).not.toBe(best);
    const group = await ask({ time: "evening", profileId: 3, mode: "play" });
    expect(group.picks.map((p) => p.signals.some((s) => s.id === "recentlySkipped"))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("answers and history", () => {
  test("last answers are remembered and switch the active profile", async () => {
    await setup();
    const fresh = (await (await t.get("/api/tonight/last")).json()) as { answers: unknown };
    expect(fresh.answers).toEqual({ time: 60, profileId: 1, mode: "either" });
    await ask({ time: 120, profileId: 3, mode: "watch" });
    expect(((await (await t.get("/api/tonight/last")).json()) as { answers: unknown }).answers).toEqual({
      time: 120,
      profileId: 3,
      mode: "watch",
    });
    expect(t.deps.store.activeProfile().name).toBe("Group");
  });

  test("accept records an accepted event", async () => {
    await setup();
    const r = await t.send("POST", "/api/tonight/accept", { key: "steam:620", profileId: 1 });
    expect(r.status).toBe(200);
    expect(t.deps.store.suggestionEvents(1, "2000-01-01").map((e) => e.action)).toEqual(["accepted"]);
  });

  test("validation", async () => {
    await setup();
    for (const body of [
      { time: 45, profileId: 1, mode: "either" },
      { time: 60, profileId: 9, mode: "either" },
      { time: 60, profileId: 1, mode: "dance" },
    ])
      expect((await t.send("POST", "/api/tonight", body)).status).toBe(400);
    expect((await t.send("POST", "/api/tonight/accept", { key: "x" })).status).toBe(400);
  });

  test("weights come from the config file", async () => {
    t = makeTestApp({ configure: (c) => (c.picker.weights.neglected = 500) });
    await t.app.metadata.refresh((await t.app.library.steam()).games.map((g) => g.appId));
    const r = await ask({ time: "evening", profileId: 1, mode: "play" });
    // Every pick is now led by the boosted neglected signal.
    expect(r.picks[0]?.item.title).toBe("Hollow Knight");
    expect(r.picks[0]?.reason).toStartWith("Not played since 5 Jun");
  });
});
