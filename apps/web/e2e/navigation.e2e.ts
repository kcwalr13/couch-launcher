import { expect, test } from "@playwright/test";
import { allFocusableKeys, focusedKey, open, press, reset, screen, settle, visitAll } from "./helpers.ts";

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("Home: Tonight has default focus", async ({ page }) => {
  await open(page);
  expect(await screen(page)).toBe("home");
  expect(await focusedKey(page)).toBe("btn:tonight");
});

test("every tile on Home, Play and Watch is reachable by keys alone", async ({ page }) => {
  await open(page);
  expect(await visitAll(page)).toEqual(await allFocusableKeys(page));

  await press(page, "e");
  expect(await screen(page)).toBe("play");
  await settle(page);
  const playKeys = await allFocusableKeys(page);
  expect([...playKeys].filter((k) => k.startsWith("tile:")).length).toBe(14);
  expect(await visitAll(page)).toEqual(playKeys);

  await press(page, "e");
  expect(await screen(page)).toBe("watch");
  await settle(page);
  const watchKeys = await allFocusableKeys(page);
  expect(watchKeys.size).toBe(15);
  expect(await visitAll(page)).toEqual(watchKeys);
});

test("every screen is reachable by keys alone", async ({ page }) => {
  await open(page);
  await press(page, "ArrowRight"); // Play button
  await press(page, "Enter");
  expect(await screen(page)).toBe("play");
  await press(page, "Escape");
  expect(await screen(page)).toBe("home");
  expect(await focusedKey(page)).toBe("btn:play");
  await press(page, "ArrowRight");
  await press(page, "Enter");
  expect(await screen(page)).toBe("watch");
  await press(page, "Escape");
  await press(page, "ArrowDown"); // from the Watch button (column 3): lands on the 3rd Continue tile
  await press(page, "Enter");
  expect(await screen(page)).toBe("detail");
  await expect(page.getByTestId("detail-title")).toHaveText("Paddington 2");
  await press(page, "Escape");
  await press(page, "x");
  expect(await screen(page)).toBe("tonight");
  await press(page, "Escape");
  await press(page, "s");
  expect(await screen(page)).toBe("settings");
  await press(page, "Escape");
  await press(page, "ArrowUp");
  await press(page, "ArrowRight", 3);
  expect(await focusedKey(page)).toBe("btn:profile");
  await press(page, "Enter");
  expect(await screen(page)).toBe("profiles");
  await press(page, "Escape");
  expect(await screen(page)).toBe("home");
});

test("Back restores the previous focus", async ({ page }) => {
  await open(page);
  await press(page, "ArrowDown");
  const target = await press(page, "ArrowRight", 3);
  await press(page, "Enter");
  expect(await screen(page)).toBe("detail");
  await press(page, "Escape");
  expect(await focusedKey(page)).toBe(target);
});

test("LB and RB switch sections and remember each section's focus", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  await press(page, "ArrowRight", 2);
  const inPlay = await focusedKey(page);
  await press(page, "e");
  expect(await screen(page)).toBe("watch");
  await press(page, "q");
  expect(await screen(page)).toBe("play");
  expect(await focusedKey(page)).toBe(inPlay);
  await press(page, "q");
  expect(await screen(page)).toBe("home");
  await press(page, "q");
  expect(await screen(page)).toBe("watch");
});

test("up and down remember the column; rows do not wrap", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  const first = await focusedKey(page);
  expect(first.startsWith("tile:")).toBe(true);
  await press(page, "ArrowRight", 4);
  const col4 = await focusedKey(page);
  await press(page, "ArrowDown");
  await press(page, "ArrowDown"); // last row has 2 tiles: lands on its last one
  await press(page, "ArrowUp");
  await press(page, "ArrowUp");
  expect(await focusedKey(page)).toBe(col4);
  await press(page, "ArrowRight", 5);
  const end = await focusedKey(page);
  await press(page, "ArrowRight");
  expect(await focusedKey(page)).toBe(end);
});

test("holding a direction repeats after 400 ms at about 8 steps per second", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  await press(page, "ArrowUp"); // controls row: 5 chips
  await press(page, "ArrowDown"); // first grid row (6 tiles)
  const order = await page.$$eval("[data-focus-key^='tile:']", (els) =>
    els.map((e) => (e as HTMLElement).dataset.focusKey),
  );
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  const early = order.indexOf(await focusedKey(page));
  await page.waitForTimeout(400); // 650 ms held: 1 + 2 repeats
  const later = order.indexOf(await focusedKey(page));
  await page.keyboard.up("ArrowRight");
  expect(early).toBe(1);
  expect(later).toBeGreaterThanOrEqual(2);
  expect(later).toBeLessThanOrEqual(4);
});

test("input to visible focus change takes under 100 ms", async ({ page }) => {
  await open(page);
  await press(page, "ArrowDown");
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const before = document.activeElement;
          const t0 = performance.now();
          const obs = new MutationObserver(() => {
            if (document.activeElement !== before) {
              obs.disconnect();
              requestAnimationFrame(() => resolve(performance.now() - t0));
            }
          });
          obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-focused"] });
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
          window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
        }),
    );
    samples.push(ms);
  }
  expect(Math.max(...samples)).toBeLessThan(100);
});

test("missing artwork shows a text fallback", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  const tile = page.locator("[data-item-key='steam:1966720']");
  await expect(tile.locator("[data-fallback='true']")).toContainText("Lethal Company");
});

test("Watch: unreachable server with nothing cached shows an empty state, and focus is kept", async ({
  page,
}) => {
  await page.request.post("/api/mock/reset", { data: { clearCache: true, down: true } });
  await open(page);
  await press(page, "e");
  await press(page, "e");
  expect(await screen(page)).toBe("watch");
  await expect(page.getByTestId("watch-banner")).toContainText("Nothing has been saved yet");
  expect(await focusedKey(page)).toBe("btn:retry");
  for (const id of ["continue", "nextup", "movies", "shows"])
    await expect(page.getByTestId(`empty-${id}`)).toBeVisible();
  // Server comes back; "Try again" loads the rows.
  await page.request.post("/api/mock/jellyfin", { data: { down: false } });
  await press(page, "Enter");
  await expect(page.getByTestId("watch-banner")).toHaveCount(0);
  expect((await focusedKey(page)).startsWith("tile:continue:")).toBe(true);
});

test("Watch: unreachable server with a cache shows saved items", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await press(page, "e");
  await settle(page);
  await page.request.post("/api/mock/jellyfin", { data: { down: true } });
  await press(page, "q");
  await press(page, "e"); // remount Watch
  await expect(page.getByTestId("watch-banner")).toContainText("Showing what was saved last time");
  expect((await focusedKey(page)).startsWith("tile:")).toBe(true);
});
