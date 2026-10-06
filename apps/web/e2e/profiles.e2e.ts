import { expect, type Page, test } from "@playwright/test";
import { focusedKey, open, press, reset, screen, settle } from "./helpers.ts";

test.beforeEach(async ({ page }) => reset(page));

async function switchTo(page: Page, name: string) {
  await press(page, "ArrowUp", 3);
  await press(page, "ArrowRight", 3);
  expect(await focusedKey(page)).toBe("btn:profile");
  await press(page, "Enter");
  expect(await screen(page)).toBe("profiles");
  await settle(page);
  for (let i = 0; i < 3; i++) {
    if ((await page.locator("[data-focused='true']").innerText()).includes(name)) break;
    await press(page, "ArrowRight");
  }
  await press(page, "ArrowLeft", 3);
  for (let i = 0; i < 3; i++) {
    if ((await page.locator("main [data-focused='true']").innerText()).includes(name)) break;
    await press(page, "ArrowRight");
  }
  await press(page, "Enter");
  expect(await screen(page)).toBe("home");
  await expect(page.getByTestId("profile-chip")).toContainText(name);
}

test("favourites are per profile and survive a reload", async ({ page }) => {
  await open(page);
  await press(page, "ArrowDown");
  await press(page, "ArrowRight"); // Balatro
  const tile = page.locator("[data-item-key='steam:2379780']");
  await press(page, "y");
  await expect(page.getByTestId("options")).toBeVisible();
  await press(page, "Enter"); // Add to favourites
  await press(page, "Escape");
  await expect(tile.getByLabel("Favourite")).toBeVisible();

  await switchTo(page, "Two of us");
  await settle(page);
  await expect(page.locator("[data-item-key='steam:2379780']").getByLabel("Favourite")).toHaveCount(0);

  await switchTo(page, "Solo");
  await page.reload();
  await settle(page);
  await expect(page.locator("[data-item-key='steam:2379780']").getByLabel("Favourite")).toBeVisible();
});

test("hiding from Detail removes the item for this profile only", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  await press(page, "Enter"); // Balatro detail
  await expect(page.getByTestId("detail-title")).toHaveText("Balatro");
  await press(page, "ArrowRight", 2); // Hide
  expect(await focusedKey(page)).toBe("act:hide");
  await press(page, "Enter");
  await expect(page.getByTestId("message")).toContainText("Balatro is hidden for Solo");
  await press(page, "Escape");
  await settle(page);
  await expect(page.locator("[data-item-key='steam:2379780']")).toHaveCount(0);
  await expect(page.getByTestId("game-count")).toHaveText("13 games");

  await press(page, "q"); // Home
  await switchTo(page, "Group");
  await press(page, "e");
  await settle(page);
  await expect(page.locator("[data-item-key='steam:2379780']")).toHaveCount(1);
});

test("session length override from the Y menu shows on Detail", async ({ page }) => {
  await open(page);
  await press(page, "e");
  await settle(page);
  await press(page, "ArrowRight"); // Hades
  await press(page, "y");
  await press(page, "ArrowDown", 2); // session length row
  await press(page, "ArrowRight"); // Short
  await press(page, "Enter");
  await expect(page.getByTestId("options")).toContainText("Session length: Short");
  await press(page, "Escape");
  await press(page, "Enter");
  await expect(page.getByTestId("detail-title")).toHaveText("Hades");
  await expect(page.getByTestId("detail")).toContainText("Short sessions (set by you)");
});
