# Lab statistics

The Statistics page reads `data/lab-statistics.json`, a deterministic schema
version 4 snapshot created during the site build. The browser never calls
publication, citation, people, or journal-metric APIs.

## Sources and derivation

- `feed.js` is authoritative for the curated publication list, publication
  type, year, journal display name, and reviewed research categories.
- `data/publication-bibliography.json` supplies the public author metadata used
  for the collaboration network.
- `data/publication-metadata.json` supplies separate citation snapshots from
  Google Scholar, OpenAlex, and Semantic Scholar. It also supplies the Google
  Scholar h-index when that profile metric has been refreshed successfully.
- `people-data.js` supplies aggregate counts for current lab roles.

`scripts/lab-statistics.mjs` derives the following at build time:

- continuous publication counts from the first publication year through the
  current year, including zero-publication years and a current-year partial
  flag;
- article and review totals;
- journal distribution, with every catalogue publication counted once;
- overlapping research-area counts;
- source-specific citation totals plus annual and cumulative citation trends;
- Google Scholar h-index and recent-period h-index, when available;
- authorized, aggregate-only previous-year JCR standing bands, when
  historical ranking data and separate public-display permission are supplied;
- a bounded public coauthor network; and
- aggregate current-team role counts.

The generated file is written only to `dist/data/lab-statistics.json`; it is not
committed as a second source of truth.

Research categories overlap because one publication may use multiple methods,
materials, systems, or applications. Category counts therefore must not be
interpreted as percentages or added together. Citation providers also differ in
coverage and update timing, so their totals remain separate and are never
summed into a combined citation count.

## Citation histories and reconciliation

Google Scholar, OpenAlex, and Semantic Scholar remain separate sources
throughout the generated snapshot and dashboard. Each source keeps its own
provider, freshness/availability status, catalogue coverage, current total,
and citation-year history. A stale last-known Google Scholar total is not
presented as a current OpenAlex or Semantic Scholar value, and an unavailable
year history is not inferred from another provider.

When a provider supplies citation counts by year, the generator publishes both
the normalized annual series and a cumulative series calculated only as the
running sum of those provider-assigned annual counts. It also reconciles the
annual sum against that provider's current total:

- if the current total is higher, the difference is labelled as citations
  without a provider-assigned year;
- if the annual sum is higher, the discrepancy is retained and disclosed as a
  provider revision/reconciliation mismatch; and
- if no year series is supplied, annual and cumulative history are explicitly
  unavailable even when a current total exists.

The generator never adds a reconciliation difference to the latest year (or
any other year) merely to make the cumulative line equal the current total.
For example, an OpenAlex total of 5,700 with 5,699 citations assigned to years
ends the cumulative series at 5,699 and reports one unassigned citation
separately. The annual/cumulative selector changes only the view of the same
source-specific provider-year records.

## Journal distribution

Each publication is counted once using the journal name recorded in `feed.js`.
Names are grouped case-insensitively, and the generated journal counts must sum
exactly to the publication total. This is a publication distribution, not a
journal-quality ranking.

## Public coauthor network

The collaboration graph is derived only from names already published in
`data/publication-bibliography.json`. It contains no email addresses, profile
URLs, affiliations, or other contact data.

The graph is intentionally bounded to 25 nodes and 80 edges for readability.
It shows the principal investigator plus the strongest catalogue
collaborations, so it is a visual summary rather than a complete authorship
graph. Names are matched conservatively using ORCID when available and a
normalized public name otherwise. Name variants, missing ORCIDs, or two
different researchers with the same name can still affect identity resolution.
Node and edge weights count distinct catalogue publications, not all-time
collaboration outside this website.

## h-index

The h-index card always identifies its source, method, coverage, and update
time. A current or last-known Google Scholar profile metric is preferred. When
that value is unavailable, the generator may publish an explicitly labelled
OpenAlex-derived catalogue h-index computed only from the publications matched
to this site's curated bibliography. The fallback is not presented as a Google
Scholar or all-time researcher metric. Values from different services should
not be compared as if their coverage were equivalent.

## Journal Impact Factor

Journal Impact Factor (JIF) is a Clarivate Journal Citation Reports (JCR)
journal-level metric. Accurate automated values require an authorized,
licensed JCR data source. The dashboard therefore reports cumulative JIF as
unavailable unless such a source is explicitly configured; it never relabels
OpenAlex citedness, CiteScore, SJR, or another proxy as JIF.

For an authorized build, create a GitHub Actions repository secret named
`JOURNAL_IMPACT_FACTORS_JSON` under **Settings → Secrets and variables →
Actions**. Its value must be the licensed aggregate-input JSON accepted by
`scripts/lab-statistics.mjs`. The Pages workflow supplies the secret only to a
trusted `main` push or an explicitly dispatched workflow; pull-request checks
receive an empty value. Do not commit the JSON or print it in build logs.

The secret is one JSON object with these base fields:

- `metric`: the literal string `Journal Impact Factor`;
- `provider`: a nonempty licensed Clarivate/JCR provider description;
- `licenseConfirmed`: `true`;
- `aggregatePublicationAuthorized`: `true`;
- `updatedAt`: the licensed source's ISO timestamp;
- `edition`: the JCR metric year, edition, or historical extract description.

`factorsByDoi` is optional. When supplied, it maps normalized catalogue DOI
strings to nonnegative finite numeric JIF values. An absent or empty
`factorsByDoi` map leaves cumulative JIF unavailable, while still allowing a
separately authorized historical-ranking aggregate to be generated. This
supports a ranking-only licensed extract without inventing a JIF total.

The generated public snapshot contains only the cumulative total, publication
coverage, metric year/edition, source provenance, and update time. It must not
contain or redistribute DOI-level or journal-level licensed JCR values. Before
enabling the secret, confirm that the applicable Clarivate/JCR license permits
publication of those aggregate outputs. If it does not, leave the secret unset
and the dashboard will explicitly show JIF as unavailable.

The cumulative value is calculated as the sum of the licensed journal-level
JIF assigned to each catalogue publication with an authorized DOI match. Each
publication contributes once, so multiple catalogue publications in the same
journal each contribute that journal's JIF. Publications without an authorized
match are excluded rather than treated as zero, and the result is labelled
partial whenever coverage is incomplete.

Even when licensed JCR data is configured, the cumulative sum discloses its
source date and publication coverage. JIF describes journals rather than the
quality of individual articles or researchers, so this aggregate is contextual
journal information only and must not be presented as an article-quality or
researcher-performance score. See Clarivate's [Journal Citation Reports
overview](https://clarivate.com/academia-government/scientific-and-academic-research/research-funding-analytics/journal-citation-reports/)
and [Web of Science Journals API
documentation](https://developer.clarivate.com/apis/wos-journal).

## Previous-year JCR standing

The journal-standing panel uses the previous-year JCR policy requested for this
site: publication year `Y` maps to JCR year `Y-1`. For example, a 2026
publication must use 2025 JCR and a 2025 publication must use 2024 JCR. Each
ranking record must therefore use `jcrYear` exactly one less than that
publication's year in `feed.js`. This is an explicit comparison policy, not an
inference that the journal's standing remained unchanged. JCR data matching the
publication year, the latest/current edition, CiteScore, SJR, or a
citation-based proxy is never substituted when the required year `Y-1` is
unavailable.

Public display of JIF ranks, quartiles, percentiles, or derived Top bands may
require permission beyond ordinary API access. The feature therefore fails
closed. To publish any ranking band counts, the licensed input must include all
of the following:

- `aggregateRankingDisplayAuthorized`: `true`, set only after confirming
  permission for these public aggregate ranking bands;
- `rankingAuthorizationReference`: a nonempty public permission reference;
- `rankingAuthorizationDate`: the permission date; and
- `rankingsByDoi`: an object keyed by normalized catalogue DOI.

If the authorization flag is absent or false, the public snapshot contains an
unavailable state and an empty `bands` array even when the private input
contains ranking records. The permission reference and date are also omitted.
They are copied into the public provenance only when the authorization flag is
true. Consult the applicable Clarivate agreement rather than assuming that a
JCR API subscription authorizes public display.

Each `rankingsByDoi` value has this shape:

```json
{
  "jcrYear": 2024,
  "categories": [
    {
      "category": "Example JCR category",
      "rank": 4,
      "categoryTotal": 100,
      "quartile": "Q1",
      "jifPercentile": 96.5
    }
  ]
}
```

The generator requires one or more categories, positive integer rank and
category total, `rank <= categoryTotal`, an official `Q1`–`Q4` value consistent
with rank divided by category total, and a finite percentile from 0 to 100. It
also compares the supplied percentile with Clarivate's published midpoint
formula `(N - R + 0.5) / N * 100`, allowing one percentage point for source
rounding or tied-rank presentation while rejecting obvious drift. No missing
rank, denominator, quartile, percentile, category, or historical year is
inferred.

In the example above, `jcrYear: 2024` is valid only for a publication whose
`feed.js` year is 2025. A 2024 publication would require `jcrYear: 2023`.

For a journal assigned to multiple JCR categories, the aggregate uses only the
maximum supplied JIF percentile to place that publication in one band. The
bands are mutually exclusive:

- Top 1%: percentile at least 99;
- Top 5%: at least 95 and below 99;
- Top 10%: at least 90 and below 95;
- Other Q1: at least 75 and below 90;
- Q2: at least 50 and below 75;
- Q3: at least 25 and below 50;
- Q4: below 25; and
- Unavailable: no authorized previous-year (`Y-1`) JCR ranking.

The eight counts sum to the catalogue publication total whenever licensed
ranking aggregates are authorized. The public `journalStanding` object contains
only those aggregate counts, coverage, source/edition/update provenance,
authorization evidence, the previous-year basis, and an availability
reason. It never contains a DOI, journal, category, rank, category denominator,
quartile, or percentile row. With no JCR secret—or without explicit aggregate
ranking display permission—the dashboard renders an honest unavailable message
and no ranking bars.

Clarivate documents the JIF percentile calculation in
[Many flavors of the Journal Impact Factor](https://clarivate.com/academia-government/blog/many-flavors-journal-impact-factor/)
and the rank-based quartile boundaries in the
[JCR glossary](https://journalcitationreports.zendesk.com/hc/en-gb/articles/28351666061457-Glossary).

## Privacy

Current-team statistics remain aggregate role counts only. The dashboard does
not include student-level publication or citation rankings, contact details,
placement rates, or small-subgroup performance comparisons. The only individual
names in the snapshot are public publication authors used for the explicitly
labelled collaboration graph. Public visitor analytics are not inferred from
repository or publication metadata and are outside this dataset.

## Validation

Run the complete offline generation and source/build comparison with:

```text
npm run check
```

CI verifies publication and journal arithmetic, the continuous year range,
nonnegative overlapping category counts, independent citation sources, annual
and cumulative citation arithmetic, explicit reconciliation deltas, h-index
availability rules, official-source requirements for any JIF value, bounded
graph endpoints and unique identifiers, exactly one principal investigator
node, derivation of coauthor labels from the public bibliography, absence of
contact data in the graph, and aggregate team totals. Adding or approving a
publication updates the publication, journal, research-area, and coauthor
sections on the next successful site build. Journal Impact Factor coverage
changes only when the separately authorized DOI-keyed JCR input is updated;
missing JIF records remain unavailable rather than being inferred. Historical
JCR standing validation additionally checks exact `publication year - 1`
equality,
rank/denominator arithmetic, official quartile and percentile consistency,
exclusive-band accounting including Q4 and unavailable, explicit public-display
permission evidence, and absence of licensed DOI/category/rank rows from the
public snapshot.
