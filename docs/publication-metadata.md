# Publication metadata enrichment

The website stores citation and research-discovery metadata in
`data/publication-metadata.json`. Visitors read this static snapshot instead of
making one external API request per publication.

## Sources

- Semantic Scholar Graph API: citation and influential-citation counts,
  reference counts, publication types, and fields of study.
- OpenAlex Works API: citation counts, topics, field hierarchy, keywords,
  citation percentiles, and yearly citation counts.

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

OpenAlex may currently answer some anonymous requests, but that behavior is not
a production contract. The retired `mailto` polite-pool parameter is not used.

`snapshotUpdatedAt` records when the committed snapshot content or health last
changed. Each source's `contentUpdatedAt` records when that source's retained
publication records last changed; it is not updated merely because a scheduled
request succeeded.

Run a local refresh with:

```text
node scripts/refresh-publication-metadata.mjs
```

Validate the committed schema and DOI coverage without calling either API:

```text
node scripts/refresh-publication-metadata.mjs --check
```
