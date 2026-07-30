# Publication metadata enrichment

The website stores citation and research-discovery metadata in
`data/publication-metadata.json`. Visitors read this static snapshot instead of
making one external API request per publication.

## Sources

- Semantic Scholar Graph API: citation and influential-citation counts,
  reference counts, publication types, and fields of study.
- OpenAlex Works API: citation counts, topics, field hierarchy, keywords,
  citation percentiles, and yearly citation counts.
- Google Scholar author profile metrics through the SerpApi Google Scholar
  Author API: total citations, h-index, i10-index, and yearly citation counts.

Google Scholar does not provide a supported public API or bulk export service,
and its help page asks automated clients to respect its access restrictions.
The refresh job therefore does not scrape Scholar directly. SerpApi is called
server-side once per daily refresh, while visitors only receive the committed
static snapshot. The Google Scholar total covers the full public author profile;
the OpenAlex and Semantic Scholar totals are sums over the curated DOI list, so
the three values should not be compared as if they had identical coverage.

The peer-reviewed DOI in `feed.js` is the canonical join key. ChemRxiv records
remain excluded by the publication review automation.

## Refresh schedule

`.github/workflows/publication-metadata.yml` runs daily and can also be
triggered manually. A change to `feed.js` on `main` also refreshes the snapshot.
It only commits when normalized metadata or source health changes. Temporary
failure of one API preserves the last snapshot values from that source. A
successful response that suddenly covers less than 80% of the previous source
coverage is also treated as stale, preventing a partial API response from
erasing good metadata.

The existing `PUBLICATION_GITHUB_TOKEN` secret is used to publish changed
metadata. Configure these source credentials:

- `OPENALEX_API_KEY` — required for supported, reliable production use. A free
  OpenAlex key is sufficient for this daily job.
- `SEMANTIC_SCHOLAR_API_KEY` — optional, but recommended for a dedicated rate
  limit instead of the shared anonymous pool.
- `SERPAPI_API_KEY` — required to refresh Google Scholar profile metrics.
  SerpApi's recurring free plan currently provides substantially more requests
  than this one-profile daily job needs.

OpenAlex may currently answer some anonymous requests, but that behavior is not
a production contract. The retired `mailto` polite-pool parameter is not used.
If the SerpApi key is absent, exhausted, or temporarily fails, the job retains
the last Google Scholar snapshot and marks that source stale instead of
replacing it with zero. A drop below 80% of the previous citation total is also
rejected as a likely provider or parsing failure.

`snapshotUpdatedAt` records when the committed snapshot content or health last
changed. Each source's `contentUpdatedAt` records when that source's retained
records last changed; it is not updated merely because a scheduled request
succeeded.

Run a local refresh with:

```text
node scripts/refresh-publication-metadata.mjs
```

Validate the committed schema and DOI coverage without calling either API:

```text
node scripts/refresh-publication-metadata.mjs --check
```
