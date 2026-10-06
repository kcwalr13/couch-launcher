import { expect, test } from "@playwright/test";
import { focusedKey, open, reset, screen } from "./helpers.ts";

/**
 * A Gamepad API shim: navigator.getGamepads() returns one standard-mapped pad whose buttons
 * and axes the test sets through window.__pad. Exercises the polling path end to end.
 */
const SHIM = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = {
    id: "Test pad (STANDARD GAMEPAD)",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test shim on window
  (window as any).__pad = {
    set(i: number, down: boolean) {
      buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp++;
    },
    axis(i: number, v: number) {
      pad.axes[i] = v;
      pad.timestamp++;
    },
  };
  Object.defineProperty(navigator, "getGamepads", {
    value: () => [pad, null, null, null],
    configurable: true,
  });
};

async function tap(page: import("@playwright/test").Page, button: number) {
  await page.evaluate(
    (b) => (window as unknown as { __pad: { set: (i: number, d: boolean) => void } }).__pad.set(b, true),
    button,
  );
  await page.waitForTimeout(80);
  await page.evaluate(
    (b) => (window as unknown as { __pad: { set: (i: number, d: boolean) => void } }).__pad.set(b, false),
    button,
  );
  await page.waitForTimeout(80);
}

test.beforeEach(async ({ page }) => {
  await reset(page);
  await page.addInitScript(SHIM);
});

test("D-pad, A, B, LB/RB, X and Start work through the Gamepad API", async ({ page }) => {
  await open(page);
  await tap(page, 13); // D-pad down
  expect((await focusedKey(page)).startsWith("tile:")).toBe(true);
  await tap(page, 15); // right
  const second = await focusedKey(page);
  await tap(page, 0); // A
  expect(await screen(page)).toBe("detail");
  await tap(page, 1); // B
  expect(await screen(page)).toBe("home");
  expect(await focusedKey(page)).toBe(second);
  await tap(page, 5); // RB
  expect(await screen(page)).toBe("play");
  await tap(page, 4); // LB
  expect(await screen(page)).toBe("home");
  await tap(page, 2); // X
  expect(await screen(page)).toBe("tonight");
  await tap(page, 1);
  await tap(page, 9); // Start
  expect(await screen(page)).toBe("settings");
});

test("the left stick moves focus and the guide button is ignored", async ({ page }) => {
  await open(page);
  await page.evaluate(() =>
    (window as unknown as { __pad: { axis: (i: number, v: number) => void } }).__pad.axis(1, 0.9),
  );
  await page.waitForTimeout(80);
  await page.evaluate(() =>
    (window as unknown as { __pad: { axis: (i: number, v: number) => void } }).__pad.axis(1, 0),
  );
  await page.waitForTimeout(80);
  expect((await focusedKey(page)).startsWith("tile:")).toBe(true);
  const before = await focusedKey(page);
  await tap(page, 16); // guide / Steam button: reserved, never bound
  expect(await focusedKey(page)).toBe(before);
  expect(await screen(page)).toBe("home");
});

test("a held D-pad direction repeats", async ({ page }) => {
  await open(page);
  await page.keyboard.press("e");
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  const order = await page.$$eval("[data-focus-key^='tile:']", (els) =>
    els.map((e) => (e as HTMLElement).dataset.focusKey),
  );
  await page.evaluate(() =>
    (window as unknown as { __pad: { set: (i: number, d: boolean) => void } }).__pad.set(15, true),
  );
  await page.waitForTimeout(700);
  await page.evaluate(() =>
    (window as unknown as { __pad: { set: (i: number, d: boolean) => void } }).__pad.set(15, false),
  );
  const idx = order.indexOf(await focusedKey(page));
  expect(idx).toBeGreaterThanOrEqual(3);
  expect(idx).toBeLessThanOrEqual(5);
});
