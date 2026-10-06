import { describe, expect, test } from "bun:test";
import { splitCommandLine } from "../src/platform/cmdline.ts";
import { parseRegQuery } from "../src/platform/windows.ts";
import { memFs, recordingProc, testPlatform } from "./helpers.ts";

const REG_OUT = `
HKEY_CURRENT_USER\\Software\\Valve\\Steam
    SteamPath    REG_SZ    c:/program files (x86)/steam

`;

describe("windows: Steam root discovery", () => {
  test("parses reg query output", () => {
    expect(parseRegQuery(REG_OUT, "SteamPath")).toBe("c:/program files (x86)/steam");
    expect(parseRegQuery(REG_OUT, "Other")).toBeNull();
    expect(
      parseRegQuery("ERROR: The system was unable to find the specified registry key", "SteamPath"),
    ).toBeNull();
  });

  test("uses HKCU SteamPath, normalised to backslashes", async () => {
    const proc = recordingProc((c) =>
      c.args[1] === "HKCU\\Software\\Valve\\Steam"
        ? { code: 0, stdout: REG_OUT, stderr: "" }
        : { code: 1, stdout: "", stderr: "" },
    );
    const fs = memFs({ "c:\\program files (x86)\\steam\\steamapps\\libraryfolders.vdf": "" }, "\\", true);
    const p = testPlatform("windows", { proc, fs });
    const r = await p.findSteamRoot("");
    expect(r.root).toBe("c:\\program files (x86)\\steam");
    expect(proc.runs[0]).toEqual({
      cmd: "reg",
      args: ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
    });
  });

  test("falls back to the default install path when the registry has nothing", async () => {
    const fs = memFs({ "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf": "" }, "\\");
    const p = testPlatform("windows", { fs });
    const r = await p.findSteamRoot("");
    expect(r.root).toBe("C:\\Program Files (x86)\\Steam");
    expect(r.tried.filter((t) => !t.ok).length).toBe(3);
  });

  test("a configured root wins", async () => {
    const fs = memFs({ "D:\\Steam\\steamapps\\libraryfolders.vdf": "" }, "\\");
    const r = await testPlatform("windows", { fs }).findSteamRoot("D:/Steam");
    expect(r.root).toBe("D:\\Steam");
  });

  test("reports nothing found", async () => {
    const r = await testPlatform("windows").findSteamRoot("");
    expect(r.root).toBeNull();
  });
});

describe("linux: Steam root discovery", () => {
  test("finds ~/.local/share/Steam", async () => {
    const fs = memFs({ "/home/kyle/.local/share/Steam/steamapps/libraryfolders.vdf": "" });
    const r = await testPlatform("linux", { fs }).findSteamRoot("");
    expect(r.root).toBe("/home/kyle/.local/share/Steam");
    expect(r.flatpak).toBe(false);
  });

  test("detects the Flatpak Steam root", async () => {
    const fs = memFs({
      "/home/kyle/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/libraryfolders.vdf": "",
    });
    const r = await testPlatform("linux", { fs }).findSteamRoot("");
    expect(r.flatpak).toBe(true);
  });

  test("rejects a directory without libraryfolders.vdf", async () => {
    const fs = memFs({ "/home/kyle/.steam/steam/config/config.vdf": "" });
    const r = await testPlatform("linux", { fs }).findSteamRoot("");
    expect(r.root).toBeNull();
    expect(r.tried.find((t) => t.path === "/home/kyle/.steam/steam")?.why).toContain("libraryfolders");
  });
});

describe("launch commands", () => {
  const steamWin = { root: "C:\\Program Files (x86)\\Steam", tried: [], flatpak: false };
  test("linux: steam with a rungameid URL", () => {
    const p = testPlatform("linux");
    expect(p.steamLaunchCommand({ root: "/x", tried: [], flatpak: false }, "620")).toEqual({
      cmd: "steam",
      args: ["steam://rungameid/620"],
    });
    expect(p.steamLaunchCommand({ root: "/x", tried: [], flatpak: true }, "620")).toEqual({
      cmd: "flatpak",
      args: ["run", "com.valvesoftware.Steam", "steam://rungameid/620"],
    });
  });
  test("windows: steam.exe with a rungameid URL", () => {
    expect(testPlatform("windows").steamLaunchCommand(steamWin, "18446738773753462784")).toEqual({
      cmd: "C:\\Program Files (x86)\\Steam\\steam.exe",
      args: ["steam://rungameid/18446738773753462784"],
    });
  });
  test("kiosk commands", () => {
    const l = testPlatform("linux").kioskCommand("http://127.0.0.1:7744/");
    expect(l.cmd).toBe("flatpak");
    expect(l.args).toContain("--kiosk");
    expect(l.args.at(-1)).toBe("http://127.0.0.1:7744/");
    const w = testPlatform("windows").kioskCommand("http://127.0.0.1:7744/");
    expect(w.cmd).toBe("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(w.args).toContain("--app=http://127.0.0.1:7744/");
    expect(w.args).toContain("--start-fullscreen");
  });
  test("jellyfin client commands", () => {
    expect(testPlatform("linux").jellyfinClientCommand()).toEqual({
      cmd: "flatpak",
      args: ["run", "org.jellyfin.JellyfinDesktop"],
    });
    expect(testPlatform("windows").jellyfinClientCommand()?.cmd).toBe(
      "C:\\Users\\kyle\\AppData\\Local\\Programs\\Jellyfin Desktop\\Jellyfin Desktop.exe",
    );
  });
});

describe("command line splitting", () => {
  test("quotes and Windows paths", () => {
    expect(splitCommandLine('"C:\\Program Files\\x.exe" --a "b c" \'d\'')).toEqual({
      cmd: "C:\\Program Files\\x.exe",
      args: ["--a", "b c", "d"],
    });
    expect(splitCommandLine('flatpak run "" x')).toEqual({ cmd: "flatpak", args: ["run", "", "x"] });
    expect(splitCommandLine('"open')).toBeNull();
    expect(splitCommandLine("   ")).toBeNull();
  });
});

describe("linux game process detection", () => {
  test("finds reaper AppId=<id> in /proc", () => {
    const fs = memFs({
      "/proc/100/cmdline": "/usr/bin/bash\0",
      "/proc/200/cmdline": "reaper\0SteamLaunch\0AppId=620\0--\0/game\0",
    });
    const p = testPlatform("linux", { fs });
    expect(p.isGameRunning("620")).toBe(true);
    expect(p.isGameRunning("570")).toBe(false);
    expect(p.isGameRunning("18446738773753462784")).toBe(false);
  });
});
