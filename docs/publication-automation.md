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
- Label suggestions are deterministic keyword suggestions. The Slack review is
  the authoritative classification step.
- Approval and exclusion reactions are accepted only from configured Slack
  approvers. Conflicting reactions never change GitHub.
- Review papers always receive the single `Review` label.
- The bot never writes directly to `main`; it uses a PR and waits for CI.
