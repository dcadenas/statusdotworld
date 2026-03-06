import { GoogleGenAI } from "@google/genai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const categories = JSON.parse(
  readFileSync(join(ROOT, "categories.json"), "utf-8")
);

const dateArg = process.argv.find((a) => a.startsWith("--date="));
const today = dateArg
  ? dateArg.split("=")[1]
  : new Date().toISOString().slice(0, 10);

console.log(`Assessing world status for ${today}...`);

const categoryHints = {
  "human-rights": "including digital rights, AI safety, surveillance, and tech privacy violations",
};

const categoryList = categories
  .map((c, i) => {
    const hint = categoryHints[c.id];
    return `${i + 1}. ${c.label}${hint ? ` (${hint})` : ""}`;
  })
  .join("  ");

const isToday = today === new Date().toISOString().slice(0, 10);
const dateInstruction = isToday
  ? `Today is ${today}. Search for today's current news.`
  : `The date you are assessing is ${today}. Search for news specifically from ${today}. Focus only on events and developments that were reported on that date, not current news.`;

const prompt = `You are an analyst for status.world, a global status page. ${dateInstruction}

For each of the following categories, assess the global situation based on news from ${today}:
${categoryList}

For each category, provide:
- severity: "green" (relatively quiet/stable day), "yellow" (notable developments or concerning trends), or "red" (severe crisis, major escalation, or emergency)
- headline: A single-line summary (under 80 characters)
- summary: 2-3 sentences explaining the assessment with specifics from that date
- regions: An array of up to 8 specific geographic locations relevant to the category's events on this date. Each region has: "name" (city/region and country, e.g. "Kharkiv, Ukraine"), "lat" (latitude as number), "lng" (longitude as number), "severity" (local severity: "green", "yellow", or "red"), "detail" (one sentence explaining what happened at this specific location). For conflicts involving multiple parties, include regions for all major parties (e.g. both aggressor and target countries), not just where the impact occurs.

CRITICAL: Only reference REAL events, REAL countries, and REAL people. Never use fictional or placeholder names like "Nation A", "Country X", or made-up place names. If you cannot find specific news for a category on this date, assess it as green with a factual summary about the general state of affairs.

Calibration guidance:
- GREEN: No major new developments. Existing situations stable or improving.
- YELLOW: Notable new developments, escalations, or emerging concerns that warrant attention.
- RED: Active emergencies, major escalations, severe crises affecting large populations. Reserve red for genuinely severe situations.

Use Google Search to find real news from ${today} for your assessment.

Respond with ONLY a JSON object in this exact format (no markdown, no code fences):
{
  ${categories.map(c => `"${c.id}": { "severity": "green|yellow|red", "headline": "...", "summary": "...", "regions": [{ "name": "City, Country", "lat": 0.0, "lng": 0.0, "severity": "green|yellow|red", "detail": "One sentence about what happened here" }] }`).join(",\n  ")}
}`;

const ai = new GoogleGenAI({ apiKey });

// Single call with Google Search grounding.
// We ask for JSON in the prompt since responseMimeType + grounding is unsupported.
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: prompt,
  config: {
    tools: [{ googleSearch: {} }],
  },
});

const rawText = response.text;
const groundingMetadata =
  response.candidates?.[0]?.groundingMetadata;

// Extract JSON from response (may have markdown fences)
const jsonMatch = rawText.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  console.error("Failed to extract JSON from response:", rawText.slice(0, 500));
  process.exit(1);
}

let result = JSON.parse(jsonMatch[0]);
if (groundingMetadata?.groundingChunks) {
  attachSources(result, groundingMetadata.groundingChunks);
}

function attachSources(data, chunks) {
  const sources = chunks
    .filter((c) => c.web)
    .map((c) => ({ title: c.web.title || "", url: c.web.uri || "" }))
    .slice(0, 5);

  for (const catId of Object.keys(data)) {
    if (!data[catId].sources) {
      data[catId].sources = sources;
    }
  }
}

// Ensure sources exist on all categories
for (const cat of categories) {
  if (!result[cat.id].sources) {
    result[cat.id].sources = [];
  }
}

const assessment = {
  date: today,
  timestamp: Date.now(),
  categories: result,
};

const dataDir = join(ROOT, "data");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const outPath = join(dataDir, `${today}.json`);
writeFileSync(outPath, JSON.stringify(assessment, null, 2));
console.log(`Written: ${outPath}`);

// Regenerate index.json and recent.json
const { readdirSync } = await import("fs");
const allDates = readdirSync(dataDir)
  .filter((f) => f.endsWith(".json") && f !== "index.json" && f !== "recent.json")
  .map((f) => f.replace(".json", ""))
  .sort();

writeFileSync(join(dataDir, "index.json"), JSON.stringify(allDates, null, 2));
console.log(`Updated: data/index.json (${allDates.length} entries)`);

// Bundle last 90 days into recent.json
const RECENT_DAYS = 90;
const recentDates = allDates.slice(-RECENT_DAYS);
const recent = {};
for (const d of recentDates) {
  const filePath = join(dataDir, `${d}.json`);
  if (existsSync(filePath)) {
    recent[d] = JSON.parse(readFileSync(filePath, "utf-8"));
  }
}
writeFileSync(join(dataDir, "recent.json"), JSON.stringify(recent));
console.log(`Updated: data/recent.json (${Object.keys(recent).length} days)`);
