import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ciObj, isVdfObject, parseTextVdf, type VdfObject } from "../src/adapters/steam/vdf.ts";
import { REPO_ROOT } from "./helpers.ts";

test("the Steam Input layout parses and binds exactly the keys the UI handles", () => {
  const text = readFileSync(path.join(REPO_ROOT, "steam-input", "couch_launcher_keyboard.vdf"), "utf8");
  const v = parseTextVdf(text);
  const root = ciObj(v, "controller_mappings") as VdfObject;
  expect(root.version).toBe("3");
  // Duplicate "group" keys merge in our parser, so collect bindings from the raw text instead.
  const bindings = [...text.matchAll(/"binding"\s+"key_press ([A-Z_]+),/g)].map((m) => m[1]);
  expect(new Set(bindings)).toEqual(
    new Set([
      "RETURN",
      "ESCAPE",
      "X",
      "Y",
      "UP_ARROW",
      "DOWN_ARROW",
      "LEFT_ARROW",
      "RIGHT_ARROW",
      "S",
      "Q",
      "E",
    ]),
  );
  expect(text).not.toMatch(/button_steam|guide/i);
  expect(isVdfObject(root.preset)).toBe(true);
});
