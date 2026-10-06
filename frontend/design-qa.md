# Design QA

final result: passed

## Target and evidence

- Source visual truth: `/Users/lzww/.codex/generated_images/01a1113c-4429-7011-a894-44b511ebf9f6/exec-ca161e01-17bd-48e3-bd67-e10a068b737e.png` (1487 × 1058).
- Implementation: local production preview `http://127.0.0.1:4173/#overview`.
- Browser viewport: 1440 × 1024 CSS pixels, density 1. Screenshot service captures the visible 1440 × 930 content region.
- Revised screenshot: `/Users/lzww/.codex/visualizations/2026/10/06/01a1113c-4429-7011-a894-44b511ebf9f6/home-after-qa.jpg` (1440 × 930).
- State: homepage, paper theme, no dialog, top of page, same Chinese content hierarchy.
- Normalization: source scaled uniformly by 1440/1487 to 1440 × 1025, then cropped to the same top 930 pixels. No vertical stretching.
- Full comparison: `/Users/lzww/.codex/visualizations/2026/10/06/01a1113c-4429-7011-a894-44b511ebf9f6/design-comparison.jpg`.
- Focused type, image and book rows: `design-detail-comparison.jpg` in the same evidence directory; focused navigation: `design-header-comparison.jpg`.
- Mobile evidence: `home-mobile.jpg` and `reader-mobile.jpg` in the same evidence directory (390 px viewport). Also checked 320 px reader and search.

## Comparison history

First capture (`home-before-qa.jpg`) had three P2 issues: hero artwork began at 22% and created a vertical background seam; the period caption lacked contrast over mountains; desktop navigation drifted right of the center. The hero now covers its region, the caption uses a paper backing, and navigation is centered above 1200 px. Revised capture and combined comparisons show these findings resolved.

Keyboard review also found search focus stayed on the close button and the skip-content link changed the route. The dialog now focuses its input after opening and refocuses when the panel changes. The skip link focuses the main region without changing the route. Browser checks verified both corrections, Escape closing, and restored focus.

## Required fidelity surfaces

- Typography: Chinese serif hierarchy, two-line display heading, smaller serif navigation and paper-reading text are retained. Local Songti/serif fallback is slightly lighter than the generated display lettering, an acceptable P3 font-rendering difference. Titles and small book captions remain readable at their actual size.
- Spacing and layout: aligned 4.1% desktop margins, 76 px header, 455 px hero, horizontal era ribbon and two-column feature/source region closely follow the source composition. Mobile stacks the editorial content and keeps the era strip independently scrollable. No page-level horizontal overflow at 390 or 320 px.
- Colors and tokens: warm paper, charcoal ink, muted annotations and cinnabar accents are consistent with the source. Period caption contrast corrected. Active navigation and selection states are visible.
- Images: generated raster landscapes, book illustrations and transparent seal are used, with WebP compression for runtime. Mountain subject and ink/paper direction match the mock; exact landscapes are intentionally regenerated as standalone assets. No CSS/SVG substitutes for artwork. Standard UI icons use Phosphor. No visible compression or transparency defects.
- Copy: general Chinese-history positioning remains, Five Dynasties is the current content scope. Corrected mock's incorrect author-period label for the Old History to Northern Song. Book text is explicitly labeled excerpts, external source links are preserved, modern-map limitations are visible. Unavailable eras open an honest content-plan panel.

## Interaction verification

Passed in browser: homepage/global search, person-only filtering, empty-search recovery, name-alias and dynasty filtering, resetting no results, person/event crosslinks, chronology next event, both book readers, font-size adjustment, related-reading tab, mobile menu and reader directory, Escape/close focus, skip-content route preservation, other-era planning state, map tile loading and city selection. Lazy map loaded with OpenStreetMap attribution. Browser console error/warning list was empty during these checks.

Production build completed successfully after final changes. External source content and modern map tiles remain third-party services; historical map boundaries are outside this release.

## Remaining polish

P3: an optional packaged Chinese serif font could make appearance more consistent across operating systems. Current system fallback avoids adding a large blocking download.

## Implementation checklist

- [x] Resolve all P0/P1/P2 visual and navigation findings.
- [x] Capture revised implementation and inspect normalized combined images.
- [x] Verify desktop and mobile core flows, empty states and console.
- [x] Produce deployable static build.
