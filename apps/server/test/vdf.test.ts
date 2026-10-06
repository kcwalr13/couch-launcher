import { describe, expect, test } from "bun:test";
import {
  ci,
  ciPath,
  ciStr,
  encodeBinaryVdf,
  parseBinaryVdf,
  parseTextVdf,
  VdfError,
} from "../src/adapters/steam/vdf.ts";

describe("text VDF", () => {
  test("parses nested sections, escapes, comments and conditionals", () => {
    const src = `// comment
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"apps"
		{
			"228980"		"1234"
		}
	}
	"quoted"	"say \\"hi\\"" [$WIN32]
	unquoted	value
}`;
    const v = parseTextVdf(src);
    const root = ciPath(v, "libraryfolders");
    expect(ciStr(ciPath(root, "0"), "path")).toBe("C:\\Program Files (x86)\\Steam");
    expect(ciPath(root, "0", "apps")).toEqual({ "228980": "1234" });
    expect(ciStr(root, "quoted")).toBe('say "hi"');
    expect(ciStr(root, "unquoted")).toBe("value");
  });

  test("case-insensitive lookup", () => {
    const v = parseTextVdf(`"A" { "Apps" { "1" { "LastPlayed" "5" } } }`);
    expect(ciStr(ciPath(v, "a", "apps", "1"), "lastplayed")).toBe("5");
    expect(ci(v, "missing")).toBeUndefined();
  });

  test("merges duplicate sections", () => {
    const v = parseTextVdf(`"r" { "s" { "a" "1" } "s" { "b" "2" } }`);
    expect(ciPath(v, "r", "s")).toEqual({ a: "1", b: "2" });
  });

  test("rejects malformed input", () => {
    expect(() => parseTextVdf(`"a" { "b" "c"`)).toThrow(VdfError);
    expect(() => parseTextVdf(`"a" "unterminated`)).toThrow(VdfError);
    expect(() => parseTextVdf(`}`)).toThrow(VdfError);
  });
});

describe("binary VDF (shortcuts.vdf)", () => {
  test("parses a hand-assembled shortcuts file", () => {
    // \0shortcuts\0 \0"0"\0 \x02appid\0<int32 LE> \x01AppName\0Game\0 \x01Exe\0"x"\0 \0tags\0 \x010\0co-op\0 \x08 \x08 \x08 \x08
    const bytes: number[] = [];
    const s = (t: string) => bytes.push(...new TextEncoder().encode(t), 0);
    bytes.push(0x00);
    s("shortcuts");
    bytes.push(0x00);
    s("0");
    bytes.push(0x02);
    s("appid");
    bytes.push(0x2e, 0xfb, 0xff, 0xff); // -1234
    bytes.push(0x01);
    s("AppName");
    s("Diablo IV");
    bytes.push(0x01);
    s("exe");
    s('"C:\\Battle.net\\Battle.net Launcher.exe"');
    bytes.push(0x02);
    s("LastPlayTime");
    bytes.push(0x00, 0x00, 0x00, 0x00);
    bytes.push(0x00);
    s("tags");
    bytes.push(0x01);
    s("0");
    s("favorite");
    bytes.push(0x08, 0x08, 0x08, 0x08);
    const v = parseBinaryVdf(Uint8Array.from(bytes));
    const sc = ciPath(v, "shortcuts", "0");
    expect(ci(sc, "appid")).toBe(-1234);
    expect(ciStr(sc, "appname")).toBe("Diablo IV");
    expect(ciStr(sc, "Exe")).toBe('"C:\\Battle.net\\Battle.net Launcher.exe"');
    expect(ciPath(sc, "tags")).toEqual({ "0": "favorite" });
  });

  test("encode/parse round trip", () => {
    const tree = { shortcuts: { "0": { appid: -5, AppName: "Ünïcode ✓", tags: {} } } };
    expect(parseBinaryVdf(encodeBinaryVdf(tree))).toEqual(tree);
  });

  test("rejects truncated and unknown data", () => {
    expect(() => parseBinaryVdf(Uint8Array.from([0x00, 0x61, 0x00, 0x02, 0x62, 0x00, 0x01]))).toThrow(
      VdfError,
    );
    expect(() => parseBinaryVdf(Uint8Array.from([0x00, 0x61, 0x00, 0x09, 0x62, 0x00]))).toThrow(VdfError);
  });
});
