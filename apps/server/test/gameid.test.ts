import { expect, test } from "bun:test";
import { crc32, legacyShortcutAppId, shortcutAppId, shortcutGameId } from "../src/adapters/steam/gameid.ts";

test("crc32 matches the standard check value", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});

test("signed shortcuts.vdf app ids become unsigned 32-bit ids", () => {
  expect(shortcutAppId(-1234)).toBe(4294966062);
  expect(shortcutAppId(-1)).toBe(0xffffffff);
  expect(shortcutAppId(123)).toBe(123);
});

test("64-bit rungameid = appid << 32 | 0x02000000", () => {
  // 4294966062 * 2^32 + 0x02000000
  expect(shortcutGameId(4294966062)).toBe("18446738773753462784");
  expect(BigInt(shortcutGameId(4294966062)) >> 32n).toBe(4294966062n);
  expect(BigInt(shortcutGameId(4294966062)) & 0xffffffffn).toBe(0x02000000n);
});

test("legacy ids have the top bit set", () => {
  const id = legacyShortcutAppId('"C:\\Games\\game.exe"', "Game");
  expect(id).toBeGreaterThanOrEqual(0x80000000);
  expect(id).toBe((crc32(new TextEncoder().encode('"C:\\Games\\game.exe"Game')) | 0x80000000) >>> 0);
});
