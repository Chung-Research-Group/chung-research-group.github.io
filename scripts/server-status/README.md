# Public dashboard renderer source

The unlisted status viewer is in `assets/status/3a15d3a8018633593678cb779c7510f56aa8ce96/index.html`.
It fetches the existing `server-status-data` HTML every five minutes. The Windows
hourly Python publisher generates that HTML with `website_status.build_content()`
and `detailed_status.build()`.

`detailed_status.py` and `bilingual_dashboard.py` here are the reviewed source
copies installed together in `C:/Users/User/compute/monitoring/resources`.
The renderer still reads the existing local `dashboard_template.html`,
`localize_dashboard.py`, `occupancy.py`, configuration and snapshots. Neither
configuration nor observations belong in this source directory. This directory
is not copied into the static site build.

The bilingual layer embeds both label dictionaries and receives validated
language messages from the parent viewer. The parent stores the preference under
`mtap-server-status:language`, falls back to the browser language, and sends it
again whenever a new iframe document loads. The opaque iframe sandbox remains
`allow-scripts`; storage access and `allow-same-origin` are unnecessary in the
child. Language repaint retains the selected server/node/core and open details.

When updating the renderer, validate a local candidate, acquire the existing
`deterministic-run.lock`, back up and atomically install only these two modules,
and leave the collector, credentials, configuration and scheduled task alone.
Publish with the existing `website_status.publish(live_root)` function. Do not
run the whole monitor merely to publish a UI change: it also processes separate
Notion and milestone work. Keep the reviewed source copies and live modules
identical so later hourly runs preserve the language feature.

Local checks for a freshly generated, unwrapped renderer artifact:

```text
node scripts/server-status/test_detailed_renderer.cjs /path/to/dashboard.html
```

The renderer checks use synthetic freshness/time overrides without printing
observations. Viewer preference, message validation, refresh failures and
standalone-route invariants are tested by `tests/server-status.test.mjs` in
`npm run test:automation`. Browser checks additionally cover the sandboxed iframe,
both languages, tabs, nodes, CPU cores, GPU/storage, failure states and mobile.
