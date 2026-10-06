/** Small CLI helpers the install scripts use, so paths and commands have one source of truth. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { defaultConfigToml, setConfigValues } from "./config.ts";
import { hostPlatform } from "./platform/index.ts";

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function runTool(
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  const platform = hostPlatform();
  const dir = env.COUCH_CONFIG_DIR || platform.configDir();
  const file = platform.path.join(dir, "config.toml");
  if (cmd === "config-path") {
    console.log(file);
    return 0;
  }
  if (cmd === "kiosk-command") {
    const port = Number(arg(args, "--port") ?? 7744);
    const k = platform.kioskCommand(`http://127.0.0.1:${port}/`);
    // --shell: one POSIX-quoted line, for the Linux installer's kiosk wrapper script.
    if (args.includes("--shell"))
      console.log([k.cmd, ...k.args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" "));
    else console.log(JSON.stringify(k));
    return 0;
  }
  // configure: create the file with defaults if needed, then set the Jellyfin values given.
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, defaultConfigToml(), { mode: 0o600 });
  }
  const values: Record<string, string> = {};
  const url = arg(args, "--jellyfin-url");
  const key = arg(args, "--api-key") ?? env.COUCH_JELLYFIN_API_KEY;
  const user = arg(args, "--user-id");
  if (url !== undefined) values.url = url.replace(/\/+$/, "");
  if (key !== undefined) values.api_key = key;
  if (user !== undefined) values.user_id = user;
  if (Object.keys(values).length)
    writeFileSync(file, setConfigValues(readFileSync(file, "utf8"), "jellyfin", values), { mode: 0o600 });
  console.log(
    `config: ${file}${Object.keys(values).length ? ` (set jellyfin ${Object.keys(values).join(", ")})` : ""}`,
  );
  return 0;
}
