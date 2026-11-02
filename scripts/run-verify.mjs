#!/usr/bin/env node
/**
 * Run every scripts/verify-*.ts contract and report a summary.
 *
 * Unlike a `a && b && c` chain this keeps going after a failure, so one stale
 * check cannot hide others, and new verify scripts are picked up automatically.
 *
 *   npm test                 # all
 *   npm test -- drive sync   # only names containing "drive" or "sync"
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const filters = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const scripts = readdirSync(here)
  .filter((f) => /^verify-.*\.ts$/.test(f))
  .filter((f) => !filters.length || filters.some((q) => f.includes(q)))
  .sort();

if (!scripts.length) {
  console.error("No verify scripts matched.");
  process.exit(1);
}

const tsx = join(root, "node_modules", ".bin", "tsx");
const concurrency = Math.max(
  1,
  Number(process.env.VERIFY_CONCURRENCY) ||
    Math.min(6, availableParallelism()),
);

function run(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(tsx, [join("scripts", file)], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) =>
      resolve({ file, ok: code === 0, out, ms: Date.now() - started }),
    );
  });
}

const results = [];
let next = 0;
async function worker() {
  while (next < scripts.length) {
    const file = scripts[next++];
    const result = await run(file);
    results.push(result);
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(`${mark}  ${file}  (${(result.ms / 1000).toFixed(1)}s)`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  const lines = r.out
    .split("\n")
    .filter((l) => !/^\s+at /.test(l))
    .slice(-15)
    .join("\n");
  console.log(`\n── ${r.file} ──\n${lines}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} verify scripts passed`,
);
process.exit(failed.length ? 1 : 0);
