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

test("one press on a game launches it: Launching state, the command, refresh on return", async ({ page }) => {
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
  expect(await focusedKey(page)).toBe(key);
});

test("Play on the Detail screen launches too", async ({ page }) => {
  await open(page);
  await press(page, "ArrowDown");
  await press(page, "ArrowRight"); // Balatro
  await press(page, "y");
  await press(page, "Enter"); // Details
  expect(await screen(page)).toBe("detail");
  expect(await focusedKey(page)).toBe("act:play");
  await press(page, "Enter");
  await expect(page.getByTestId("launching")).toContainText("Balatro");
  expect((await launches(page)).spawned.at(-1)?.args).toEqual(["steam://rungameid/2379780"]);
});

test("B dismisses the Launching state and focus stays put", async ({ page }) => {
  await open(page);
  await press(page, "ArrowDown");
  const tile = await press(page, "ArrowRight");
  await press(page, "Enter");
  await expect(page.getByTestId("launching")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("launching")).toHaveCount(0);
  expect(await screen(page)).toBe("home");
  expect(await focusedKey(page)).toBe(tile);
});

test("one press on a movie resumes it in Jellyfin Desktop at the resume point", async ({ page }) => {
  await open(page);
  await press(page, "q");
  await settle(page);
  await press(page, "ArrowRight", 2); // Arrival in Continue Watching
  await press(page, "Enter");
  await expect(page.getByTestId("launching")).toContainText("Playing Arrival in Jellyfin Desktop.", {
    timeout: 5000,
  });
  const l = await launches(page);
  expect(l.plays.at(-1)?.query.startPositionTicks).toBe(String(4440 * 10_000_000));
});

test("Play from start on Detail sends position 0", async ({ page }) => {
  await open(page);
  await press(page, "q");
  await settle(page);
  await press(page, "ArrowRight", 2); // Arrival
  await press(page, "y");
  await press(page, "Enter"); // Details
  await expect(page.getByTestId("detail-title")).toHaveText("Arrival");
  await press(page, "ArrowRight"); // Play from start
  expect(await focusedKey(page)).toBe("act:start");
  await press(page, "Enter");
  await expect(page.getByTestId("launching")).toContainText("Playing Arrival", { timeout: 5000 });
  expect((await launches(page)).plays.at(-1)?.query.startPositionTicks).toBe("0");
});

test("launch errors appear as on-screen messages", async ({ page }) => {
  await open(page);
  await press(page, "q");
  await settle(page);
  const severance = await focusedKey(page);
  await page.request.post("/api/mock/jellyfin", { data: { down: true } });
  await press(page, "Enter");
  await expect(page.getByTestId("message")).toContainText("Can't reach Jellyfin");
  await expect(page.getByTestId("message")).toHaveAttribute("data-kind", "error");
  await expect(page.getByTestId("launching")).toHaveCount(0);
  expect(await focusedKey(page)).toBe(severance);
});

test("reloading the page restores the screen and focus", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  await press(page, "ArrowDown");
  await press(page, "ArrowRight", 3);
  const key = await focusedKey(page);
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
  await press(page, "y");
  await press(page, "Enter"); // Details
  await press(page, "ArrowRight");
  const key = await focusedKey(page);
  await page.reload();
  await settle(page);
  expect(await screen(page)).toBe("detail");
  expect(await focusedKey(page)).toBe(key);
  await press(page, "Escape");
  expect(await screen(page)).toBe("home");
});
