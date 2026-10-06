import { describe, expect, test } from "bun:test";
import {
  excludedBecause,
  type PickerContext,
  pickTonight,
  rankCandidates,
  reasonFor,
  seededRandom,
  signalsFor,
} from "./picker.ts";
import { DEFAULT_WEIGHTS } from "./picker-config.ts";
import type { SignalId, UnifiedItem } from "./types.ts";

const NOW = new Date("2026-10-03T19:00:00Z"); // Saturday
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function game(
  key: string,
  over: Partial<UnifiedItem> = {},
  tags: Partial<UnifiedItem["tags"]> = {},
): UnifiedItem {
  return {
    key: `steam:${key}`,
    kind: "game",
    source: "steam",
    title: key,
    subtitle: null,
    summary: null,
    art: { poster: "", hero: "" },
    lastActivityAt: daysAgo(30),
    addedAt: null,
    progress: null,
    playtimeMin: 100,
    tags: { genres: [], couchCoop: false, controller: "full", sessionLength: "short", ...tags },
    launch: { type: "steam", appId: key },
    ...over,
  };
}

function movie(id: string, over: Partial<UnifiedItem> = {}): UnifiedItem {
  return {
    key: `jellyfin:${id}`,
    kind: "movie",
    source: "jellyfin",
    title: id,
    subtitle: null,
    summary: null,
    art: { poster: "", hero: "" },
    lastActivityAt: null,
    addedAt: daysAgo(10),
    progress: { positionSec: 0, durationSec: 100 * 60 },
    playtimeMin: null,
    tags: { genres: [], couchCoop: null, controller: null, sessionLength: null },
    launch: { type: "jellyfin", itemId: id, positionSec: 0 },
    mediaLists: ["unwatchedMovies"],
    ...over,
  };
}

function ctx(over: Partial<PickerContext> = {}): PickerContext {
  return {
    now: NOW,
    utcOffsetMin: 0,
    time: 120,
    mode: "either",
    profile: { id: 1, name: "Solo", size: 1 },
    weights: DEFAULT_WEIGHTS,
    skips: new Map(),
    ...over,
  };
}

const hit = (i: UnifiedItem, c: PickerContext, id: SignalId) => signalsFor(i, c).find((h) => h.id === id);

describe("one test per signal", () => {
  test("inProgress: game played in the last 14 days", () => {
    expect(hit(game("a", { lastActivityAt: daysAgo(4) }), ctx(), "inProgress")).toEqual({
      id: "inProgress",
      score: 40,
      text: "played on Tuesday",
    });
    expect(hit(game("a", { lastActivityAt: daysAgo(15) }), ctx(), "inProgress")).toBeUndefined();
  });

  test("inProgress: Jellyfin resume item, and next-up episode", () => {
    const resume = movie("m", {
      mediaLists: ["resume"],
      lastActivityAt: daysAgo(4),
      progress: { positionSec: 3600, durationSec: 6120 },
    });
    expect(hit(resume, ctx(), "inProgress")?.text).toBe("started on Tuesday");
    const next = movie("e", { kind: "episode", mediaLists: ["nextup"] });
    expect(hit(next, ctx(), "inProgress")?.text).toBe("the next episode");
  });

  test("fitsTime: media remaining runtime is a hard filter", () => {
    const resume = movie("m", {
      mediaLists: ["resume"],
      lastActivityAt: daysAgo(1),
      progress: { positionSec: 3600, durationSec: 6120 },
    });
    expect(hit(resume, ctx({ time: 60 }), "fitsTime")?.text).toBe("42 minutes left");
    expect(
      excludedBecause(movie("long", { progress: { positionSec: 0, durationSec: 7000 } }), ctx({ time: 60 })),
    ).toBe("longer than the time available");
    expect(
      excludedBecause(
        movie("long", { progress: { positionSec: 0, durationSec: 7000 } }),
        ctx({ time: "evening" }),
      ),
    ).toBeNull();
  });

  test("tooLong: games get a soft penalty per session-length step", () => {
    const long = game("l", {}, { sessionLength: "long" });
    expect(hit(long, ctx({ time: 30 }), "tooLong")).toEqual({
      id: "tooLong",
      score: -24,
      text: "usually needs 2 hours",
    });
    expect(hit(long, ctx({ time: 60 }), "tooLong")?.score).toBe(-12);
    expect(hit(long, ctx({ time: 120 }), "tooLong")).toBeUndefined();
    expect(hit(long, ctx({ time: 120 }), "fitsTime")?.text).toBe("fits in 2 hours");
    expect(excludedBecause(long, ctx({ time: 30 }))).toBeNull();
  });

  test("fitsGroup: couch co-op boosts and missing co-op filters when more than one person is here", () => {
    const two = ctx({ profile: { id: 2, name: "Two of us", size: 2 } });
    expect(hit(game("c", {}, { couchCoop: true }), two, "fitsGroup")).toEqual({
      id: "fitsGroup",
      score: 8,
      text: "couch co-op for two",
    });
    expect(excludedBecause(game("s", {}, { couchCoop: false }), two)).toBe("no couch multiplayer");
    expect(excludedBecause(game("s", {}, { couchCoop: false }), ctx())).toBeNull();
    expect(hit(game("c", {}, { couchCoop: true }), ctx(), "fitsGroup")).toBeUndefined();
  });

  test("groupUnknown: unknown multiplayer support is penalised, not filtered, for a group", () => {
    const group = ctx({ profile: { id: 3, name: "Group", size: 4 } });
    const unknown = game("u", {}, { couchCoop: null });
    expect(excludedBecause(unknown, group)).toBeNull();
    expect(hit(unknown, group, "groupUnknown")?.score).toBe(-10);
  });

  test("controllerFriendly / noController", () => {
    expect(hit(game("f"), ctx(), "controllerFriendly")?.score).toBe(4);
    expect(hit(game("p", {}, { controller: "partial" }), ctx(), "noController")?.score).toBe(-15);
    expect(hit(game("n", {}, { controller: "none" }), ctx(), "noController")?.text).toBe(
      "needs keyboard and mouse",
    );
    expect(hit(game("x", {}, { controller: null }), ctx(), "noController")).toBeUndefined();
  });

  test("favourite", () => {
    expect(hit(game("f", { favourite: true }), ctx(), "favourite")).toEqual({
      id: "favourite",
      score: 20,
      text: "a favourite for Solo",
    });
  });

  test("neglected: unplayed for 60 days, never played, or added and never watched", () => {
    expect(hit(game("old", { lastActivityAt: daysAgo(70) }), ctx(), "neglected")?.text).toBe(
      "not played since 25 Jul",
    );
    expect(hit(game("never", { lastActivityAt: null }), ctx(), "neglected")?.text).toBe(
      "installed but never played",
    );
    expect(hit(game("recent", { lastActivityAt: daysAgo(59) }), ctx(), "neglected")).toBeUndefined();
    expect(hit(movie("m", { addedAt: daysAgo(90) }), ctx(), "neglected")?.text).toBe(
      "added on 5 Jul, never watched",
    );
    expect(hit(movie("m", { addedAt: daysAgo(10) }), ctx(), "neglected")).toBeUndefined();
  });

  test("recentlySkipped: a penalty for 7 days", () => {
    const g = game("s");
    expect(hit(g, ctx({ skips: new Map([[g.key, daysAgo(6.9)]]) }), "recentlySkipped")?.score).toBe(-30);
    expect(hit(g, ctx({ skips: new Map([[g.key, daysAgo(7.1)]]) }), "recentlySkipped")).toBeUndefined();
  });

  test("weights come from the context", () => {
    expect(
      hit(
        game("f", { favourite: true }),
        ctx({ weights: { ...DEFAULT_WEIGHTS, favourite: 99 } }),
        "favourite",
      )?.score,
    ).toBe(99);
  });
});

describe("filters, ranking and output", () => {
  test("hidden, excluded and wrong-mode items are out", () => {
    expect(excludedBecause(game("h", { hidden: true }), ctx())).toBe("hidden");
    expect(excludedBecause(game("e"), ctx({ exclude: new Set(["steam:e"]) }))).toBe("already shown");
    expect(excludedBecause(movie("m"), ctx({ mode: "play" }))).toBe("not a game");
    expect(excludedBecause(game("g"), ctx({ mode: "watch" }))).toBe("not media");
    expect(excludedBecause(movie("latest", { mediaLists: ["latestShows"] }), ctx())).not.toBeNull();
  });

  test("ties break on the stable item key", () => {
    const ranked = rankCandidates([game("b"), game("a"), game("c")], ctx());
    expect(ranked.map((r) => r.item.key)).toEqual(["steam:a", "steam:b", "steam:c"]);
  });

  test("reason: top two positive signals, in reading order", () => {
    const r = reasonFor(
      [
        { id: "inProgress", score: 40, text: "started on Tuesday" },
        { id: "fitsTime", score: 6, text: "42 minutes left" },
        { id: "controllerFriendly", score: 4, text: "full controller support" },
        { id: "noController", score: -15, text: "x" },
      ],
      "best",
      "movie",
    );
    expect(r).toBe("42 minutes left, started on Tuesday");
    expect(reasonFor([], "wildcard", "game")).toBe("Something different tonight");
    expect(reasonFor([{ id: "noController", score: -15, text: "x" }], "best", "game")).toBe("Ready to play");
  });

  test("cards: best, finish what you started, wildcard of the other type", () => {
    const items = [
      game("fav", { favourite: true, lastActivityAt: daysAgo(30) }),
      game("started", { lastActivityAt: daysAgo(2) }),
      game("other"),
      movie("film1"),
      movie("film2"),
    ];
    const r = pickTonight(items, ctx({ mode: "either" }));
    expect(r.picks.map((p) => [p.slot, p.item.key])).toEqual([
      ["best", "steam:started"],
      ["runnerUp", "steam:fav"],
      ["wildcard", expect.stringMatching(/^jellyfin:/) as unknown as string],
    ]);
    // Two in-progress games with equal scores: the key breaks the tie for "best"; the other finishes.
    const withResume = pickTonight([...items, game("also", { lastActivityAt: daysAgo(3) })], ctx());
    expect(withResume.picks[0]?.item.key).toBe("steam:also");
    expect(withResume.picks[1]?.slot).toBe("finish");
    expect(withResume.picks[1]?.item.key).toBe("steam:started");
  });

  test("the wildcard is reproducible for a date and profile, and changes with them", () => {
    const items = Array.from({ length: 10 }, (_, i) => movie(`m${i}`));
    const pickW = (c: PickerContext) =>
      pickTonight([game("g", { lastActivityAt: daysAgo(1) }), ...items], c).picks[2]?.item.key;
    expect(pickW(ctx())).toBe(pickW(ctx()));
    const variants = new Set(
      [1, 2, 3, 4, 5, 6].map((id) => pickW(ctx({ profile: { id, name: "p", size: 1 } }))),
    );
    expect(variants.size).toBeGreaterThan(1);
    expect(seededRandom("x")()).toBe(seededRandom("x")());
  });

  test("rerolls never repeat shown items", () => {
    const items = Array.from({ length: 9 }, (_, i) => game(`g${i}`));
    const first = pickTonight(items, ctx({ mode: "play" }));
    const shown = new Set(first.picks.map((p) => p.item.key));
    const second = pickTonight(items, ctx({ mode: "play", exclude: shown, page: 1 }));
    expect(second.picks.length).toBe(3);
    for (const p of second.picks) expect(shown.has(p.item.key)).toBe(false);
    expect(second.remaining).toBe(6);
  });

  test("empty candidates give no picks", () => {
    expect(pickTonight([], ctx()).picks).toEqual([]);
  });
});
