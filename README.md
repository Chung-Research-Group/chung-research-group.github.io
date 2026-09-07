# Chung Research Group website

This repository publishes the Chung Research Group website on GitHub Pages.

## Design contract

The checked-in templates, data, CSS, images, and JavaScript remain the visual and interaction source of truth. The build copies assets unchanged, applies shared navigation/contact details from `scripts/site-chrome.mjs`, and adds deterministic static HTML from the same page logic and data. It verifies that:

- all pages and runtime files are present;
- local links and assets resolve with case-sensitive paths;
- JavaScript files parse;
- the Archivo typography wiring remains present;
- the interactive homepage hero and reduced-motion fallback remain present; and
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
