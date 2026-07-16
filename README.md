# Chung Research Group website

This repository publishes the Chung Research Group website on GitHub Pages.

## Design contract

The checked-in HTML, CSS, images, fonts, animations, and browser JavaScript are the visual and interaction source of truth. The build does not rewrite them. It copies every published file byte-for-byte into `dist/`, then verifies that:

- all pages and runtime files are present;
- local links and assets resolve with case-sensitive paths;
- JavaScript files parse;
- the Archivo typography wiring remains present;
- the interactive homepage hero and reduced-motion fallback remain present; and
- the deployed artifact is byte-identical to the checked-in site source.

## Local checks

```bash
npm run check
```

The command requires Node.js 20 or newer. Run `npm ci` once before the full test suite.

Publication topics live beside publication records in `feed.js`. Member and alumni records live in `people-data.js`; page templates only render those sources.

`npm test` also runs Playwright against the built site, checking all published routes, metadata, publication filtering/search, and graduate-program normalization. Install Chromium once for local browser testing with `npx playwright install chromium`.

## Deployment

Pull requests run the same validation without publishing. After an approved change reaches `main`, GitHub Actions builds the immutable `dist/` artifact and deploys it through GitHub Pages.
