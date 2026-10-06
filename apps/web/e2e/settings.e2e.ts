import { expect, test } from "@playwright/test";
import { focusedKey, open, press, reset, screen, settle } from "./helpers.ts";

test.beforeEach(async ({ page }) => reset(page));

test("Settings shows source health and is fully usable by controller", async ({ page }) => {
  await open(page);
  await press(page, "s");
  expect(await screen(page)).toBe("settings");
  await settle(page);
  await expect(page.getByTestId("status-steam")).toContainText("12 games, 4 shortcuts in 2 libraries");
  await expect(page.getByTestId("status-jellyfin")).toContainText("dxp2800 10.11.2");
  expect(await focusedKey(page)).toBe("set:rescan");
  await press(page, "Enter");
  await expect(page.getByTestId("message")).toContainText("Library rescanned");

  await press(page, "ArrowRight", 2); // A+
  await press(page, "Enter");
  await expect(page.getByTestId("ui-scale")).toHaveText("105%");
  const fs = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(Number.parseFloat(fs)).toBeCloseTo(16 * 1.05, 1);
  await press(page, "ArrowLeft"); // A−
  await press(page, "Enter");
  await expect(page.getByTestId("ui-scale")).toHaveText("100%");
  await page.reload(); // pagehide flushes the UI state immediately

  await settle(page);
  expect(await screen(page)).toBe("settings");
});

test("hidden items can be brought back from Settings", async ({ page }) => {
  await page.request.post("/api/prefs", { data: { key: "steam:620", hidden: true } });
  await open(page);
  await press(page, "s");
  await settle(page);
  await press(page, "ArrowDown");
  expect(await focusedKey(page)).toBe("hidden:steam:620");
  await press(page, "Enter");
  await expect(page.getByTestId("message")).toContainText("Portal 2 is visible again");
  await expect(page.locator("[data-focus-key='hidden:steam:620']")).toHaveCount(0);
  expect(await focusedKey(page)).toBe("set:rescan");
});

test("Jellyfin outage shows in Settings", async ({ page }) => {
  await page.request.post("/api/mock/jellyfin", { data: { down: true } });
  await open(page);
  await press(page, "s");
  await settle(page);
  await expect(page.getByTestId("status-jellyfin")).toHaveAttribute("data-state", "unreachable");
  await expect(page.getByTestId("status-jellyfin")).toContainText("Can't reach it");
});
