import { expect, type Page, test } from "@playwright/test";
import { open, press, reset, settle } from "./helpers.ts";
import { tenFootAudit } from "./tenfoot.ts";

const SIZES = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "4k", width: 3840, height: 2160 },
];

const SCREENS: { name: string; go: (p: Page) => Promise<void> }[] = [
  { name: "home", go: async () => {} },
  { name: "home-continue", go: async (p) => void (await press(p, "ArrowDown")) },
  {
    name: "play",
    go: async (p) => {
      await press(p, "e");
      await settle(p);
      await press(p, "ArrowRight");
    },
  },
  {
    name: "play-fallback",
    go: async (p) => {
      await press(p, "e");
      await settle(p);
      await press(p, "ArrowDown");
      await press(p, "ArrowRight", 5);
    },
  },
  {
    name: "watch",
    go: async (p) => {
      await press(p, "q");
      await settle(p);
      await press(p, "ArrowDown");
    },
  },
  {
    name: "detail-game",
    go: async (p) => {
      await press(p, "ArrowDown");
      await press(p, "ArrowRight");
      await press(p, "Enter");
      await settle(p);
    },
  },
  {
    name: "detail-media",
    go: async (p) => {
      await press(p, "ArrowDown");
      await press(p, "Enter");
      await settle(p);
    },
  },
  {
    name: "tonight-question",
    go: async (p) => {
      await press(p, "x");
      await settle(p);
    },
  },
  {
    name: "tonight-results",
    go: async (p) => {
      await press(p, "x");
      await press(p, "Enter", 3);
      await settle(p);
    },
  },
  {
    name: "settings",
    go: async (p) => {
      await p.request.post("/api/prefs", { data: { key: "steam:620", hidden: true } });
      await press(p, "s");
      await settle(p);
    },
  },
  {
    name: "profiles",
    go: async (p) => {
      await press(p, "ArrowRight", 3);
      await press(p, "Enter");
      await settle(p);
    },
  },
  {
    name: "options",
    go: async (p) => {
      await press(p, "ArrowDown");
      await press(p, "ArrowRight");
      await press(p, "y");
    },
  },
];

for (const size of SIZES) {
  test.describe(`ten-foot rules at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    test.beforeEach(async ({ page }) => reset(page));
    for (const s of SCREENS) {
      test(s.name, async ({ page }) => {
        await open(page);
        await s.go(page);
        await settle(page);
        await page.waitForTimeout(150); // let the focus transition finish
        await page.screenshot({ path: `apps/web/test-results/screens/${s.name}-${size.name}.png` });
        const audit = await tenFootAudit(page);
        expect(audit.checkedText).toBeGreaterThan(5);
        expect(audit.violations).toEqual([]);
        expect(audit.minFontPx).toBeGreaterThanOrEqual(27.5);
        expect(audit.minContrast).toBeGreaterThanOrEqual(7);
      });
    }
  });
}
