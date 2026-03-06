#!/usr/bin/env node
import { GoogleGenAI } from "@google/genai";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const dataDir = join(ROOT, "data");

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Find all date files that have regions without detail
const allFiles = readdirSync(dataDir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort();

// Optional: filter to specific date range
const startDate = process.argv.find((a) => a.startsWith("--start="))?.split("=")[1];
const endDate = process.argv.find((a) => a.startsWith("--end="))?.split("=")[1];
const force = process.argv.includes("--force");

const filesToProcess = allFiles.filter((f) => {
  const date = f.replace(".json", "");
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
});

// Check which files need backfill
const needsBackfill = filesToProcess.filter((f) => {
  if (force) return true;
  const data = JSON.parse(readFileSync(join(dataDir, f), "utf-8"));
  const cats = data.categories || data;
  for (const catData of Object.values(cats)) {
    if (!catData.regions) continue;
    for (const r of catData.regions) {
      if (!r.detail) return true;
    }
  }
  return false;
});

console.log(`Files to process: ${needsBackfill.length} of ${filesToProcess.length}`);

if (needsBackfill.length === 0) {
  console.log("Nothing to backfill.");
  process.exit(0);
}

for (let i = 0; i < needsBackfill.length; i++) {
  const file = needsBackfill[i];
  const date = file.replace(".json", "");
  const filePath = join(dataDir, file);
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  const cats = data.categories || data;

  // Build prompt with existing data for context
  const catEntries = [];
  for (const [catId, catData] of Object.entries(cats)) {
    if (!catData.regions || catData.regions.length === 0) continue;
    const regions = catData.regions.map((r) => r.name).join(", ");
    catEntries.push(
      `Category: ${catId}\nHeadline: ${catData.headline}\nSummary: ${catData.summary}\nRegions: ${regions}`
    );
  }

  if (catEntries.length === 0) {
    console.log(`[${i + 1}/${needsBackfill.length}] ${date}: no regions, skipping`);
    continue;
  }

  const prompt = `Given the following world status assessment for ${date}, generate a short detail sentence for each region explaining what specifically happened at that location on that date.

${catEntries.join("\n\n")}

Respond with ONLY a JSON object mapping category ID to an array of objects with "name" and "detail" fields. The "detail" should be one concise sentence (under 120 characters) about what happened at that specific location. Match the regions exactly as listed above.

Example format (no markdown, no code fences):
{
  "armed-conflicts": [
    { "name": "Kharkiv, Ukraine", "detail": "Russian missile strikes hit residential areas, killing 12 civilians" }
  ]
}`;

  console.log(`[${i + 1}/${needsBackfill.length}] ${date}...`);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const rawText = response.text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`  Failed to extract JSON for ${date}`);
      continue;
    }

    const details = JSON.parse(jsonMatch[0]);

    // Merge details back into existing data
    let updated = 0;
    for (const [catId, regionDetails] of Object.entries(details)) {
      if (!cats[catId]?.regions) continue;
      for (const rd of regionDetails) {
        const region = cats[catId].regions.find((r) => r.name === rd.name);
        if (region && rd.detail) {
          region.detail = rd.detail;
          updated++;
        }
      }
    }

    writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`  Updated ${updated} regions`);
  } catch (e) {
    console.error(`  Error for ${date}: ${e.message}`);
    console.log("  Waiting 30s before continuing...");
    await sleep(30000);
  }

  if (i < needsBackfill.length - 1) {
    await sleep(2000);
  }
}

// Regenerate recent.json
console.log("\nRegenerating recent.json...");
const allDates = readdirSync(dataDir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map((f) => f.replace(".json", ""))
  .sort();

const RECENT_DAYS = 90;
const recentDates = allDates.slice(-RECENT_DAYS);
const recent = {};
for (const d of recentDates) {
  const fp = join(dataDir, `${d}.json`);
  if (existsSync(fp)) {
    recent[d] = JSON.parse(readFileSync(fp, "utf-8"));
  }
}
writeFileSync(join(dataDir, "recent.json"), JSON.stringify(recent));
console.log(`Updated recent.json (${Object.keys(recent).length} days)`);

console.log("\nBackfill complete!");
