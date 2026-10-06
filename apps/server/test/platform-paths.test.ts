import { describe, expect, test } from "bun:test";
import { testPlatform } from "./helpers.ts";

describe("platform paths", () => {
  test("linux uses XDG defaults", () => {
    const p = testPlatform("linux");
    expect(p.configFile()).toBe("/home/kyle/.config/couch-launcher/config.toml");
    expect(p.dataDir()).toBe("/home/kyle/.local/share/couch-launcher");
  });
  test("linux honours absolute XDG overrides only", () => {
    const p = testPlatform("linux", { env: { XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "relative" } });
    expect(p.configDir()).toBe("/cfg/couch-launcher");
    expect(p.dataDir()).toBe("/home/kyle/.local/share/couch-launcher");
  });
  test("windows uses APPDATA and LOCALAPPDATA", () => {
    const p = testPlatform("windows", {
      env: { APPDATA: "C:\\Users\\kyle\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\kyle\\AppData\\Local" },
    });
    expect(p.configFile()).toBe("C:\\Users\\kyle\\AppData\\Roaming\\couch-launcher\\config.toml");
    expect(p.dataDir()).toBe("C:\\Users\\kyle\\AppData\\Local\\couch-launcher");
  });
  test("windows falls back to the profile folder when the variables are missing", () => {
    const p = testPlatform("windows");
    expect(p.configDir()).toBe("C:\\Users\\kyle\\AppData\\Roaming\\couch-launcher");
  });
});
