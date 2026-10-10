# Chung Research Group website

This repository publishes the Chung Research Group website on GitHub Pages.

## Design contract

The checked-in templates, data, CSS, images, and JavaScript remain the visual and interaction source of truth. The build copies assets unchanged, applies shared navigation/contact details from `scripts/site-chrome.mjs`, and adds deterministic static HTML from the same page logic and data. It verifies that:

- all pages and runtime files are present;
- local links and assets resolve with case-sensitive paths;
- JavaScript files parse;
- the Archivo typography wiring remains present;
- the manually rotatable homepage hero and static pore-view fallback remain present; and
- the deployed artifact matches the deterministic build; non-HTML assets remain byte-identical.

`render-static-site.mjs` renders the checked-in templates at build time with LinkeDOM, without network requests or lifecycle hooks. Static content is in a `<noscript>` view; the original interactive template is inert until `assets/site-template.js` activates it before the existing runtime boots. JavaScript-disabled visitors can read the same records and use links and native disclosure controls. Search/filter widgets are omitted in that view. This is a no-JavaScript fallback, not a replacement for the interactive runtime.

## Local checks

```bash
npm run check
```

The command requires Node.js 20 or newer. Run `npm ci` once before checks or the full test suite.

Publication topics live beside publication records in `feed.js`. Member and alumni records live in `people-data.js`; page templates only render those sources.

`npm test` also runs Playwright against the built site, checking all published routes, metadata, publication filtering/search, and graduate-program normalization. Install Chromium once for local browser testing with `npx playwright install chromium`.

## Deployment

Pull requests run the same validation without publishing. After an approved change reaches `main`, GitHub Actions builds the immutable `dist/` artifact and deploys it through GitHub Pages.

## Homepage crystal structures

The earlier eight-model catalogue and its manual renderer remain as reference assets only. The active homepage uses the four-model pore-facing supercell viewer documented below.

Source files, individual licenses, normalization steps, and reproducible catalog commands are documented in [`data/mof-provenance.md`](data/mof-provenance.md).

The build publishes title, description, canonical URL, and Open Graph/Twitter tags in the initial HTML head without runtime duplicates. The 1200×630 sharing image is reproducible with `python scripts/generate-homepage-social.py --check`. The active viewer uses prebuilt SVG fallbacks and a cached Canvas scene, updated at 15 frames per second during the gentle yaw.

### Polished pore-facing homepage (October 2026)

The approved homepage uses `data/mof-gallery.json`, `assets/mof-pore-renderer.js`,
and `assets/mof-pore-viewer.js`. Each visit chooses one of Cu-BTC, CALF-20,
Mg-MOF-74 and NU-1000. Orthographic pore-facing views have no pitch or roll;
a gentle ±0.12-radian yaw preserves pore visibility. Motion controls and reduced
motion preferences are supported. `images/mofs/` contains the matching no-JS
fallbacks. Camera and periodic centering provenance is recorded in
`data/mof-view-provenance.json`; the gallery retains structural source metadata.
The earlier eight-model catalogue and renderer remain as audited reference
assets, but are no longer connected to the homepage.

CALF-20 uses a 1×2×2 supercell across the pore plane. Cu-BTC, Mg-MOF-74
and NU-1000 use their pore-centered single unit cells to show larger apertures. The source unit-cell
representations are retained in `data/mof-unit-cells.json`. Regenerate with
`python3 scripts/generate-mof-supercells.py` followed by
`node scripts/generate-mof-posters.mjs`. Exact lattice translations preserve
every displayed source bond length (maximum error below 0.00002 Å). The outer
outline encloses the displayed cell region; source lattice vectors remain intact.
