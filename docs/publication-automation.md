# Publication review automation

The publication monitor checks Crossref for works linked to ORCID
`0000-0002-7756-0589` and posts unseen DOI records to Slack channel
`C0BJ2607NGL`. Nothing is added to the website until an authorized Slack user
approves the candidate.

## Slack commands

Reply in the candidate's Slack thread. Multiple commands can be placed on
separate lines.

- `라벨 추가: GCMC, Adsorption`
- `라벨 제거: Review`
- `제목: Corrected title`
- `저널: Corrected journal`
- `저자: Corrected author list`
- `서지: , 12, 100–110 (2026)`
- `제외`
- `승인`

Only users listed in `PUBLICATION_APPROVER_USER_IDS` are considered. After
approval, the bot creates or updates a publication PR. It merges the PR only
after the `Validate and deploy website` workflow succeeds.

## Required Slack app

Create a Slack app, install it to the MTAP workspace, and invite it to the
publication-review channel. Grant these bot token scopes:

- `channels:history` for a public channel, or `groups:history` for a private channel
- `chat:write`

The workflow only reads the configured channel and posts messages and thread
replies there. It does not need workspace-wide message search.

## Repository configuration

Configure these settings in GitHub:

1. Secret `PUBLICATION_SLACK_BOT_TOKEN`: the Slack bot token (`xoxb-...`).
2. Variable `PUBLICATION_APPROVER_USER_IDS`: comma-separated Slack member IDs
   allowed to edit and approve candidates.
3. Variable `CROSSREF_MAILTO`: contact email for the Crossref polite pool.

Run **Monitor publications and process Slack approvals** manually once after
configuration. Scheduled checks run every 30 minutes.

## Safety and limitations

- DOI values already present in `feed.js` are ignored.
- Crossref only returns ORCID-linked records when the publisher deposited the
  ORCID in its metadata. Google Scholar alerts remain useful as a fallback.
- Label suggestions are deterministic keyword suggestions. The Slack review is
  the authoritative classification step.
- Review papers always receive the single `Review` label.
- The bot never writes directly to `main`; it uses a PR and waits for CI.
