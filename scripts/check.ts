/**
 * The one gate: lint + format, typecheck, unit/API tests, web build, UI tests.
 *   bun run check            everything
 *   bun run check --no-e2e   skip Playwright (faster inner loop; phases still need the full run)
 */
const skipE2e = process.argv.includes("--no-e2e");

const steps: { name: string; cmd: string[] }[] = [
  { name: "lint + format (biome)", cmd: ["bun", "x", "biome", "check", "."] },
  { name: "typecheck (tsc strict)", cmd: ["bun", "scripts/typecheck.ts"] },
  { name: "unit + API tests (bun test)", cmd: ["bun", "test"] },
  { name: "web build (vite)", cmd: ["bun", "run", "build:web"] },
];
if (!skipE2e) steps.push({ name: "UI tests (playwright)", cmd: ["bun", "run", "e2e"] });

const results: { name: string; ok: boolean; ms: number }[] = [];
for (const s of steps) {
  console.log(`\n=== ${s.name} ===`);
  const t = performance.now();
  const r = Bun.spawnSync(s.cmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  results.push({ name: s.name, ok: r.exitCode === 0, ms: Math.round(performance.now() - t) });
  if (r.exitCode !== 0) break;
}
console.log("\n=== check summary ===");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.ms} ms)`);
const ok = results.length === steps.length && results.every((r) => r.ok);
console.log(ok ? "\ncheck: GREEN" : "\ncheck: RED");
process.exit(ok ? 0 : 1);
