import { expect, test } from "bun:test";
import { REPEAT_DELAY_MS, REPEAT_INTERVAL_MS, Repeater, type Timers } from "./repeat.ts";

/** A fake clock driving setTimeout / setInterval. */
function fakeTimers() {
  let now = 0;
  let id = 0;
  const jobs = new Map<number, { at: number; fn: () => void; every?: number }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      jobs.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (i) => jobs.delete(i as number),
    setInterval: (fn, ms) => {
      jobs.set(++id, { at: now + ms, fn, every: ms });
      return id;
    },
    clearInterval: (i) => jobs.delete(i as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [k, j] = next;
      now = j.at;
      if (j.every) j.at += j.every;
      else jobs.delete(k);
      j.fn();
    }
    now = end;
  };
  return { timers, advance };
}

test("fires once, then repeats after 400 ms at 8 per second, until released", () => {
  const { timers, advance } = fakeTimers();
  const fired: string[] = [];
  const r = new Repeater<string>((v) => fired.push(v), timers);
  r.press("down");
  expect(fired.length).toBe(1);
  advance(REPEAT_DELAY_MS - 1);
  expect(fired.length).toBe(1);
  advance(1 + REPEAT_INTERVAL_MS);
  expect(fired.length).toBe(2);
  advance(1000);
  expect(fired.length).toBe(10);
  r.release();
  advance(1000);
  expect(fired.length).toBe(10);
});

test("releasing a different value does not stop the held one", () => {
  const { timers, advance } = fakeTimers();
  const fired: string[] = [];
  const r = new Repeater<string>((v) => fired.push(v), timers);
  r.press("left");
  r.release("up");
  advance(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS);
  expect(fired).toEqual(["left", "left"]);
  r.press("right");
  advance(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS);
  expect(fired.slice(2)).toEqual(["right", "right"]);
});
