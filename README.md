# status.world

A status page for the world. Like your favorite service status page, but for civilization.

**Live:** [status.dcadenas.dev](https://status.dcadenas.dev)

## What is this?

An Atlassian Statuspage-style dashboard that tracks global issues across 7 components:

- **World Peace** — Armed conflicts and geopolitical tensions
- **Human Rights** — Civil liberties and human rights developments
- **The Climate** — Climate events and environmental crises
- **Public Health** — Disease outbreaks and health system status
- **Global Economy** — Markets, trade, and economic stability
- **Democracy** — Electoral integrity and democratic institutions
- **Humanitarian Aid** — Relief operations and humanitarian access

Each component gets a daily severity: **Operational** (green), **Degraded Performance** (yellow), or **Major Outage** (red).

## How it works

A daily GitHub Actions workflow calls Gemini 2.5 Flash with Google Search grounding to assess each category based on that day's news. Results are stored as JSON and served as a static site via GitHub Pages.

## Stack

- **Frontend:** Vanilla HTML/CSS/JS, no framework, no build step
- **Data:** Gemini 2.5 Flash via `@google/genai` SDK
- **Hosting:** GitHub Pages
- **Automation:** GitHub Actions (daily cron)

## Running locally

```bash
npm install
GEMINI_API_KEY=your-key node scripts/assess.mjs
npx serve .
```

## License

MIT
