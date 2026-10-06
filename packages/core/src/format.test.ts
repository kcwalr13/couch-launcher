import { expect, test } from "bun:test";
import { durationText, playtimeText, relativeDay, remainingMinutes } from "./format.ts";

const now = new Date("2026-10-03T19:00:00Z"); // Saturday

test("relative days", () => {
  expect(relativeDay("2026-10-03T08:00:00Z", now)).toBe("today");
  expect(relativeDay("2026-10-02T23:59:00Z", now)).toBe("yesterday");
  expect(relativeDay("2026-09-29T17:00:00Z", now)).toBe("on Tuesday");
  expect(relativeDay("2026-09-03T17:00:00Z", now)).toBe("on 3 Sep");
  expect(relativeDay("2025-12-24T17:00:00Z", now)).toBe("on 24 Dec 2025");
  expect(relativeDay(null, now)).toBeNull();
  expect(relativeDay("garbage", now)).toBeNull();
});

test("relative days respect the UTC offset", () => {
  // 23:30 UTC Friday is 01:30 Saturday in UTC+2: "today" there.
  expect(relativeDay("2026-10-02T23:30:00Z", now, 120)).toBe("today");
  expect(relativeDay("2026-10-02T23:30:00Z", now, 0)).toBe("yesterday");
});

test("durations", () => {
  expect(durationText(42)).toBe("42 minutes");
  expect(durationText(60)).toBe("1 hour");
  expect(durationText(61)).toBe("1 hour 1 minute");
  expect(durationText(125)).toBe("2 hours 5 minutes");
  expect(playtimeText(2140)).toBe("36 h played");
  expect(playtimeText(45)).toBe("45 min played");
  expect(playtimeText(0)).toBeNull();
  expect(remainingMinutes({ positionSec: 4440, durationSec: 6960 })).toBe(42);
  expect(remainingMinutes(null)).toBeNull();
});
