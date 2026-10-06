import { expect, type Page } from "@playwright/test";

export async function reset(page: Page) {
  const r = await page.request.post("/api/mock/reset");
  expect(r.ok()).toBe(true);
}

export async function open(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator("[data-focused='true']").first()).toBeVisible();
  await settle(page);
}

/** Wait for data loads to finish (no skeletons) and one frame. */
export async function settle(page: Page) {
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

const readFocused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el?.dataset.focused !== "true") return null;
    return el?.dataset.focusKey ?? null;
  });

/**
 * The key of the element that has DOM focus, asserting it is the focused tile. A screen that is
 * still loading its data gets up to one second (local fixtures load in milliseconds).
 */
export async function focusedKey(page: Page): Promise<string> {
  let k = await readFocused(page);
  for (let i = 0; i < 50 && k === null; i++) {
    await page.waitForTimeout(20);
    k = await readFocused(page);
  }
  expect(k, "a focused element must exist after every input").not.toBeNull();
  return k as string;
}

/** Press a key and assert that a focused element exists afterwards. */
export async function press(page: Page, key: string, times = 1): Promise<string> {
  let k = "";
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    k = await focusedKey(page);
  }
  return k;
}

export async function screen(page: Page): Promise<string> {
  return (await page.locator("[data-screen]").getAttribute("data-screen")) as string;
}

/** Walk every row and column of the current screen by keys alone; return every key focused. */
export async function visitAll(page: Page): Promise<Set<string>> {
  const seen = new Set<string>();
  // Go to the top-left first.
  for (let i = 0; i < 20; i++) {
    const before = await focusedKey(page);
    await press(page, "ArrowUp");
    if ((await focusedKey(page)) === before) break;
  }
  for (let i = 0; i < 40; i++) await press(page, "ArrowLeft");
  for (let row = 0; row < 40; row++) {
    seen.add(await focusedKey(page));
    for (let i = 0; i < 60; i++) {
      const before = await focusedKey(page);
      const after = await press(page, "ArrowRight");
      seen.add(after);
      if (after === before) break;
    }
    for (let i = 0; i < 60; i++) {
      const before = await focusedKey(page);
      if ((await press(page, "ArrowLeft")) === before) break;
    }
    const before = await focusedKey(page);
    if ((await press(page, "ArrowDown")) === before) break;
  }
  return seen;
}

export async function allFocusableKeys(page: Page): Promise<Set<string>> {
  const keys = await page.$$eval("main [data-focus-key]", (els) =>
    els.map((e) => (e as HTMLElement).dataset.focusKey as string),
  );
  return new Set(keys);
}
