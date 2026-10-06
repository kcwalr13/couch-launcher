import { expect, test } from "@playwright/test";
import { focusedKey, open, press, reset, screen, settle } from "./helpers.ts";

test.beforeEach(async ({ page }) => reset(page));

test("three questions, three picks with reasons, in at most five presses", async ({ page }) => {
  await open(page);
  expect(await focusedKey(page)).toBe("btn:tonight");
  await press(page, "Enter"); // 1: open Tonight
  expect(await screen(page)).toBe("tonight");
  await expect(page.getByTestId("question-1")).toBeVisible();
  expect(await focusedKey(page)).toBe("time:60"); // preselected default
  await press(page, "Enter"); // 2: one hour
  expect(await focusedKey(page)).toBe("who:1");
  await press(page, "Enter"); // 3: Solo
  expect(await focusedKey(page)).toBe("mode:either");
  await press(page, "Enter"); // 4: either
  await expect(page.getByTestId("tonight-results")).toBeVisible();
  await settle(page);
  const cards = page.locator("[data-testid^='pick-']").filter({ has: page.getByTestId("pick-reason") });
  await expect(cards).toHaveCount(3);
  for (const r of await page.getByTestId("pick-reason").allInnerTexts()) expect(r.length).toBeGreaterThan(5);
  expect((await focusedKey(page)).startsWith("pick:")).toBe(true);
  await press(page, "Enter"); // 5: start the best pick
  await expect(page.getByTestId("launching")).toBeVisible();
});

test("reroll shows three new picks; Back steps through the questions", async ({ page }) => {
  await open(page);
  await press(page, "x");
  await press(page, "Enter", 3);
  await settle(page);
  const first = await page
    .locator("[data-focus-key^='pick:']")
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.focusKey));
  expect(first.length).toBe(3);
  await press(page, "ArrowDown");
  expect(await focusedKey(page)).toBe("btn:reroll");
  await press(page, "Enter");
  await expect(page.getByTestId("tonight-results")).toContainText("set 2");
  await settle(page);
  const second = await page
    .locator("[data-focus-key^='pick:']")
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.focusKey));
  expect(second.length).toBeGreaterThan(0);
  for (const k of second) expect(first).not.toContain(k);
  await press(page, "Escape");
  await expect(page.getByTestId("question-3")).toBeVisible();
  await press(page, "Escape");
  await expect(page.getByTestId("question-2")).toBeVisible();
  await press(page, "Escape");
  await press(page, "Escape");
  expect(await screen(page)).toBe("home");
});

test("the last answers are preselected next time", async ({ page }) => {
  await open(page);
  await press(page, "x");
  await press(page, "ArrowRight"); // from "1 hour" to "2 hours"
  await press(page, "Enter");
  await press(page, "ArrowRight"); // Two of us
  await press(page, "Enter");
  await press(page, "ArrowLeft", 2); // Play
  await press(page, "Enter");
  await expect(page.getByTestId("tonight-results")).toContainText("2 hours · Two of us · Play");
  await press(page, "Escape", 4);
  expect(await screen(page)).toBe("home");
  await expect(page.getByTestId("profile-chip")).toContainText("Two of us");
  await press(page, "x");
  expect(await focusedKey(page)).toBe("time:120");
  await press(page, "Enter");
  expect(await focusedKey(page)).toBe("who:2");
  await press(page, "Enter");
  expect(await focusedKey(page)).toBe("mode:play");
});
