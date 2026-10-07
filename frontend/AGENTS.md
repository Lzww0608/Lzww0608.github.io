# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Site identity

The user renamed the site to “中国古代史” on 2026-10-06. Use this name consistently in visible branding, page titles and descriptions. The first content release still focuses on the Five Dynasties period. On 2026-10-07 the user removed the header tagline beside the site name; keep the header free of that slogan. The user also removed the entire global footer, including its site name, tagline, current-period label and project/source link. Do not restore that footer; retain the source-specific provenance already provided in readers.

On 2026-10-07 the user temporarily hid other dynasties. Use `src/data.ts`'s shared `displayedDynasties` scope for timeline entries, people, filters and search; show only Later Liang/Tang/Jin/Han/Zhou in the home ribbon. Preserve the broader site identity, future data entries, archival originals, compiler dates and provenance. Do not add other-era preview entrances until the user reopens that scope.

## Content service

The user chose this Mac as the PostgreSQL/API host and Tailscale Funnel for a fixed public HTTPS address on 2026-10-06. Reading pages fetch published originals and matching published translations from the API; retain the complete per-chapter static archives when the service is unavailable. Do not display drafts or invent translations. Keep private database dumps, credentials and tunnel identities out of Git and frontend bundles. Public, attributed historical originals in `content/five-dynasties/` are intended for Git and static website publication.

## TypeScript

The user requested a frontend TypeScript migration on 2026-10-07. Keep application modules in `.ts`/`.tsx` with strict type checking. Model domain data and API responses in `src/types.ts`, and validate incoming JSON before rendering. Run `npm run build`, `npm test`, and `npm run test:sites` for relevant frontend changes; the build includes `npm run typecheck`. Preserve the existing Sites packaging scripts, worker and packaging tests.

## Appearance and sidebars

The user requested all left/right sidebars to be collapsible and a page-color switch on 2026-10-07. Use the shared `CollapsibleSidebar` for the home source entrance, reader chapter directory and map place index, as well as future sidebars. Each panel keeps its own preference, exposes accessible collapse/restore controls and gives space back to the main content on desktop. The user subsequently removed the reader assistance sidebar and its mobile entrance. Keep reading pages to the chapter directory and main text, with the text using the released space. The chapter directory opens as a drawer on phones; keep its toolbar control reachable. Layout changes must resize the existing map without losing the selected place. Provide paper/jade/night palettes through semantic colors in `src/appearance.css`, covering readers, dialogs and controls. Persist theme choice safely and restore it before rendering. Preserve the site's historical illustrations and typography; night mode must keep all text legible.

## Original text scripts

The user requested larger, bold original-text headings on 2026-10-07. Use semantic heading levels for the page title and verified original sections, year headings, prefaces and marked subsections, with a larger size than prose and font-weight 700. `scripts/prepare-content.mjs` uses Python 3 to regenerate `src/reading-headings.json` from preserved source markup; `src/reading-headings.ts` classifies canonical paragraphs before script conversion. Keep titles scaling with the reader font controls and wrapping on phones. A different API revision or original must not inherit the archived heading role. See the project reading skill for future content requirements.

The user requested Traditional/Simplified switching for current and future classical texts on 2026-10-07. All original-text readers must support both modes and remember the selection across chapters, books and reloads. Default to the canonical Traditional original. Use the shared `src/use-original-script.ts`, `src/original-script.ts` and lazily loaded OpenCC converter; keep conversion in the display layer. Restore Traditional by reading the canonical text directly, never by reverse-converting Simplified. Keep archive/API/database originals, paragraph IDs/revisions and published translations intact. New sources must check ambiguous historical names (including 乾祐/乾化) and add verified phrase exceptions when needed. Follow the project-authored `.agents/skills/historical-text-reading/SKILL.md` for content/reader changes.

## Local source library

The user requested full local originals for the five founding emperors on 2026-10-07, with Zizhi Tongjian and supplemental historical notes. Reading and chapter navigation must work within the site. Keep optional provenance links separate from reading actions. `predev` and `prebuild` copy the verified public archive into `public/history/`; do not bundle all chapter texts into the initial JavaScript or commit generated copies. Each chapter route must resolve to its own book and person, including in modals and cross-book reading links.

The user confirmed five supplemental sources on 2026-10-07: 五代史补 (all five volumes), 五代春秋 (both volumes), 五代会要 (all thirty volumes), 北梦琐言 (Four Treasuries edition volumes 17–20), and 资治通鉴考异 (Four Treasuries edition volumes 28–30). Keep their prefaces separately navigable by title; volume zero is a metadata sentinel, not a visible volume number. Use “篇” for mixed chapter/preface counts and open each book’s default numbered chapter from its main reading action. Keep genres accurate: institutions and source criticism have their own labels. Four Treasuries self-linked titles retain heading roles using preserved markup, rather than prose-length heuristics.

On 2026-10-07 the user explicitly requested publication of initial translations before their later corrections. The user subsequently removed all “AI 初译 · 待修订” displays. Use the neutral label “白话译文” for existing and future translations; omit AI/review-state badges, the introductory notice, review-state parentheticals in translator credits and the footer explanation. Keep translator names, versions, review notes and correction buttons. Preserve accurate origin/review metadata without inventing human review. Unreleased database drafts remain hidden. `content/published-translations/` contains approved published snapshots matched to immutable paragraph revisions and hashes; prebuild overlays them only into generated website copies. Keep original archives unchanged and prefer the API's latest published version over the static snapshot.

The published initial release contains 240 AI translations: 五代春秋 preface and both volumes (76 blocks), and the seven archived 新五代史 volumes 1, 2, 4, 5, 8, 10 and 11 (164 blocks, including headings and notes). These remain pending human checking. Never describe the selected volumes as a translation of the complete 新五代史.

## Protected translation corrections

The reader lets the owner authenticate and append corrections to an existing published translation. Use the shared `src/translation-editor-api.ts` and the protected `/api/editor/` endpoints. Keep credentials only in current-page memory; never put secrets in localStorage, sessionStorage, IndexedDB, Cookie, URLs, static assets or logs. Clear the session on exit and require authentication again after a page reload. The owner's local key is `backend/.local/editor-key.txt`; do not read, embed or publish its contents.

Saves must send the stable paragraph ID, expected original revision and current published translation ID. Preserve all unsaved input on errors and show conflicts instead of overwriting a newer version. A successful save returns a new published translation marked `origin: human` and `reviewStatus: owner-edited`; retain this metadata without implying professional review. Keep provenance and review notes accessible. Never change original text, paragraph IDs, historical translation versions or source archives from this UI. API-offline static content remains readable, but editing cannot be saved offline; refreshed static translations require another export, build and deployment.

The public `history_reader` database role remains read-only. The separate `history_editor` role has only connection/schema access and EXECUTE on the dedicated revision function, with no direct original/translation-table writes. Database passwords, dumps and private editor configuration never enter frontend bundles. Browser requests omit Cookie credentials and use Bearer authentication only with the allowed website Origin.
