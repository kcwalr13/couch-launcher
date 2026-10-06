import { expect, type Page, test } from "@playwright/test";
import { focusedKey, open, press, reset, screen, settle } from "./helpers.ts";

test.beforeEach(async ({ page }) => reset(page));

async function launches(page: Page) {
  return (await (await page.request.get("/api/mock/launches")).json()) as {
    spawned: { cmd: string; args: string[] }[];
    plays: { sessionId: string; query: Record<string, string> }[];
  };
}

async function becomeVisible(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("launching a game shows the Launching state, runs the command, and refreshes on return", async ({
  page,
}) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  // Portal 2 (never played) is the first tile of the third grid row in "recent" order.
  const key = (await page
    .locator("[data-item-key='steam:620'] [data-focus-key]")
    .getAttribute("data-focus-key")) as string;
  await press(page, "ArrowDown", 2);
  await press(page, "ArrowLeft", 5);
  expect(await focusedKey(page)).toBe(key);
  await press(page, "Enter");
  expect(await screen(page)).toBe("detail");
  await press(page, "Enter"); // Play
  await expect(page.getByTestId("launching")).toContainText("Portal 2");
  await expect(page.getByTestId("launching")).toContainText("Steam is starting Portal 2.");
  const l = await launches(page);
  const proc = process.platform === "win32" ? "steam.exe" : "steam";
  expect(l.spawned.at(-1)?.cmd.endsWith(proc)).toBe(true);
  expect(l.spawned.at(-1)?.args).toEqual(["steam://rungameid/620"]);
  const before = await page.evaluate(() => performance.getEntriesByType("resource").length);
  await becomeVisible(page);
  await expect(page.getByTestId("launching")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByType("resource").length))
    .toBeGreaterThan(before);
  expect(await focusedKey(page)).toBe("act:play");
});

test("B dismisses the Launching state", async ({ page }) => {
  await open(page);
  await press(page, "ArrowDown", 1);
  await press(page, "ArrowRight");
  await press(page, "Enter");
  await press(page, "Enter");
  await expect(page.getByTestId("launching")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("launching")).toHaveCount(0);
  expect(await screen(page)).toBe("detail");
});

test("resuming a movie hands off to Jellyfin Desktop at the resume point", async ({ page }) => {
  await open(page);
  await press(page, "q");
  await settle(page);
  await press(page, "ArrowRight", 2); // Arrival in Continue Watching
  await press(page, "Enter");
  await expect(page.getByTestId("detail-title")).toHaveText("Arrival");
  await press(page, "Enter"); // Resume
  await expect(page.getByTestId("launching")).toContainText("Playing Arrival in Jellyfin Desktop.", {
    timeout: 5000,
  });
  const l = await launches(page);
  expect(l.plays.at(-1)?.query.startPositionTicks).toBe(String(4440 * 10_000_000));
});

test("launch errors appear as on-screen messages", async ({ page }) => {
  await open(page);
  await press(page, "q");
  await settle(page);
  await press(page, "Enter"); // Severance
  await expect(page.getByTestId("detail")).toBeVisible();
  await page.request.post("/api/mock/jellyfin", { data: { down: true } });
  await press(page, "Enter");
  await expect(page.getByTestId("message")).toContainText("Can't reach Jellyfin");
  await expect(page.getByTestId("message")).toHaveAttribute("data-kind", "error");
  await expect(page.getByTestId("launching")).toHaveCount(0);
  expect(await focusedKey(page)).toBe("act:play");
});

test("reloading the page restores the screen and focus", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  await press(page, "ArrowDown");
  await press(page, "ArrowRight", 3);
  const key = await focusedKey(page);
  await page.waitForTimeout(400); // debounce
  await page.reload();
  await settle(page);
  expect(await screen(page)).toBe("play");
  expect(await focusedKey(page)).toBe(key);
  // Column memory survives the reload too.
  await press(page, "ArrowDown");
  await press(page, "ArrowUp");
  expect(await focusedKey(page)).toBe(key);
});

test("reloading on a Detail screen restores it, and Back goes Home", async ({ page }) => {
  await open(page);
  await press(page, "ArrowDown");
  await press(page, "ArrowRight", 2);
  await press(page, "Enter");
  await press(page, "ArrowRight");
  const key = await focusedKey(page);
  await page.waitForTimeout(400);
  await page.reload();
  await settle(page);
  expect(await screen(page)).toBe("detail");
  expect(await focusedKey(page)).toBe(key);
  await press(page, "Escape");
  expect(await screen(page)).toBe("home");
});
