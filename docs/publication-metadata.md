# Publication metadata enrichment

The website stores citation and research-discovery metadata in
`data/publication-metadata.json`. Visitors read this static snapshot instead of
making one external API request per publication.

## Sources

- Semantic Scholar Graph API: citation and influential-citation counts,
  reference counts, publication types, and fields of study.
- OpenAlex Works API: citation counts, topics, field hierarchy, keywords,
  citation percentiles, and yearly citation counts.
- Google Scholar author-profile and per-paper metrics through the SerpApi
  Google Scholar Author API: total citations, h-index, i10-index, yearly
  citation counts, and article citation counts.

Google Scholar does not provide a supported public API or bulk export service,
and its help page asks automated clients to respect its access restrictions.
The refresh job therefore does not scrape Scholar directly. SerpApi is called
server-side during the daily refresh, with `num=100`, `sort=pubdate`, and
official `start` offsets when pagination is required. Visitors only receive the
committed static snapshot; no direct Scholar request is made by a visitor's
browser.

The Google Scholar total remains an author-profile aggregate and is never
recomputed from the website's DOI list. Each DOI record can additionally carry
a `googleScholar` article count and `sourceFreshness.googleScholar` state.
Publication cards prefer that per-paper count, then OpenAlex, then Semantic
Scholar. Because the profile aggregate covers publications outside the curated
website list, it must not be compared with the OpenAlex or Semantic Scholar
catalogue sums as if their coverage were identical.

Per-paper joins are deliberately conservative and deterministic. The matching
precedence is:

1. a reviewed DOI-to-Scholar-citation-ID override;
2. the citation ID retained by the previous snapshot;
3. a unique exact normalized feed title with a publication year within one
   year;
4. a unique exact Semantic Scholar or OpenAlex title with a compatible year;
5. a unique long title prefix with compatible year and strict length guards.

Punctuation, common HTML entities, Unicode compatibility forms, case, and
whitespace are normalized; fuzzy similarity is not used. The reviewed override
for DOI `10.1021/acs.jpcc.9b02116` selects
`q-UUrywAAAAJ:3fE2CSJIrl8C`, avoiding a similar zero-citation duplicate on the
profile.

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

Every run writes a source-health table to the GitHub Actions summary. Missing
credentials and stale or partial providers emit warning annotations without
blocking valid OpenAlex or Semantic Scholar updates. Run
`npm run metadata:health` locally to inspect the committed snapshot with the
same checks.

When an otherwise accepted response omits one or more DOI records that existed
in the previous snapshot, the job retains those records but marks the source
stale instead of presenting the merged result as fully current. Source metadata
records `observedMatched` and `retainedMatched` separately. Each publication
also records whether its source record was observed in the accepted response,
retained from the prior snapshot, or unavailable, together with the last known
content-update time. A later complete response returns the source to `ok`.

The existing `PUBLICATION_GITHUB_TOKEN` secret is used to publish changed
metadata. Configure these source credentials:

- `OPENALEX_API_KEY` — required for supported, reliable production use. A free
  OpenAlex key is sufficient for this daily job.
- `SEMANTIC_SCHOLAR_API_KEY` — optional, but recommended for a dedicated rate
  limit instead of the shared anonymous pool.
- `SERPAPI_API_KEY` — required to refresh Google Scholar profile and per-paper
  metrics.
  SerpApi's recurring free plan currently provides substantially more requests
  than this one-profile daily job needs.

OpenAlex may currently answer some anonymous requests, but that behavior is not
a production contract. The retired `mailto` polite-pool parameter is not used.
If the SerpApi key is absent, exhausted, or temporarily fails, the job retains
both the previous profile aggregate and prior per-paper records and marks their
freshness stale instead of replacing values with zero. Ambiguous current
matches also retain prior DOI records. A profile citation total below 80% of
the previous value rejects the complete Scholar refresh. Per-paper coverage
below 80% rejects only the new article records; a separately valid profile
aggregate is accepted and prior DOI records are retained as stale. A successful
but incomplete match above that safety threshold is marked `partial`; newly
matched records are fresh and retained unmatched records are stale.

The author profile currently fits within the bounded article pagination. Each
page requests at most 100 records, the maximum documented by SerpApi, and the
job follows `start` offsets for at most five pages while de-duplicating citation
IDs. Empty, repeated, inconsistent, or over-limit pagination fails closed. If
the bounded article list remains truncated, the independently reported profile
aggregate (total citations, h-index, i10-index, and yearly counts) is accepted
only after its own collapse checks pass. New per-paper results are rejected and
the prior per-paper records are retained as stale. This keeps a valid profile
update without presenting a partial article list as complete. See the
[SerpApi Google Scholar Author API pagination parameters](https://serpapi.com/google-scholar-author-api#api-parameters-pagination).

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
