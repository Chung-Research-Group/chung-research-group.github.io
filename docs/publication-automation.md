# Publication review automation

The publication monitor checks Crossref for works linked to ORCID
`0000-0002-7756-0589` and posts unseen DOI records to Slack channel
`C0BJ2607NGL`. Nothing is added to the website until an authorized Slack user
approves the candidate.

## Slack review controls

The bot adds two reactions to every candidate:

- ✅ (`white_check_mark`): approve the candidate
- 🚫 (`no_entry_sign`): exclude the candidate

Only reactions from users listed in `PUBLICATION_APPROVER_USER_IDS` are
accepted. If both reactions are selected, the bot does nothing. After approval,
the bot creates a GitHub PR; make any metadata or label corrections in that PR
before its next scheduled merge check.

Available labels are grouped as follows:

- Computation: `Density Functional Theory`, `Grand Canonical Monte Carlo`, `Molecular Dynamics`, `Enhanced Sampling`, `Data Curation`, `Machine Learning`, `Large Language Models`, `Infrastructure`, `Material Characterization`, `Techno-Economic Analysis`
- Physics: `Adsorption`, `Diffusion`, `Reaction`, `Electrochemistry`
- Materials: `Reticular Materials`, `Oxides`, `Polymers`, `Carbons`, `Graphene Oxide`, `Graphene Quantum Dots`, `Zeolites`, `Molecules`, `Electrolytes`, `Perovskites`
- Systems: `Membranes`, `Chiller`, `Cyclic Swing Adsorber`
- Applications: `Carbon Capture`, `Hydrogen Storage`, `Biogas Upgrading`, `Carbon Monoxide Separation`, `Natural Gas Sweetening`, `Noble Gas Separation`, `SF6/N2 Separation`, `Olefin/Paraffin Separation`, `Xylene Separation`, `Alkane Isomer Separation`, `Methane Storage`, `Adsorption Cooling`, `Secondary Battery`, `Supercapacitor`, `Organic Solvent Nanofiltration`, `Organic Liquid Separation`, `CO2 Conversion`, `Catalysis`, `Sensing`, `Air Pollution Control`, `Distillation`
- Special: `Review` (exclusive)

## Optional LLM label review

The monitor can use OpenAI or Gemini to review the title and abstract of a new
candidate. LLM classification is advisory: it may recommend only labels already
listed in the allowlist above. If the model identifies a potentially useful new
topic, the bot may show it in Slack as a topic candidate, but it never creates a
taxonomy label or changes the website automatically.

If the provider or API key is missing, the provider is set to `none`, or the API
request fails, the monitor falls back to the deterministic keyword classifier.
This keeps publication monitoring available without an LLM service.

## Graphical abstracts

Every approved DOI receives a deterministic visual summary during the production
build. The renderer uses only the publication title, journal, year, DOI, and the
reviewed website taxonomy. It does not copy publisher figures, infer molecular
structures, or make new scientific claims.

- Output: `images/publications/graphical-abstracts/<normalized-doi>.svg`
- Size: 1200 × 630
- Delivery: a collapsed, keyboard-accessible panel on the Publications page
- Loading: the SVG is requested only when a visitor opens the panel
- Fallback: the publication remains usable if its visual summary cannot load
- Provenance: every panel states that it is not the publisher's official
  graphical abstract

The output is deterministic, self-contained, and contains no scripts, remote
images, links, event handlers, or `foreignObject` content. CI regenerates and
validates one graphic per DOI. A newly approved publication therefore receives
its visual summary automatically without adding generated files to the review
PR.

To preview an existing or proposed DOI locally:

```bash
node scripts/publication-graphic.mjs --doi 10.xxxx/example --output-root dist
```

The command retrieves bibliographic metadata from Crossref, applies the same
bounded topic rules used by the publication monitor, and writes a single SVG.
Publisher artwork is deliberately not scraped because licensing, layout, and
access controls vary by journal.

Treat all Crossref and publisher metadata as untrusted input. Titles, abstracts,
authors, DOI fields, and model-generated text are data to classify, not
instructions to execute. Neither metadata nor an LLM response can approve or
exclude a publication. An authorized Slack reaction is the only approval or
exclusion signal.

Only users listed in `PUBLICATION_APPROVER_USER_IDS` are considered. After
approval, the bot creates or updates a publication PR. It merges the PR only
after the `Validate and deploy website` workflow succeeds.

## Required Slack app

Create a Slack app, install it to the MTAP workspace, and invite it to the
publication-review channel. Grant these bot token scopes:

- `channels:history` for a public channel, or `groups:history` for a private channel
- `chat:write`
- `reactions:read`
- `reactions:write`

The workflow only reads the configured channel, verifies reactions, and posts
candidate and PR-status messages. `reactions:read` is used to verify reactions
from configured approvers, while `reactions:write` lets the bot add the ✅ and
🚫 controls. It does not need workspace-wide message search or access to thread
replies. Existing candidate messages from an earlier installation of the same
review bot remain supported after the app is reinstalled. Slack's
API-normalized `:page_facing_up:` candidate prefix is treated the same as the
visible 📄 emoji.

## Repository configuration

Configure these settings in GitHub:

1. Secret `PUBLICATION_SLACK_BOT_TOKEN`: the Slack bot token (`xoxb-...`).
2. Secret `PUBLICATION_GITHUB_TOKEN`: a fine-grained token limited to this
   repository with Contents and Pull requests read/write plus Actions read.
   A separate token is required because PRs created with the workflow's default
   token do not trigger the validation workflow.
3. Variable `PUBLICATION_APPROVER_USER_IDS`: comma-separated Slack member IDs
   allowed to edit and approve candidates.
4. Variable `CROSSREF_MAILTO`: contact email for the Crossref polite pool.

Optional LLM setup:

1. Create repository secret `PUBLICATION_LLM_API_KEY` with the API key for the
   selected provider.
2. Create repository variable `PUBLICATION_LLM_PROVIDER` with one of `openai`,
   `gemini`, or `none`. Leave it unset or use `none` to disable LLM review.
3. Optionally create repository variable `PUBLICATION_LLM_MODEL`. When omitted,
   OpenAI uses `gpt-5.4-nano-2026-03-17` and Gemini uses
   `gemini-3.5-flash-lite`.
4. Run **Monitor publications and process Slack approvals** manually and confirm
   that a candidate still requires an authorized reaction before a PR is
   created.

The workflow passes the API key only as a masked GitHub Actions secret. The bot
must never print the key, request headers, or a full environment dump to logs.
Provider API calls may incur charges even when a candidate is later excluded.
Review the provider's current pricing and rate limits, configure a conservative
spend cap, and keep the default low-cost model unless classification quality
requires a more capable model.

Run **Monitor publications and process Slack approvals** manually once after
configuration. Scheduled checks run every 30 minutes.

## Safety and limitations

- DOI values already present in `feed.js` are ignored.
- ChemRxiv DOI records are not announced or added. When a preprint has a
  peer-reviewed version, the journal DOI in `feed.js` remains the canonical
  website record.
- Normalized publication titles are also checked before announcing a candidate.
  This prevents duplicate cards when Crossref supplies a different DOI or uses
  `metal-organic framework(s)` instead of `MOF(s)`.
- Crossref only returns ORCID-linked records when the publisher deposited the
  ORCID in its metadata. Google Scholar alerts remain useful as a fallback.
- Label suggestions use the configured LLM when available and otherwise use the
  deterministic keyword classifier. Both paths are advisory, restricted to the
  existing allowlist, and subject to Slack review.
- Approval and exclusion reactions are accepted only from configured Slack
  approvers. Slack text, metadata, and LLM output never authorize a change;
  conflicting reactions never change GitHub.
- Review papers always receive the single `Review` label.
- The bot never writes directly to `main`; it uses a PR and waits for CI.

