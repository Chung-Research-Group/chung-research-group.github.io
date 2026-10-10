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

The homepage randomly loads Cu-BTC, CALF-20, MOF-74 (Mg), or NU-1000. All four use a shared angstrom-to-pixel scale at each viewport and zoom level, with identical radii for each element. The larger crystal panel starts stationary, looking along the pore direction: [100] for CALF-20, [001] for the other three. Drag or arrow keys rotate; wheel, two-finger pinch, +/− buttons, or +/− keys zoom; ↺ or Home restores the front pore view. The Agentic computing / Superintelligence headline keeps alternating without pause controls.

Periodically translated unit cells enlarge the visible framework region without changing the physical scale: Cu-BTC 2×2×1, CALF-20 1×3×3, Mg-MOF-74 2×2×1, NU-1000 1×1×1. Each caption reports these repetitions; the primitive cell grid and its primary cell remain visible. The initial/reset view fits all cells. Deliberate rotation or high zoom can move edges beyond the panel; zoom out or reset to restore the complete view.

Source files, individual licenses, normalization steps, and reproducible catalog commands are documented in [`data/mof-provenance.md`](data/mof-provenance.md).
