/** Strict TypeScript check of every project. */
const projects = ["packages/core", "apps/server", "apps/web", "scripts"];
let failed = false;
for (const p of projects) {
  const r = Bun.spawnSync(["bun", "x", "tsc", "-p", p, "--noEmit"], { stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) {
    console.error(`typecheck failed: ${p}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
