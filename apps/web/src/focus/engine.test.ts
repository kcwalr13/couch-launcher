import { describe, expect, test } from "bun:test";
import { type FocusRow, type FocusState, gridRows, move, resolve } from "./engine.ts";

const rows: FocusRow[] = [
  { id: "top", keys: ["a", "b", "c"] },
  { id: "empty", keys: [] },
  { id: "mid", keys: ["d", "e", "f", "g", "h"] },
  { id: "short", keys: ["i"] },
];

describe("focus engine", () => {
  test("left and right stop at the ends (no wrap)", () => {
    expect(move(rows, { key: "a", col: 0 }, "left")).toEqual({ key: "a", col: 0 });
    expect(move(rows, { key: "a", col: 0 }, "right")).toEqual({ key: "b", col: 1 });
    expect(move(rows, { key: "c", col: 2 }, "right")).toEqual({ key: "c", col: 2 });
  });

  test("down skips empty rows and keeps the column", () => {
    expect(move(rows, { key: "c", col: 2 }, "down")).toEqual({ key: "f", col: 2 });
  });

  test("the remembered column survives a short row", () => {
    let s: FocusState = { key: "h", col: 4 };
    s = move(rows, s, "down");
    expect(s).toEqual({ key: "i", col: 4 });
    s = move(rows, s, "up");
    expect(s).toEqual({ key: "h", col: 4 });
    s = move(rows, s, "up");
    expect(s).toEqual({ key: "c", col: 4 });
  });

  test("up from the top and down from the bottom stay put", () => {
    expect(move(rows, { key: "b", col: 1 }, "up")).toEqual({ key: "b", col: 1 });
    expect(move(rows, { key: "i", col: 0 }, "down")).toEqual({ key: "i", col: 0 });
  });

  test("a stale key resolves to the fallback, then the first key", () => {
    expect(resolve(rows, { key: "gone", col: 3 }, "e")).toEqual({ key: "e", col: 1 });
    expect(resolve(rows, { key: "gone", col: 3 })).toEqual({ key: "a", col: 0 });
    expect(move(rows, { key: "gone", col: 0 }, "down")).toEqual({ key: "a", col: 0 });
    expect(resolve([], { key: "x", col: 0 })).toEqual({ key: null, col: 0 });
  });

  test("every move from every key lands on a valid key (focus never lost)", () => {
    const all = rows.flatMap((r) => r.keys);
    for (const k of all)
      for (const d of ["up", "down", "left", "right"] as const)
        for (let col = 0; col < 6; col++) expect(all).toContain(move(rows, { key: k, col }, d).key as string);
  });

  test("an unknown column (-1) is taken from the key's position", () => {
    expect(resolve(rows, { key: "g", col: -1 })).toEqual({ key: "g", col: 3 });
  });

  test("grid rows", () => {
    expect(gridRows("g", ["1", "2", "3", "4", "5"], 2).map((r) => r.keys)).toEqual([
      ["1", "2"],
      ["3", "4"],
      ["5"],
    ]);
  });
});
