# Public dashboard renderer source

The unlisted status viewer is in `assets/status/3a15d3a8018633593678cb779c7510f56aa8ce96/index.html`.
It fetches the existing `server-status-data` HTML every five minutes. The Windows
hourly Python publisher generates that HTML with `website_status.build_content()`
and `detailed_status.build()`.

`detailed_status.py`, `bilingual_dashboard.py` and `collect_resources.py` here are
reviewed source copies installed in `C:/Users/User/compute/monitoring/resources`.
`inspect_master_storage.py` is installed in `C:/Users/User/compute/tools`.
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

When updating these modules, validate a local candidate, acquire the existing
`deterministic-run.lock`, back up and atomically install only the changed modules,
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

## SG-Master storage

The optional SG disk query uses the existing SG SSH endpoint with unchanged
authentication options, separately from the scheduler/accounting command. Its
30-second outer timeout and 8-second `df` timeout cannot invalidate the collected
scheduler, job counter or milestone inputs. No node workload, file scan, mount
change or privileged remote command is used.

The helper reads `/proc/self/mountinfo` and `df -P -T -B1`. It omits pseudo and
temporary filesystems, groups mount aliases by kernel filesystem instance, and
emits one capacity row per instance. Remote source addresses, mount options,
private path components and aggregate sums are excluded. Shared mounts and
SG-Master local filesystems are separate groups; compute-node local disks remain
unmeasured. Percentage follows `ceil(100 * used / (used + available))`, retaining
the validated `df` result. User-available space excludes reserved blocks.

Storage has its own observation timestamp and freshness check. Individually
valid counters survive partial `df` failures; missing or malformed counters and
expired observations remain unknown. Fresh storage can still display when a
scheduler query fails, and failed storage cannot hide current node/job data.

Offline storage checks (no SSH or publication):

```text
python -m unittest discover -s scripts/server-status -p test_master_storage.py
python -m unittest discover -s scripts/server-status -p test_storage_projection.py
```

The projection suite's real-template render check requires the existing lab
template and is skipped elsewhere; its other cases are portable. Keep an
immediate storage-only observation separate from the scheduler timestamp when
preparing a one-time publication; the hourly collector subsequently refreshes
both without changing its schedule.
