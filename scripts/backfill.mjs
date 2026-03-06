#!/usr/bin/env node
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const dataDir = join(ROOT, "data");

const DAYS = 90;
const DELAY_MS = 2000; // 2s between requests to avoid rate limits
const force = process.argv.includes("--force");

// Generate date range: today back N days
const dates = [];
const now = new Date();
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(now);
  d.setDate(d.getDate() - i);
  dates.push(d.toISOString().slice(0, 10));
}

// Filter to missing dates, or all dates if --force
const missing = force
  ? dates
  : dates.filter((d) => !existsSync(join(dataDir, `${d}.json`)));

console.log(`Total dates: ${dates.length}, to process: ${missing.length}${force ? " (forced)" : ""}`);

if (missing.length === 0) {
  console.log("Nothing to backfill.");
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < missing.length; i++) {
  const date = missing[i];
  console.log(`\n[${i + 1}/${missing.length}] Assessing ${date}...`);

  try {
    execFileSync("node", [join(__dirname, "assess.mjs"), `--date=${date}`], {
      stdio: "inherit",
      env: process.env,
    });
  } catch (e) {
    console.error(`Failed for ${date}: ${e.message}`);
    console.log("Waiting 30s before retry...");
    await sleep(30000);
    try {
      execFileSync("node", [join(__dirname, "assess.mjs"), `--date=${date}`], {
        stdio: "inherit",
        env: process.env,
      });
    } catch (e2) {
      console.error(`Retry failed for ${date}, skipping: ${e2.message}`);
      continue;
    }
  }

  if (i < missing.length - 1) {
    console.log(`Waiting ${DELAY_MS / 1000}s...`);
    await sleep(DELAY_MS);
  }
}

console.log("\nBackfill complete!");
