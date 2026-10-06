import { expect, test } from "@playwright/test";

test("the UI loads from the service", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
