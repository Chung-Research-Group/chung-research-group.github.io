# Publication citation exports

The Publications page provides two deterministic, downloadable catalogs:

- `exports/publications/publications.bib` for BibTeX
- `exports/publications/CITATION.cff` for Citation File Format 1.2.0

`feed.js` remains the authority for which publications appear on the website,
their order, DOI, display title, and reviewed taxonomy. Structured citation
fields come from the committed Crossref snapshot in
`data/publication-bibliography.json`, keyed by normalized DOI. The build requires
the snapshot and feed to contain exactly the same DOI set.

The CFF file describes the downloadable publication catalog as a dataset and
lists the individual DOI articles under `references`. It is intentionally not a
root-level repository `CITATION.cff`, because readers should cite the individual
papers rather than the website repository.

## Refresh and build

Refresh the committed Crossref snapshot explicitly:

```text
node scripts/publication-citations.mjs --refresh
```

Then generate and validate both exports offline:

```text
npm run check
```

Normal builds and CI never contact Crossref. This keeps pull-request checks
deterministic and prevents a provider outage or rate limit from breaking the
site. The refresh command uses `CROSSREF_MAILTO` when configured, caches the
structured response in the committed snapshot, and applies bounded retries.

KISTI DOI records that Crossref cannot resolve are looked up through DOI.org
during the explicit refresh only. That fallback is never used by the browser,
build, or CI. Incomplete records must be reviewed and corrected in the snapshot;
the generator does not substitute display-only author strings containing `*`,
`#`, or `et al.`.

New publications approved through Slack update both `feed.js` and the
bibliography snapshot in the same publication PR. Citation exports are generated
from that reviewed state during deployment, so they cannot drift silently from
the website list.
