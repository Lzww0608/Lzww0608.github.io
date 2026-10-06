# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Site identity

The user renamed the site to “中国古代史” on 2026-10-06. Use this name consistently in visible branding, page titles and descriptions. The first content release still focuses on the Five Dynasties period.

## Content service

The user chose this Mac as the PostgreSQL/API host and Tailscale Funnel for a fixed public HTTPS address on 2026-10-06. Reading pages fetch published originals and matching published translations from the API; retain the complete per-chapter static archives when the service is unavailable. Do not display drafts or invent translations. Keep private database dumps, credentials and tunnel identities out of Git and frontend bundles. Public, attributed historical originals in `content/five-dynasties/` are intended for Git and static website publication.

## TypeScript

The user requested a frontend TypeScript migration on 2026-10-07. Keep application modules in `.ts`/`.tsx` with strict type checking. Model domain data and API responses in `src/types.ts`, and validate incoming JSON before rendering. Run `npm run build`, `npm test`, and `npm run test:sites` for relevant frontend changes; the build includes `npm run typecheck`. Preserve the existing Sites packaging scripts, worker and packaging tests.

## Local source library

The user requested full local originals for the five founding emperors on 2026-10-07, with Zizhi Tongjian and supplemental historical notes. Reading and chapter navigation must work within the site. Keep optional provenance links separate from reading actions. `predev` and `prebuild` copy the verified public archive into `public/history/`; do not bundle all chapter texts into the initial JavaScript or commit generated copies. Each chapter route must resolve to its own book and person, including in modals and cross-book reading links.
