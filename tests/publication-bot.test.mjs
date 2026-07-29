import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addCandidateToFeed,
  applyInstructions,
  existingDois,
  isCandidateRoot,
  normalizeDoi,
  reactionDecision,
  suggestTopics
} from '../scripts/publication-bot.mjs';

test('normalizes and finds DOI values', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1000/ABC'), '10.1000/abc');
  const feed = "F('72', 'Title', 'Authors', 'j', 'Journal', ' (2026)', null, '10.1000/ABC')";
  assert.deepEqual([...existingDois(feed)], ['10.1000/abc']);
});

test('applies Korean review instructions deterministically', () => {
  const base = { title: 'Original', topics: ['Review'], journal: 'Journal' };
  const result = applyInstructions(base, [
    '라벨 제거: Review\n라벨 추가: GCMC, Reticular Materials',
    '제목: Revised title',
    '승인'
  ]);
  assert.equal(result.candidate.title, 'Revised title');
  assert.deepEqual(result.candidate.topics, ['Grand Canonical Monte Carlo', 'Reticular Materials']);
  assert.equal(result.approved, true);
});

test('review remains a single exclusive label', () => {
  const result = applyInstructions({ topics: ['Adsorption'] }, ['라벨 추가: Review, GCMC']);
  assert.deepEqual(result.candidate.topics, ['Review']);
});

test('recognizes current and legacy bot candidates without trusting user posts', () => {
  const text = '📄 신규 논문 후보\nDOI: 10.1000/example';
  assert.equal(isCandidateRoot({ user: 'U-BOT', text }, 'U-BOT'), true);
  assert.equal(isCandidateRoot({ user: 'U-OLD-BOT', bot_id: 'B-OLD', text }, 'U-BOT'), true);
  assert.equal(isCandidateRoot({ user: 'U-HUMAN', text }, 'U-BOT'), false);
});

test('maps authorized Slack reactions to approval and exclusion decisions', () => {
  const channel = 'C123';
  const timestamp = '123.456';
  const item = name => ({
    type: 'message',
    channel,
    message: { ts: timestamp, reactions: [{ name }] }
  });

  assert.deepEqual(
    reactionDecision([item('white_check_mark')], channel, timestamp),
    { approved: true, excluded: false, conflict: false }
  );
  assert.deepEqual(
    reactionDecision([item('no_entry_sign')], channel, timestamp),
    { approved: false, excluded: true, conflict: false }
  );
  assert.deepEqual(
    reactionDecision([item('white_check_mark'), item('no_entry_sign')], channel, timestamp),
    { approved: true, excluded: true, conflict: true }
  );
});

test('ignores reactions from other messages and unsupported emoji', () => {
  const items = [
    {
      type: 'message',
      channel: 'C123',
      message: { ts: 'other', reactions: [{ name: 'white_check_mark' }] }
    },
    {
      type: 'message',
      channel: 'C123',
      message: { ts: '123.456', reactions: [{ name: 'thumbsup' }] }
    }
  ];
  assert.deepEqual(
    reactionDecision(items, 'C123', '123.456'),
    { approved: false, excluded: false, conflict: false }
  );
});

test('suggests labels from title and abstract keywords', () => {
  const topics = suggestTopics('Machine learning and GCMC screening of MOFs for adsorption');
  assert.deepEqual(topics, ['Grand Canonical Monte Carlo', 'Machine Learning', 'Adsorption', 'Reticular Materials']);
});

test('suggests system and application labels for cyclic separation processes', () => {
  const topics = suggestTopics('Techno-economic evaluation of a PVSA process for biogas upgrading');
  assert.deepEqual(topics, [
    'Techno-Economic Analysis',
    'Cyclic Swing Adsorber',
    'Biogas Upgrading'
  ]);
});

test('suggests specific application labels instead of generic umbrellas', () => {
  assert.deepEqual(
    suggestTopics('Discovery of an adsorbent for ethane/ethylene separation'),
    ['Adsorption', 'Olefin/Paraffin Separation']
  );
  assert.deepEqual(
    suggestTopics('Solid-state electrolyte with high lithium-ion conductivity'),
    ['Diffusion', 'Electrochemistry', 'Electrolytes', 'Secondary Battery']
  );
});

test('classifies enhanced sampling as a computation method', () => {
  assert.deepEqual(
    suggestTopics('Flat-histogram Monte Carlo with macrostate probability distributions'),
    ['Grand Canonical Monte Carlo', 'Enhanced Sampling']
  );
});

test('inserts an approved candidate without changing existing entries', () => {
  const feed = "const PUBS = [\n  F('72', 'Old', 'A', 'j', 'J', ' (2026)', null, '10.1/old')\n];\nconst PUB_TOPICS = {\n  '72': ['Review']\n};";
  const candidate = {
    title: 'New paper', authors: 'Chung, Yongchul G.', journal: 'New Journal',
    meta: ', 1, 1–10 (2026)', doi: '10.2/new', topics: ['Grand Canonical Monte Carlo', 'Adsorption']
  };
  const updated = addCandidateToFeed(feed, candidate);
  assert.match(updated, /F\('73', 'New paper'/);
  assert.match(updated, /'73': \['Grand Canonical Monte Carlo', 'Adsorption'\]/);
  assert.match(updated, /F\('72', 'Old'/);
  assert.equal(addCandidateToFeed(updated, candidate), updated);
});
