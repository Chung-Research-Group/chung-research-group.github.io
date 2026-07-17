import { pathToFileURL } from 'node:url';

export const TOPICS = [
  'DFT', 'GCMC', 'MD', 'Data Curation', 'Machine Learning', 'LLM',
  'Infrastructure', 'Characterization', 'Techno-Economic Analysis',
  'Adsorption', 'Transport', 'Reaction', 'Statistical Mechanics', 'Electrochemistry',
  '2D', 'Reticular Materials', 'Oxides', 'Polymers', 'Carbons', 'Zeolites',
  'Molecules', 'Electrolytes', 'Perovskites', 'Membranes',
  'Chiller', 'Cyclic Swing Adsorber',
  'Carbon Capture', 'Hydrogen Storage', 'Biogas Upgrading',
  'Carbon Monoxide Separation', 'Natural Gas Sweetening', 'Noble Gas Separation',
  'SF6/N2 Separation', 'Olefin/Paraffin Separation', 'Xylene Separation',
  'Alkane Isomer Separation', 'Methane Storage', 'Adsorption Cooling',
  'Secondary Battery', 'Supercapacitor', 'Organic Solvent Nanofiltration',
  'Organic Liquid Separation',
  'CO2 Conversion', 'Catalysis', 'Sensing', 'Air Pollution Control', 'Distillation',
  'Review'
];

const TOPIC_LOOKUP = new Map(TOPICS.map(topic => [topic.toLowerCase(), topic]));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function normalizeDoi(value = '') {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
}

export function existingDois(feed) {
  return new Set([...feed.matchAll(/'((?:10\.)[^']+)'\)/gi)].map(match => normalizeDoi(match[1])));
}

function cleanText(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function crossrefDate(work) {
  const parts = work['published-print']?.['date-parts']?.[0]
    || work['published-online']?.['date-parts']?.[0]
    || work.published?.['date-parts']?.[0]
    || [];
  return { year: String(parts[0] || ''), month: String(parts[1] || '').padStart(2, '0') };
}

function authorName(author) {
  const name = [author.family, author.given].filter(Boolean).join(', ');
  return name || author.name || '';
}

export function candidateFromCrossref(work) {
  const { year } = crossrefDate(work);
  const title = cleanText(work.title?.[0]);
  const journal = cleanText(work['container-title']?.[0]) || 'Journal article';
  const authors = (work.author || []).map(authorName).filter(Boolean).join(', ');
  const pieces = [work.volume, work.issue, work.page || work['article-number']].filter(Boolean);
  const meta = `${pieces.length ? `, ${pieces.join(', ')}` : ''}${year ? ` (${year})` : ''}`;
  const abstract = cleanText(work.abstract);
  return {
    doi: normalizeDoi(work.DOI), title, journal, authors, meta, year, abstract,
    topics: suggestTopics(`${title} ${abstract}`)
  };
}

export function suggestTopics(text) {
  const value = text.toLowerCase();
  const rules = [
    ['DFT', /density functional|\bdft\b|first.principles/],
    ['GCMC', /grand canonical|\bgcmc\b|monte carlo/],
    ['MD', /molecular dynamics|\bmd simulation/],
    ['Data Curation', /database|dataset|data curation|curated data/],
    ['Machine Learning', /machine learning|neural network|graph network|deep learning/],
    ['LLM', /large language model|\bllm\b/],
    ['Infrastructure', /software|workflow|platform|toolkit|graphical user interface/],
    ['Characterization', /characterization|spectroscop|diffraction|\bbet\b/],
    ['Techno-Economic Analysis', /techno.economic|economic analysis/],
    ['Adsorption', /adsorp|sorbent|isotherm/],
    ['Transport', /transport|diffusion|permeab|conductiv/],
    ['Reaction', /reaction|cataly|conversion/],
    ['Statistical Mechanics', /statistical mechanic|thermodynamic|free energy/],
    ['Electrochemistry', /electrochem|battery|capacitor|electrolyte|electrode/],
    ['2D', /two.dimensional|\b2d\b|graphene/],
    ['Reticular Materials', /metal.organic framework|\bmofs?\b|covalent organic framework|\bcofs?\b|porous aromatic framework|\bpafs?\b|\bzifs?\b/],
    ['Oxides', /\boxides?\b|perovskite/],
    ['Polymers', /polymer|polyimide|macromolecul/],
    ['Carbons', /porous carbon|graphene|carbonaceous/],
    ['Zeolites', /zeolite/],
    ['Molecules', /molecular liquid|molecule|small.molecule/],
    ['Electrolytes', /electrolyte|ionic liquid/],
    ['Perovskites', /perovskite/],
    ['Membranes', /membrane|nanofiltration/],
    ['Chiller', /adsorption chiller|adsorption cooling/],
    ['Cyclic Swing Adsorber', /swing adsorption|pressure swing|temperature swing|vacuum swing|\bpsa\b|\bvsa\b|\btsa\b|\bpvsa\b/],
    ['Carbon Capture', /carbon capture|co2 capture|direct air capture|post.combustion|precombustion/],
    ['Hydrogen Storage', /hydrogen storage|h2 storage/],
    ['Biogas Upgrading', /biogas upgrading|biomethane/],
    ['Carbon Monoxide Separation', /carbon monoxide separation|\bco separation/],
    ['Natural Gas Sweetening', /natural gas sweetening|acid gas removal|h2s.*co2.*ch4/],
    ['Noble Gas Separation', /noble gas separation|xe\/kr|xenon.*krypton/],
    ['SF6/N2 Separation', /sf6\/n2|sulfur hexafluoride.*nitrogen/],
    ['Olefin/Paraffin Separation', /olefin.paraffin|ethane.*ethylene|ethylene.*ethane/],
    ['Xylene Separation', /xylene separation|p.xylene selectiv/],
    ['Alkane Isomer Separation', /alkane isomer|hexane.*heptane/],
    ['Methane Storage', /methane storage|natural gas storage|lng.ang/],
    ['Adsorption Cooling', /adsorption (?:cooling|chiller)|water adsorption chiller/],
    ['Secondary Battery', /secondary battery|lithium.ion|zinc metal anode|solid.state electrolyte|ionic conductivity/],
    ['Supercapacitor', /supercapacitor|ion capacitor/],
    ['Organic Solvent Nanofiltration', /organic solvent nanofiltration/],
    ['Organic Liquid Separation', /organic liquid separation/],
    ['CO2 Conversion', /co2 conversion|co2 fixation|cycloaddition|cyclic carbonate/],
    ['Catalysis', /cataly|catalytic/],
    ['Sensing', /sensor|sensing|detection/],
    ['Air Pollution Control', /removal of no|removal of so2|air pollution/],
    ['Distillation', /distillation/],
    ['Review', /\breview\b|perspective|progress in/]
  ];
  const topics = rules.filter(([, pattern]) => pattern.test(value)).map(([topic]) => topic);
  return topics.includes('Review') ? ['Review'] : topics;
}

function topicList(value) {
  return value.split(/[,，]/).map(item => item.trim()).filter(Boolean).map(item => {
    const topic = TOPIC_LOOKUP.get(item.toLowerCase());
    if (!topic) throw new Error(`Unknown publication label: ${item}`);
    return topic;
  });
}

export function applyInstructions(base, messages) {
  const candidate = structuredClone(base);
  candidate.topics = [...new Set(candidate.topics || [])];
  let approved = false;
  let excluded = false;
  const errors = [];

  for (const raw of messages) {
    const text = String(raw || '').trim();
    if (!text) continue;
    try {
      for (const line of text.split(/\n+/).map(value => value.trim()).filter(Boolean)) {
        let match;
        if (/^(승인|approve)$/i.test(line)) approved = true;
        else if (/^(제외|무시|reject)$/i.test(line)) excluded = true;
        else if ((match = line.match(/^(?:라벨\s*추가|add\s*labels?)\s*:\s*(.+)$/i))) {
          candidate.topics.push(...topicList(match[1]));
        } else if ((match = line.match(/^(?:라벨\s*제거|remove\s*labels?)\s*:\s*(.+)$/i))) {
          const remove = new Set(topicList(match[1]));
          candidate.topics = candidate.topics.filter(topic => !remove.has(topic));
        } else if ((match = line.match(/^(제목|title)\s*:\s*(.+)$/i))) candidate.title = match[2].trim();
        else if ((match = line.match(/^(저널|journal)\s*:\s*(.+)$/i))) candidate.journal = match[2].trim();
        else if ((match = line.match(/^(저자|authors?)\s*:\s*(.+)$/i))) candidate.authors = match[2].trim();
        else if ((match = line.match(/^(서지|meta)\s*:\s*(.+)$/i))) candidate.meta = match[2].trim();
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  candidate.topics = [...new Set(candidate.topics)];
  if (candidate.topics.includes('Review')) candidate.topics = ['Review'];
  return { candidate, approved, excluded, errors };
}

function js(value) {
  return `'${String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')}'`;
}

export function addCandidateToFeed(feed, candidate) {
  if (existingDois(feed).has(normalizeDoi(candidate.doi))) return feed;
  const numbers = [...feed.matchAll(/F\('(\d+)'/g)].map(match => Number(match[1]));
  const no = String(Math.max(0, ...numbers) + 1).padStart(2, '0');
  const article = `  F(${js(no)}, ${js(candidate.title)}, ${js(candidate.authors)}, 'auto', ${js(candidate.journal)}, ${js(candidate.meta)}, null, ${js(candidate.doi)}),\n`;
  const topics = `  ${js(no)}: [${candidate.topics.map(js).join(', ')}],\n`;
  let next = feed.replace('const PUBS = [\n', `const PUBS = [\n${article}`);
  next = next.replace('const PUB_TOPICS = {\n', `const PUB_TOPICS = {\n${topics}`);
  return next;
}

function slugForDoi(doi) {
  return normalizeDoi(doi).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  if (!response.ok || data.ok === false) throw new Error(`${options.method || 'GET'} ${url}: ${response.status} ${data.error || data.message || text}`);
  return data;
}

function slackClient(token) {
  return async (method, body = {}) => jsonRequest(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
}

function githubClient(token, repository) {
  const base = `https://api.github.com/repos/${repository}`;
  return async (path, options = {}) => jsonRequest(`${base}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(options.headers || {})
    }
  });
}

async function crossrefWorks(orcid, mailto) {
  const from = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    filter: `orcid:${orcid},from-index-date:${from}`,
    rows: '100',
    select: 'DOI,title,author,container-title,published-print,published-online,published,volume,issue,page,article-number,type,abstract'
  });
  if (mailto) params.set('mailto', mailto);
  const data = await jsonRequest(`https://api.crossref.org/works?${params}`, {
    headers: { 'user-agent': `ChungResearchPublicationBot/1.0 (mailto:${mailto || 'website@pusan.ac.kr'})` }
  });
  return data.message?.items || [];
}

function candidateMessage(candidate) {
  const labels = candidate.topics.length ? candidate.topics.join(', ') : '(라벨 미지정)';
  return [
    '📄 신규 논문 후보',
    `*${candidate.title}*`,
    `저자: ${candidate.authors}`,
    `저널: ${candidate.journal}${candidate.meta}`,
    `DOI: ${candidate.doi}`,
    `추천 라벨: ${labels}`,
    '',
    '이 스레드에 수정 지시를 남겨주세요.',
    '`라벨 추가: GCMC, Adsorption` · `라벨 제거: Review`',
    '`제목: ...` · `저널: ...` · `저자: ...` · `서지: ...`',
    '반영하지 않으려면 `제외`, 확정하려면 `승인`'
  ].join('\n');
}

function doiFromMessage(text) {
  return normalizeDoi(text.match(/DOI:\s*([^\s>]+)/i)?.[1]);
}

async function getFeed(github, ref = 'main') {
  const file = await github(`/contents/feed.js?ref=${encodeURIComponent(ref)}`);
  return { content: Buffer.from(file.content, 'base64').toString('utf8'), sha: file.sha };
}

async function crossrefByDoi(doi) {
  const data = await jsonRequest(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  return data.message;
}

async function createOrUpdatePr(github, repository, candidate) {
  const [owner] = repository.split('/');
  const branch = `publication/${slugForDoi(candidate.doi)}`;
  const baseRef = await github('/git/ref/heads/main');
  let branchExists = true;
  try { await github(`/git/ref/heads/${encodeURIComponent(branch)}`); }
  catch { branchExists = false; }
  if (!branchExists) {
    await github('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }) });
  }

  const mainFeed = await getFeed(github, 'main');
  const branchFeed = await getFeed(github, branch);
  const content = addCandidateToFeed(mainFeed.content, candidate);
  if (content !== branchFeed.content) {
    await github('/contents/feed.js', {
      method: 'PUT',
      body: JSON.stringify({
        message: `Add publication ${candidate.doi}`,
        branch,
        sha: branchFeed.sha,
        content: Buffer.from(content).toString('base64')
      })
    });
  }

  const pulls = await github(`/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (pulls[0]) return pulls[0];
  return github('/pulls', {
    method: 'POST',
    body: JSON.stringify({
      title: `Add publication: ${candidate.title}`,
      head: branch,
      base: 'main',
      body: `## Publication\n\n- **Title:** ${candidate.title}\n- **Journal:** ${candidate.journal}\n- **DOI:** https://doi.org/${candidate.doi}\n- **Labels:** ${candidate.topics.join(', ') || 'None'}\n\nApproved from the configured Slack publication-review channel.`,
      maintainer_can_modify: true
    })
  });
}

async function checksPassed(github, sha) {
  const runs = await github(`/actions/runs?head_sha=${sha}&event=pull_request&per_page=20`);
  const relevant = (runs.workflow_runs || []).filter(run => run.name === 'Validate and deploy website');
  if (!relevant.length || relevant.some(run => run.status !== 'completed')) return false;
  if (relevant.some(run => run.conclusion !== 'success')) throw new Error('The publication PR CI failed; review the PR before merging.');
  return true;
}

async function run() {
  const slackToken = required('SLACK_BOT_TOKEN');
  const channel = required('SLACK_CHANNEL_ID');
  const orcid = required('PUBLICATION_ORCID').replace(/^https?:\/\/orcid\.org\//, '');
  const githubToken = required('GITHUB_TOKEN');
  const repository = required('GITHUB_REPOSITORY');
  const approvers = new Set(required('PUBLICATION_APPROVER_USER_IDS').split(',').map(value => value.trim()).filter(Boolean));
  const slack = slackClient(slackToken);
  const github = githubClient(githubToken, repository);
  const botAuth = await slack('auth.test');
  const botUser = botAuth.user_id;

  const history = await slack('conversations.history', { channel, limit: 200, include_all_metadata: true });
  const roots = history.messages || [];
  const feed = await getFeed(github, 'main');
  const known = existingDois(feed.content);
  const announced = new Set(roots.map(message => doiFromMessage(message.text)).filter(Boolean));

  for (const work of await crossrefWorks(orcid, process.env.CROSSREF_MAILTO)) {
    const candidate = candidateFromCrossref(work);
    if (!candidate.doi || known.has(candidate.doi) || announced.has(candidate.doi)) continue;
    await slack('chat.postMessage', { channel, text: candidateMessage(candidate), unfurl_links: false, unfurl_media: false });
  }

  for (const root of roots.filter(message => message.user === botUser && message.text?.startsWith('📄 신규 논문 후보'))) {
    const doi = doiFromMessage(root.text);
    if (!doi || known.has(doi)) continue;
    const thread = await slack('conversations.replies', { channel, ts: root.ts, limit: 200 });
    const userReplies = (thread.messages || []).slice(1).filter(message => approvers.has(message.user));
    const work = await crossrefByDoi(doi);
    const state = applyInstructions(candidateFromCrossref(work), userReplies.map(message => message.text));
    if (state.errors.length) {
      await slack('chat.postMessage', { channel, thread_ts: root.ts, text: `⚠️ 지시를 처리하지 못했습니다: ${state.errors.join('; ')}` });
      continue;
    }
    if (state.excluded) {
      if (!thread.messages.some(message => message.user === botUser && message.text?.includes('후보에서 제외했습니다'))) {
        await slack('chat.postMessage', { channel, thread_ts: root.ts, text: '🚫 이 논문을 자동 반영 후보에서 제외했습니다.' });
      }
      continue;
    }
    if (!state.approved) continue;

    const pr = await createOrUpdatePr(github, repository, state.candidate);
    const marker = `PR #${pr.number}`;
    if (!thread.messages.some(message => message.user === botUser && message.text?.includes(marker))) {
      await slack('chat.postMessage', {
        channel,
        thread_ts: root.ts,
        text: `✅ 승인 내용을 반영한 ${marker}을 생성했습니다: ${pr.html_url}\nCI 통과 후 자동 병합합니다.`
      });
    }

    const fresh = await github(`/pulls/${pr.number}`);
    if (await checksPassed(github, fresh.head.sha)) {
      const merged = await github(`/pulls/${pr.number}/merge`, {
        method: 'PUT',
        body: JSON.stringify({
          sha: fresh.head.sha,
          merge_method: 'squash',
          commit_title: `Add publication: ${state.candidate.title}`
        })
      });
      if (merged.merged) {
        await slack('chat.postMessage', { channel, thread_ts: root.ts, text: `🚀 ${marker} CI 통과 및 main 병합 완료: ${pr.html_url}` });
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
