import { expect, test } from '@playwright/test';
import vm from 'node:vm';

const pages = [
  'index.html', 'News.dc.html', 'People.dc.html',
  'Software%20%26%20Data.dc.html', 'Publications.dc.html', 'Join%20Us.dc.html',
  'AIM.dc.html', 'CoRE%20MOF%20Database.dc.html', 'GWP-estimator.dc.html',
  'MOFClassifier.dc.html', 'PACMAN.dc.html', 'SESAMI-APP.dc.html',
  'Statistics.dc.html'
];

function comparePublicText(left, right) {
  const leftKey = String(left).normalize('NFKD').toLowerCase();
  const rightKey = String(right).normalize('NFKD').toLowerCase();
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

async function readFeedPublications(request) {
  const response = await request.get('/feed.js');
  expect(response.ok()).toBe(true);
  const sandbox = Object.create(null);
  sandbox.window = Object.create(null);
  const context = vm.createContext(sandbox, {
    name: 'browser-test:feed.js',
    codeGeneration: { strings: false, wasm: false }
  });
  new vm.Script(await response.text(), { filename: 'feed.js' })
    .runInContext(context, { timeout: 1_000 });
  return JSON.parse(JSON.stringify(sandbox.window.MTAP_FEED.PUBS));
}

function deriveFeedPublicationFacts(publications, currentYear = new Date().getUTCFullYear()) {
  const yearCounts = new Map();
  const journals = new Map();
  let reviews = 0;
  for (const publication of publications) {
    const year = Number(publication.year);
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    if (publication.topics.includes('Review')) reviews += 1;
    const journal = String(publication.journal).normalize('NFC').replace(/\s+/g, ' ').trim();
    const key = journal.toLocaleLowerCase('en-US').replace(/^the\s+/, '');
    const entry = journals.get(key) || { labels: new Map(), count: 0 };
    entry.labels.set(journal, (entry.labels.get(journal) || 0) + 1);
    entry.count += 1;
    journals.set(key, entry);
  }
  const firstPublicationYear = Math.min(...yearCounts.keys());
  const firstYear = Math.min(firstPublicationYear, currentYear);
  const lastPublicationYear = Math.max(...yearCounts.keys());
  const lastYear = Math.max(lastPublicationYear, currentYear);
  const byYear = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    byYear.push({ year, count: yearCounts.get(year) || 0, partial: year === currentYear });
  }
  const journalGroups = [...journals.values()]
    .map(entry => ({
      name: [...entry.labels.entries()]
        .sort((left, right) => right[1] - left[1] || comparePublicText(left[0], right[0]))[0][0],
      count: entry.count
    }))
    .sort((left, right) => right.count - left.count || comparePublicText(left.name, right.name));
  return {
    total: publications.length,
    reviews,
    articles: publications.length - reviews,
    firstYear,
    lastPublicationYear,
    currentYear,
    lastYear,
    byYear,
    journalGroups
  };
}

test.beforeEach(async ({ page }) => {
  // Leave local assets on Chromium's native network path. Intercepting every
  // local request through Playwright can occasionally stall larger fixture
  // responses on Windows and makes the metadata test flaky.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/|unpkg\.com\/)/, route => route.abort());
});

test('publications use the static metadata snapshot without external API fan-out', async ({ page }) => {
  const externalMetadataRequests = [];
  page.on('request', request => {
    if (/api\.crossref\.org|api\.semanticscholar\.org|api\.openalex\.org|serpapi\.com/i.test(request.url())) {
      externalMetadataRequests.push(request.url());
    }
  });

  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  const status = page.locator('[data-publication-metadata-status]');
  await expect(status).toBeVisible();
  await expect(status).toContainText(/updated/i, { timeout: 30_000 });
  await expect(page.getByText('Publications · 논문', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Citations (Google Scholar)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Citations (OpenAlex)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Citations (Semantic Scholar)', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-publication-enrichment]').first()).toBeVisible();
  expect(externalMetadataRequests).toEqual([]);
});

test('publication citation exports are linked and served as complete files', async ({ page, request }) => {
  const publicationCount = (await readFeedPublications(request)).length;
  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  await expect(page.getByRole('link', { name: 'Download BibTeX file of all publications' })).toHaveAttribute('href', 'exports/publications/publications.bib');
  await expect(page.getByRole('link', { name: 'Download CFF file of all publications' })).toHaveAttribute('href', 'exports/publications/CITATION.cff');

  const [bibtexResponse, cffResponse] = await Promise.all([
    request.get('/exports/publications/publications.bib'),
    request.get('/exports/publications/CITATION.cff')
  ]);
  expect(bibtexResponse.ok()).toBe(true);
  expect(cffResponse.ok()).toBe(true);
  const [bibtexText, cffText] = await Promise.all([
    bibtexResponse.text(),
    cffResponse.text()
  ]);
  const bibtexCount = (bibtexText.match(/^@article\{/gm) ?? []).length;
  const cffCount = (cffText.match(/^  - type: "article"$/gm) ?? []).length;
  expect(bibtexCount).toBeGreaterThan(0);
  expect(cffCount).toBe(bibtexCount);
  expect(bibtexCount).toBe(publicationCount);
  await expect(page.locator('[data-publication-no]')).toHaveCount(bibtexCount);
});

test('publication cards fail closed without per-publication JCR display authorization', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/publication-jcr-bands.json');
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json();
  expect(snapshot.schemaVersion).toBe(1);
  expect(snapshot.status).toBe('unavailable');
  expect(snapshot.displayAuthorized).toBe(false);
  expect(snapshot.coveredPublications).toBe(0);
  expect(snapshot.bandsByDoi).toEqual({});
  expect(JSON.stringify(snapshot)).not.toMatch(
    /rankingsByDoi|jcrYear|categor(?:y|ies)|categoryTotal|jifPercentile|impactFactor|"(?:rank|quartile|jif)"\s*:/i
  );

  const responsePromise = page.waitForResponse(
    response => response.url().includes('/data/publication-jcr-bands.json')
  );
  await page.goto('/Publications.dc.html');
  await responsePromise;
  await expect(page.locator('[data-publication-no]').first()).toBeVisible();
  await expect(page.locator('[data-publication-jcr-band]')).toHaveCount(0);
});

test('publication card renders only an authorized derived previous-year JCR band', async ({ page, request }) => {
  const publications = await readFeedPublications(request);
  const bandCases = [
    ['top1', 'Top 1%'],
    ['top5', 'Top 5%'],
    ['top10', 'Top 10%'],
    ['otherQ1', 'Q1'],
    ['q2', 'Q2'],
    ['q3', 'Q3'],
    ['q4', 'Q4']
  ];
  const targets = publications.slice(0, bandCases.length);
  const bandsByDoi = Object.fromEntries(
    targets.map((publication, index) => [
      String(publication.doi).toLowerCase(),
      bandCases[index][0]
    ])
  );
  await page.route('**/data/publication-jcr-bands.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 1,
      status: 'partial',
      displayAuthorized: true,
      publicationTotal: publications.length,
      coveredPublications: targets.length,
      yearBasis: 'Previous-year JCR: publication year Y uses JCR year Y-1.',
      bandsByDoi,
      reason: `Partial coverage: ${targets.length} of ${publications.length} catalogue publications have an exact previous-year JCR band authorized for public per-publication display.`
    })
  }));

  await page.goto('/Publications.dc.html');
  for (const [index, target] of targets.entries()) {
    const [bandId, label] = bandCases[index];
    const targetCard = page.locator(`[data-publication-no="${target.no}"]`);
    const badge = targetCard.locator('[data-publication-jcr-band]');
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveText(`JCR ${label}`);
    await expect(badge).toHaveAttribute('data-jcr-band', bandId);
    await expect(badge).toHaveAttribute(
      'title',
      /publication year Y evaluated with JCR year Y−1/
    );
    await expect(targetCard).not.toContainText(/jifPercentile|categoryTotal|quartile/i);
  }
  await expect(page.locator('[data-publication-jcr-band]')).toHaveCount(bandCases.length);
});

test('publication aggregates stay on the Statistics page rather than the publication header', async ({ page }) => {
  await page.route('**/data/publication-metadata.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 3,
      snapshotUpdatedAt: '2026-07-30T00:00:00.000Z',
      sources: {
        googleScholar: {
          status: 'ok',
          reason: null,
          matched: 0,
          freshMatched: 0,
          profileId: 'q-UUrywAAAAJ',
          provider: 'SerpApi Google Scholar Author API',
          contentUpdatedAt: '2026-07-30T00:00:00.000Z'
        },
        openAlex: { status: 'ok', reason: null, matched: 0, contentUpdatedAt: null },
        semanticScholar: { status: 'ok', reason: null, matched: 0, contentUpdatedAt: null }
      },
      totals: {
        publications: 0,
        googleScholarCitations: 9876,
        openAlexCitations: 0,
        semanticScholarCitations: 0
      },
      googleScholar: {
        profileId: 'q-UUrywAAAAJ',
        citations: { all: 9876, since: 6000 }
      },
      publications: {}
    })
  }));

  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  await expect(page.getByText('Citations (Google Scholar)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('9,876', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-publication-metadata-status]')).toContainText('updated');
});

test('publication cards prefer per-paper Google Scholar and retain source fallbacks', async ({ page }) => {
  await page.route('**/data/publication-metadata.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 3,
      snapshotUpdatedAt: '2026-07-30T00:00:00.000Z',
      sources: {
        googleScholar: {
          status: 'ok',
          reason: null,
          matched: 1,
          freshMatched: 1,
          profileId: 'q-UUrywAAAAJ',
          provider: 'SerpApi Google Scholar Author API',
          contentUpdatedAt: '2026-07-30T00:00:00.000Z'
        },
        openAlex: { status: 'ok', reason: null, matched: 2, contentUpdatedAt: null },
        semanticScholar: { status: 'ok', reason: null, matched: 0, contentUpdatedAt: null }
      },
      totals: {
        publications: 2,
        googleScholarCitations: 9876,
        openAlexCitations: 110,
        semanticScholarCitations: 0
      },
      googleScholar: {
        profileId: 'q-UUrywAAAAJ',
        citations: { all: 9876, since: 6000 }
      },
      publications: {
        '10.1002/ijch.70028': {
          googleScholar: {
            title: 'Hunting Structural Demons in Digital Reticular Chemistry: Lessons from Metal-Organic Frameworks',
            citationId: 'q-UUrywAAAAJ:paper-72',
            citationCount: 77,
            matchedBy: 'feed-title'
          },
          sourceFreshness: {
            googleScholar: {
              status: 'fresh',
              reason: null,
              contentUpdatedAt: '2026-07-30T00:00:00.000Z'
            }
          },
          openAlex: { citationCount: 70 },
          fields: [],
          keywords: []
        },
        '10.1063/5.0307954': {
          openAlex: { citationCount: 40 },
          fields: [],
          keywords: []
        }
      }
    })
  }));

  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  await expect(page.locator('[data-publication-no="72"]')).toContainText('Cited by 77 · Google Scholar');
  await expect(page.locator('[data-publication-no="71"]')).toContainText('Cited by 40 · OpenAlex');
});

test('publication search includes a rendered metadata field or keyword', async ({ page }) => {
  await page.goto('/Publications.dc.html', { waitUntil: 'domcontentloaded' });
  const term = page.locator('[data-metadata-term]').first();
  await expect(term).toBeVisible({ timeout: 30_000 });
  const query = (await term.textContent())?.trim();
  expect(query).toBeTruthy();
  const publication = term.locator('xpath=ancestor::*[@data-publication-no][1]');
  const publicationNo = await publication.getAttribute('data-publication-no');

  await page.getByPlaceholder(/Search publications/).fill(query);
  await expect(page.locator(`[data-publication-no="${publicationNo}"]`)).toBeVisible();
});

test('publications remain usable when the metadata snapshot is unavailable', async ({ page }) => {
  await page.route('**/data/publication-metadata.json*', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: '{}'
  }));

  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  await expect(page.locator('[data-publication-no]').first()).toBeVisible();
  await expect(page.locator('[data-publication-metadata-status]')).toContainText('temporarily unavailable');
  await expect(page.getByText('Citations (Google Scholar)', { exact: true })).toHaveCount(0);
  const publicationSearch = page.getByPlaceholder(/Search publications/);
  await publicationSearch.fill('PACMAN');
  await expect(page.getByText(/PACMAN: A Robust Partial Atomic Charge/)).toBeVisible();
});

test('publication rows keep a compact number-and-bibliography layout without artwork', async ({ page, request }) => {
  const publicationCount = (await readFeedPublications(request)).length;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/Publications.dc.html', { waitUntil: 'load' });

  const publications = page.locator('[data-publication-no]');
  const firstRow = publications.first();
  await expect(firstRow).toBeVisible();
  await expect(publications).toHaveCount(publicationCount);
  await expect(page.locator('[data-publication-visual]')).toHaveCount(0);
  await expect(page.locator('[data-publication-visual-image]')).toHaveCount(0);
  expect(await firstRow.evaluate((row) =>
    [...row.children].map((child) => child.className)
  )).toEqual(['publication-number', 'publication-bibliography']);
  expect(await firstRow.evaluate((row) =>
    getComputedStyle(row).gridTemplateColumns.split(' ').length
  )).toBe(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(firstRow).toBeVisible();
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )).toBe(true);
  expect(await firstRow.evaluate((row) =>
    getComputedStyle(row).gridTemplateColumns.split(' ').length
  )).toBe(2);
});

test('publication cards show every author without et al abbreviations', async ({ page }) => {
  await page.goto('/Publications.dc.html');

  const publicationRows = page.locator('[data-publication-no]');
  await expect(publicationRows).toHaveCount(72);
  await expect(publicationRows.filter({ hasText: /\bet al\./i })).toHaveCount(0);

  await expect(page.locator('[data-publication-no="60"]')).toContainText('Huang, J.');
  await expect(page.locator('[data-publication-no="60"]')).toContainText('Kulik, H.J.');
  await expect(page.locator('[data-publication-no="60"]')).toContainText('Snurr, R.Q.');
  await expect(page.locator('[data-publication-no="60"]')).toContainText('Chung, Y.G.*');
});

test('every published page has metadata and renders its heading', async ({ page }) => {
  test.setTimeout(90_000);
  for (const route of pages) {
    // This test reuses one page across every route. Wait for each page's local
    // runtime and assets to finish loading before navigating again so a later
    // navigation cannot cancel the previous document's boot sequence.
    const response = await page.goto(`/${route}`, { waitUntil: 'load' });
    expect(response?.ok(), route).toBeTruthy();
    await expect(page.locator('html')).toHaveAttribute('lang', /en/);
    await expect(page).toHaveTitle(/Chung Research Group/);
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
  }
});

test('publication topic filters and search work', async ({ page }) => {
  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  await expect(page.locator('.publication-filter-group')).toHaveCount(6);
  const computationGroup = page.locator('[data-filter-group="Computation"]');
  const physicsGroup = page.locator('[data-filter-group="Physics"]');
  const applicationGroup = page.locator('[data-filter-group="Applications"]');
  const reviewGroup = page.locator('[data-filter-group="Review"]');

  // Only the first major category is expanded initially.
  await expect(page.getByText(/^Machine Learning\s*×/).first()).toBeVisible();
  await expect(page.getByText(/^Reticular Materials\s*×/)).toHaveCount(0);
  const computationLabels = computationGroup.locator('.publication-filter-items > span');
  await expect(computationLabels.first()).toContainText('Grand Canonical Monte Carlo × 27');

  // Major categories can be expanded and selected as aggregate filters.
  await physicsGroup.getByRole('button', { name: 'Expand Physics' }).click();
  await expect(page.getByText(/^Machine Learning\s*×/)).toHaveCount(0);
  await expect(page.getByText(/^Adsorption\s*×\s*41$/)).toBeVisible();
  await expect(page.getByText(/publications found/)).toBeVisible();
  await physicsGroup.getByRole('button', { name: 'Collapse Physics' }).click();

  // A major category opens all of its middle and detailed categories at once.
  await applicationGroup.getByRole('button', { name: 'Expand Applications' }).click();
  await expect(applicationGroup.locator('.publication-filter-section-title')).toHaveText(['−Separation', '−Catalysis', '−Energy Storage', '−Other']);
  await expect(applicationGroup.getByText(/^Xylene Isomer\s*×\s*1$/)).toBeVisible();
  await expect(applicationGroup.getByText(/^Hydrogen\s*×\s*4$/)).toBeVisible();
  const separationSection = applicationGroup.locator('[data-filter-section="Separation"]');
  await separationSection.getByRole('button', { name: 'Collapse Separation' }).click();
  await expect(applicationGroup.getByText(/^Xylene Isomer\s*×/)).toHaveCount(0);
  await separationSection.getByRole('button', { name: 'Expand Separation' }).click();
  await expect(applicationGroup.getByText(/^Xylene Isomer\s*×\s*1$/)).toBeVisible();
  await expect(applicationGroup.getByText(/^Catalysis\s*×/)).toHaveCount(0);
  await expect(page.getByText(/publications found/)).toBeVisible();
  await separationSection.getByRole('button', { name: 'Collapse Separation' }).click();

  // Review has no redundant Review × 6 label; its topic filters appear on expand.
  await expect(reviewGroup.getByText(/^Review\s*×/)).toHaveCount(0);
  await reviewGroup.getByRole('button', { name: 'Expand Review' }).click();
  await expect(reviewGroup.getByText(/^Applications\s*×\s*2$/)).toBeVisible();

  await computationGroup.getByRole('button', { name: 'Expand Computation' }).click();
  const dft = page.getByText(/^Density Functional Theory\s*×/).first();
  await expect(dft).toBeVisible();
  const scholarLink = page.getByTitle('Google Scholar');
  const publicationSearch = page.getByPlaceholder(/Search publications/);
  await expect(scholarLink.locator('xpath=following-sibling::input')).toHaveCount(1);
  await dft.click();
  await expect(page.getByText(/publications found/)).toBeVisible();
  await dft.click();
  await publicationSearch.fill('PACMAN');
  await expect(page.getByText(/PACMAN: A Robust Partial Atomic Charge/)).toBeVisible();
});

test('homepage shows the six latest publications from the shared feed', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'load' });
  await expect(page.getByText('Latest publications · 최신 논문', { exact: true })).toBeVisible();
  await expect(page.locator('[data-home-publication]')).toHaveCount(6);
});

test('graduate program data is rendered without duplicate education text', async ({ page }) => {
  await page.goto('/People.dc.html', { waitUntil: 'load' });
  await expect(page.getByText('B.S./M.S. Program', { exact: true })).toBeVisible();
  await expect(page.getByText("Master's Program, Graduate School of Data Science", { exact: true })).toBeVisible();
  await expect(page.getByText('Graduate School of Data Science, Pusan National University 데이터사이언스 전문대학원')).toHaveCount(0);
});

test('Hyunji Kim is listed as a current undergraduate researcher', async ({ page }) => {
  await page.goto('/People.dc.html', { waitUntil: 'load' });
  const profile = page.locator('#m-kim-hyunji');
  await expect(profile.locator('h4').getByText('Kim, Hyunji', { exact: true })).toBeVisible();
  await expect(profile.locator('h4').getByText('김현지', { exact: true })).toBeVisible();
  await expect(profile.locator('a[href="https://github.com/Kimhyunji4"]')).toBeVisible();
  await expect(profile.locator('a[href="https://www.linkedin.com/in/hyunji-kim-051743359"]')).toBeVisible();
  await expect(profile.getByText('Modeling & Optimization', { exact: true })).toBeVisible();
});

test('undergraduate recruiting is open', async ({ page }) => {
  await page.goto('/Join%20Us.dc.html', { waitUntil: 'load' });
  const undergraduateOpening = page.getByText('Undergraduate interns').locator('..');
  await expect(undergraduateOpening.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByText(/학부연구생을 상시 모집합니다/)).toBeVisible();
  await expect(page.getByText(/부산광역시 금정구 부산대학로 63번길 2/)).toBeVisible();
  await expect(page.getByText('학생 오피스 · 제7공학관 302호', { exact: true })).toBeVisible();
  const professorOfficeAddress = page.getByText('교수 오피스 · 제7공학관 부속연구동 201호', { exact: true });
  await expect(professorOfficeAddress).toBeVisible();
  await expect(professorOfficeAddress.locator('xpath=ancestor::a')).toHaveCount(0);
  await expect(page.getByText('교수 오피스 · +82 51 510 3757', { exact: true })).toBeVisible();
  await expect(page.getByText('학생 오피스 · +82 51 510 3082', { exact: true })).toBeVisible();
  await expect(page.getByText('drygchung AT gmail DOT com').first()).toBeVisible();
  await expect(page.getByText('Email Prof. Chung', { exact: true })).toBeVisible();
  await expect(page.locator('[data-prof-email]')).toHaveCount(2);
  await expect(page.locator('[data-prof-email]').first()).toHaveAttribute('href', /^mailto:/);
});


test('quantum language, Baek focus, and audited review taxonomy are rendered', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'load' });
  await expect(page.getByText(/quantum and atomistic simulations/)).toBeVisible();
  for (const keyword of ['quantum and atomistic simulations', 'statistical mechanics', 'curated data', 'artificial intelligence']) {
    await expect(page.locator('strong', { hasText: keyword })).toBeVisible();
  }
  await expect(page.getByText(/양자·원자 시뮬레이션/)).toBeVisible();
  await expect(page.getByText(/에너지·환경·산업 분야의 응용/)).toBeVisible();

  await page.goto('/People.dc.html', { waitUntil: 'load' });
  const baek = page.locator('#m-baek');
  await expect(baek.getByText('AI & Data', { exact: true })).toBeVisible();
  await expect(baek.getByText('Atoms/Electrons', { exact: true })).toHaveCount(0);

  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  await page.getByPlaceholder(/Search publications/).fill('Surface area determination');
  const jpcc = page.locator('[data-publication-no="19"]');
  await expect(jpcc).toBeVisible();
  await expect(jpcc.getByText('Review', { exact: true })).toHaveCount(0);
  await expect(jpcc.getByText('Grand Canonical Monte Carlo', { exact: true })).toBeVisible();
  await expect(jpcc.getByText('Reticular Materials', { exact: true })).toBeVisible();
  await expect(jpcc.getByText('Carbons', { exact: true })).toBeVisible();
});

test('lab statistics render from the local snapshot and remain usable through tablet and 320px widths', async ({ page, request }) => {
  const externalDataRequests = [];
  page.on('request', webRequest => {
    if (/api\.crossref\.org|api\.semanticscholar\.org|api\.openalex\.org|serpapi\.com|scholar\.google\.com/i.test(webRequest.url())) {
      externalDataRequests.push(webRequest.url());
    }
  });
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json();
  const expectedFacts = deriveFeedPublicationFacts(await readFeedPublications(request));
  expect(snapshot.publications.total).toBe(expectedFacts.total);
  expect(snapshot.publications.articles).toBe(expectedFacts.articles);
  expect(snapshot.publications.reviews).toBe(expectedFacts.reviews);
  expect(snapshot.publications.firstYear).toBe(expectedFacts.firstYear);
  expect(snapshot.publications.lastPublicationYear).toBe(expectedFacts.lastPublicationYear);
  expect(snapshot.publications.lastYear).toBe(expectedFacts.lastYear);
  expect(snapshot.publications.currentYearPartial).toBe(true);
  expect(snapshot.publications.byYear).toEqual(expectedFacts.byYear);
  expect(snapshot.journals.groups).toEqual(expectedFacts.journalGroups);

  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { level: 1, name: /Lab Statistics/ })).toBeVisible();
  const summaryCards = page.locator('.statistics-summary-card');
  await expect(summaryCards).toHaveCount(3);
  await expect(summaryCards.nth(0)).toContainText(snapshot.publications.total.toLocaleString('en-US'));
  await expect(summaryCards.nth(2)).toContainText(snapshot.team.total.toLocaleString('en-US'));
  await expect(page.locator('[data-publications-by-year] .statistics-bar-row')).toHaveCount(snapshot.publications.byYear.length);
  const currentYearRow = page.locator('[data-publications-by-year] .statistics-bar-row')
    .filter({ hasText: String(expectedFacts.currentYear) });
  await expect(currentYearRow).toContainText('YTD');
  const journalHighlights = expectedFacts.journalGroups.filter(group => group.count >= 2);
  const expectedHighlights = journalHighlights.length
    ? journalHighlights
    : expectedFacts.journalGroups.slice(0, 10);
  await expect(page.locator(
    '[data-journal-distribution] [data-journal-highlights] .statistics-journal-row'
  )).toHaveCount(expectedHighlights.length);
  await expect(page.locator('[data-research-footprint] .statistics-bar-row')).toHaveCount(snapshot.researchAreas.groups.length);
  await expect(page.locator('[data-citation-source-card]')).toHaveCount(snapshot.citations.sources.length);
  for (const source of snapshot.citations.sources) {
    const annualTotal = source.countsByYear.reduce((sum, point) => sum + point.count, 0);
    const sourceCard = page.locator('[data-citation-source-card]').filter({ hasText: source.label });
    await expect(sourceCard.locator('.statistics-source-status')).toHaveAttribute('data-status', source.status);
    await expect(sourceCard).toContainText(source.provider);
    if (source.countsByYear.length) {
      expect(source.history.annualTotal).toBe(annualTotal);
      expect(source.history.reconciliationDelta).toBe(source.total - annualTotal);
      expect(source.cumulativeCountsByYear.at(-1).count).toBe(annualTotal);
      await expect(sourceCard.locator('.statistics-source-history')).toHaveAttribute(
        'data-history-status',
        source.history.status
      );
    } else {
      expect(source.history.status).toBe('unavailable');
      await expect(sourceCard).toContainText('provider supplied no annual series');
    }
  }
  for (const source of snapshot.citations.sources.filter(source =>
    source.total !== null
      && source.matched !== null
      && source.matched < source.publicationTotal
  )) {
    const sourceCard = page.locator('[data-citation-source-card]').filter({ hasText: source.label });
    await expect(sourceCard.locator('[data-status]')).toHaveAttribute('data-status', 'partial');
    await expect(sourceCard).toContainText('Partial coverage');
    await expect(sourceCard).toContainText('displayed total covers matched records only');
  }
  await expect(page.locator('[data-coauthor-network] .statistics-network-node')).toHaveCount(snapshot.coauthors.nodes.length);
  await expect(page.locator('[data-coauthor-network] .statistics-network-line')).toHaveCount(snapshot.coauthors.edges.length);
  await expect(page.locator('[data-team-composition] .statistics-bar-row')).toHaveCount(snapshot.team.groups.length);

  const sourceWithHistory = snapshot.citations.sources.find(source => source.countsByYear.length > 0);
  expect(sourceWithHistory).toBeTruthy();
  await page.selectOption('#citation-source-select', sourceWithHistory.id);
  await expect(page.getByRole('heading', { level: 3, name: 'Annual citation history' })).toBeVisible();
  await expect(page.locator('[data-citation-trend] .statistics-bar-row').first()).toBeVisible();
  await page.selectOption('#citation-mode-select', 'cumulative');
  await expect(page.getByRole('heading', { level: 3, name: 'Cumulative citation history' })).toBeVisible();
  const cumulativeRows = page.locator('[data-citation-trend] .statistics-bar-row');
  await expect(cumulativeRows).toHaveCount(sourceWithHistory.cumulativeCountsByYear.length);
  await expect(cumulativeRows.last().locator('.statistics-bar-value')).toHaveText(
    sourceWithHistory.history.annualTotal.toLocaleString('en-US')
  );
  await expect(page.locator('[data-citation-history-note]')).toHaveAttribute(
    'data-history-status',
    sourceWithHistory.history.status
  );
  if (sourceWithHistory.history.unassignedCount > 0) {
    await expect(page.locator('[data-citation-history-note]')).toContainText(
      `${sourceWithHistory.history.unassignedCount.toLocaleString('en-US')} citation`
    );
    await expect(page.locator('[data-citation-history-note]')).toContainText(
      'not placed into any annual or cumulative chart year'
    );
  }
  await page.getByText('View publication counts as a table', { exact: true }).click();
  const publicationTable = page.getByRole('table', { name: 'Annual publication counts' });
  await expect(publicationTable).toBeVisible();
  await expect(publicationTable.getByRole('row', {
    name: new RegExp(`^${expectedFacts.currentYear}\\s+YTD\\s+`)
  })).toBeVisible();

  const topCollaborators = page.locator('[data-top-collaborators]');
  for (const width of [768, 601, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(topCollaborators).toBeVisible();
    await expect(topCollaborators.locator('.statistics-collaborator-row').first()).toBeVisible();
    expect(await topCollaborators.locator('.statistics-collaborator-row').count()).toBeLessThanOrEqual(8);
    await expect(page.locator('[data-coauthor-network] .statistics-network-canvas')).toBeHidden();
    await expect(page.locator('[data-coauthor-network] .statistics-network-legend')).toBeHidden();
    await expect(page.locator('[data-coauthor-network] .statistics-network-label').first()).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    ).toBeLessThanOrEqual(0);
  }
  expect(externalDataRequests).toEqual([]);
});

test('statistics bar values appear on hover and keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });

  for (const selector of [
    '[data-publications-by-year] .statistics-bar-row',
    '[data-journal-distribution] .statistics-bar-row',
    '[data-research-footprint] .statistics-bar-row',
    '[data-citation-trend] .statistics-bar-row',
    '[data-team-composition] .statistics-bar-row'
  ]) {
    const row = page.locator(selector).first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('tabindex', '0');
  }

  const row = page.locator('[data-publications-by-year] .statistics-bar-row').first();
  const value = row.locator('.statistics-bar-value');
  await expect(value).not.toHaveText('');
  expect(await value.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');

  await row.hover();
  await expect.poll(
    () => value.evaluate((node) => getComputedStyle(node).opacity)
  ).toBe('1');

  await page.mouse.move(0, 0);
  await expect.poll(
    () => value.evaluate((node) => getComputedStyle(node).opacity)
  ).toBe('0');
  await row.focus();
  await expect.poll(
    () => value.evaluate((node) => getComputedStyle(node).opacity)
  ).toBe('1');
});

test.describe('touch statistics values', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 }
  });

  test('bar values remain visible without hover on touch screens', async ({ page }) => {
    await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
    for (const selector of [
      '[data-publications-by-year] .statistics-bar-row',
      '[data-journal-distribution] .statistics-bar-row',
      '[data-research-footprint] .statistics-bar-row',
      '[data-citation-trend] .statistics-bar-row',
      '[data-team-composition] .statistics-bar-row',
      '[data-top-collaborators] .statistics-bar-row'
    ]) {
      const row = page.locator(selector).first();
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('tabindex', '0');
      expect(
        await row.locator('.statistics-bar-value').evaluate(node => getComputedStyle(node).opacity)
      ).toBe('1');
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    ).toBeLessThanOrEqual(0);
  });
});

test('coauthor network uses stable bounded force-directed coordinates instead of fixed rings', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json();

  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
  const network = page.locator('[data-coauthor-network] .statistics-network-canvas');
  await expect(network).toBeVisible();
  await expect(network).toHaveAttribute('viewBox', '0 0 1000 680');
  await expect(network).toHaveAttribute('data-force-layout', 'deterministic-force-v1');
  const networkBox = await network.boundingBox();
  const sectionBox = await page.locator('[data-coauthor-network]').boundingBox();
  expect(networkBox).toBeTruthy();
  expect(sectionBox).toBeTruthy();
  expect(networkBox.width).toBeLessThanOrEqual(770);
  expect(Math.abs(
    (networkBox.x + networkBox.width / 2) - (sectionBox.x + sectionBox.width / 2)
  )).toBeLessThanOrEqual(2);

  const readCoordinates = () => page.locator(
    '[data-coauthor-network] .statistics-network-node-group'
  ).evaluateAll(groups => groups.map(group => ({
    id: group.getAttribute('data-node-id'),
    x: Number(group.getAttribute('data-node-x')),
    y: Number(group.getAttribute('data-node-y')),
    radius: Number(group.getAttribute('data-node-radius')),
    labelY: Number(group.getAttribute('data-label-y')),
    focal: group.getAttribute('data-focal') === 'true'
  })));

  const firstCoordinates = await readCoordinates();
  expect(firstCoordinates).toHaveLength(snapshot.coauthors.nodes.length);
  const focal = firstCoordinates.find(node => node.focal);
  expect(focal).toMatchObject({ x: 500, y: 340 });

  for (const node of firstCoordinates) {
    expect(node.x - 77).toBeGreaterThanOrEqual(0);
    expect(node.x + 77).toBeLessThanOrEqual(1000);
    expect(node.y - node.radius).toBeGreaterThanOrEqual(0);
    expect(node.y + node.radius).toBeLessThanOrEqual(680);
    expect(node.y + node.labelY).toBeGreaterThanOrEqual(0);
    expect(node.y + node.labelY + 18).toBeLessThanOrEqual(680);
  }
  const collaboratorRadii = firstCoordinates
    .filter(node => !node.focal)
    .map(node => Math.hypot(node.x - focal.x, node.y - focal.y));
  expect(new Set(collaboratorRadii.map(radius => Math.round(radius))).size).toBeGreaterThan(2);
  expect(
    collaboratorRadii.every(radius =>
      Math.abs(radius - 170) < 0.5 || Math.abs(radius - 280) < 0.5
    )
  ).toBe(false);

  const edgeCoordinates = await page.locator(
    '[data-coauthor-network] .statistics-network-line'
  ).evaluateAll(lines => lines.map(line =>
    ['x1', 'y1', 'x2', 'y2'].map(attribute => Number(line.getAttribute(attribute)))
  ));
  expect(edgeCoordinates).toHaveLength(snapshot.coauthors.edges.length);
  for (const coordinates of edgeCoordinates) {
    expect(coordinates.every(Number.isFinite)).toBe(true);
    expect(coordinates[0]).toBeGreaterThanOrEqual(0);
    expect(coordinates[0]).toBeLessThanOrEqual(1000);
    expect(coordinates[1]).toBeGreaterThanOrEqual(0);
    expect(coordinates[1]).toBeLessThanOrEqual(680);
    expect(coordinates[2]).toBeGreaterThanOrEqual(0);
    expect(coordinates[2]).toBeLessThanOrEqual(1000);
    expect(coordinates[3]).toBeGreaterThanOrEqual(0);
    expect(coordinates[3]).toBeLessThanOrEqual(680);
  }

  await page.reload({ waitUntil: 'load' });
  await expect(page.locator(
    '[data-coauthor-network] .statistics-network-node-group'
  )).toHaveCount(firstCoordinates.length);
  expect(await readCoordinates()).toEqual(firstCoordinates);

  await page.setViewportSize({ width: 320, height: 900 });
  await expect(network).toBeHidden();
  await expect(page.locator('[data-coauthor-network] [data-top-collaborators]')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ).toBeLessThanOrEqual(0);
});

test('lab statistics disclose an unassigned provider-year delta without moving it into a chart year', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json();
  const openAlex = snapshot.citations.sources.find(source => source.id === 'openAlex');
  expect(openAlex).toBeTruthy();
  openAlex.total = 5700;
  openAlex.countsByYear = [
    { year: 2024, count: 2800 },
    { year: 2025, count: 2899 }
  ];
  openAlex.cumulativeCountsByYear = [
    { year: 2024, count: 2800 },
    { year: 2025, count: 5699 }
  ];
  openAlex.history = {
    status: 'partial',
    annualTotal: 5699,
    reportedTotal: 5700,
    reconciliationDelta: 1,
    unassignedCount: 1,
    excessAnnualCount: 0,
    reason: 'provider-total-includes-citations-without-assigned-year'
  };

  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(snapshot)
  }));
  await page.goto('/Statistics.dc.html', { waitUntil: 'domcontentloaded' });
  await page.selectOption('#citation-source-select', 'openAlex');

  const openAlexCard = page.locator('[data-citation-source-card]').filter({ hasText: 'OpenAlex' });
  await expect(openAlexCard.locator('.statistics-source-total')).toHaveText('5,700');
  await expect(openAlexCard.locator('.statistics-source-history')).toContainText(
    '5,699 of 5,700 citations assigned to a year; 1 unassigned'
  );

  await page.selectOption('#citation-mode-select', 'annual');
  const annualValues = await page.locator(
    '[data-citation-trend] .statistics-bar-value'
  ).allTextContents();
  expect(annualValues).toEqual(['2,800', '2,899']);

  await page.selectOption('#citation-mode-select', 'cumulative');
  const cumulativeValues = await page.locator(
    '[data-citation-trend] .statistics-bar-value'
  ).allTextContents();
  expect(cumulativeValues).toEqual(['2,800', '5,699']);
  await expect(page.locator('[data-citation-history-note]')).toContainText(
    '1 citation has no provider-assigned year'
  );
  await expect(page.locator('[data-citation-history-note]')).toContainText(
    'not placed into any annual or cumulative chart year'
  );
});

test('lab statistics keep YTD on the declared partial year when a future publication is present', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json();
  const reportingPoint = snapshot.publications.byYear.find(point => point.partial === true);
  expect(reportingPoint).toBeTruthy();
  const reportingYear = reportingPoint.year;
  const futureYear = Math.max(
    reportingYear + 1,
    ...snapshot.publications.byYear.map(point => point.year + 1)
  );
  snapshot.publications.byYear.push({ year: futureYear, count: 1, partial: false });
  snapshot.publications.lastPublicationYear = futureYear;
  snapshot.publications.lastYear = futureYear;
  delete snapshot.publications.currentYear;

  const sourceWithHistory = snapshot.citations.sources.find(source => source.countsByYear.length > 0);
  expect(sourceWithHistory).toBeTruthy();
  sourceWithHistory.countsByYear = [
    ...sourceWithHistory.countsByYear.filter(point => point.year !== futureYear),
    { year: futureYear, count: 1 }
  ];

  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(snapshot)
  }));
  await page.goto('/Statistics.dc.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator(
    `[data-publications-by-year] .statistics-bar-row[aria-label^="${reportingYear} YTD:"]`
  )).toHaveCount(1);
  const futurePublicationRow = page.locator(
    `[data-publications-by-year] .statistics-bar-row[aria-label^="${futureYear}:"]`
  );
  await expect(futurePublicationRow).toBeVisible();
  await expect(futurePublicationRow).not.toContainText('YTD');

  await page.selectOption('#citation-source-select', sourceWithHistory.id);
  await expect(page.locator(
    `[data-citation-trend] .statistics-bar-row[aria-label^="${reportingYear} YTD:"]`
  )).toHaveCount(1);
  const futureCitationRow = page.locator(
    `[data-citation-trend] .statistics-bar-row[aria-label^="${futureYear}:"]`
  );
  await expect(futureCitationRow).toBeVisible();
  await expect(futureCitationRow).not.toContainText('YTD');
});

test('lab statistics expose journal, coauthor, h-index, and impact-factor evidence transparently', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json();
  const expectedFacts = deriveFeedPublicationFacts(await readFeedPublications(request));

  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });

  const journalSection = page.locator('[data-journal-distribution]');
  await expect(journalSection).toContainText(`${snapshot.journals.distinctCount.toLocaleString('en-US')} distinct journals`);
  const recurringJournals = expectedFacts.journalGroups.filter(group => group.count >= 2);
  const expectedHighlights = recurringJournals.length
    ? recurringJournals
    : expectedFacts.journalGroups.slice(0, 10);
  const journalBars = journalSection.locator(
    '[data-journal-highlights] .statistics-journal-row'
  );
  await expect(journalBars).toHaveCount(expectedHighlights.length);
  if (expectedHighlights.length < expectedFacts.journalGroups.length) {
    expect(await journalBars.count()).toBeLessThan(expectedFacts.journalGroups.length);
  }
  await journalSection.getByText('View journal counts as a table', { exact: true }).click();
  const journalTable = page.getByRole('table', { name: 'Publications by journal' });
  await expect(journalTable).toBeVisible();
  const journalRows = journalTable.locator('[role="rowgroup"]').nth(1).getByRole('row');
  await expect(journalRows).toHaveCount(expectedFacts.journalGroups.length);
  const renderedJournals = await journalRows.evaluateAll(rows => rows.map(row => {
    const cells = row.querySelectorAll('[role="rowheader"],[role="cell"]');
    return { name: cells[0].textContent.trim(), count: Number(cells[1].textContent.trim()) };
  }));
  expect(renderedJournals.sort((left, right) => comparePublicText(left.name, right.name))).toEqual(
    [...expectedFacts.journalGroups].sort((left, right) => comparePublicText(left.name, right.name))
  );

  const networkSection = page.locator('[data-coauthor-network]');
  const networkSvg = networkSection.getByRole('img', {
    name: 'Selected coauthor network from the public publication catalog'
  });
  await expect(networkSvg).toBeVisible();
  await expect(networkSection).toContainText(`Showing ${snapshot.coauthors.displayedAuthors.toLocaleString('en-US')} of ${snapshot.coauthors.totalAuthors.toLocaleString('en-US')}`);
  await expect(networkSection).toContainText(/not citation impact/i);
  await networkSection.getByText('View the displayed coauthor network as tables', { exact: true }).click();
  const authorTable = page.getByRole('table', { name: 'Authors displayed in the coauthor network' });
  const edgeTable = page.getByRole('table', { name: 'Displayed coauthorship links' });
  await expect(authorTable).toBeVisible();
  await expect(authorTable.locator('[role="rowgroup"]').nth(1).getByRole('row')).toHaveCount(snapshot.coauthors.nodes.length);
  await expect(edgeTable.locator('[role="rowgroup"]').nth(1).getByRole('row')).toHaveCount(snapshot.coauthors.edges.length);

  const hIndexCard = page.locator('[data-h-index-status]');
  if (['ok', 'stale', 'partial'].includes(snapshot.metrics.hIndex.status)) {
    await expect(hIndexCard).toHaveAttribute('data-h-index-status', snapshot.metrics.hIndex.status);
    await expect(hIndexCard.locator('.statistics-metric-value')).toHaveText(snapshot.metrics.hIndex.value.toLocaleString('en-US'));
    await expect(hIndexCard).toContainText(snapshot.metrics.hIndex.source);
    await expect(hIndexCard).toContainText(snapshot.metrics.hIndex.provider);
    await expect(hIndexCard).toContainText(snapshot.metrics.hIndex.method);
    if (snapshot.metrics.hIndex.matched !== null) {
      await expect(hIndexCard).toContainText(
        `${snapshot.metrics.hIndex.matched.toLocaleString('en-US')} of ${snapshot.metrics.hIndex.publicationTotal.toLocaleString('en-US')}`
      );
    }
  } else {
    await expect(hIndexCard).toHaveAttribute('data-h-index-status', 'unavailable');
    await expect(hIndexCard.locator('.statistics-metric-value')).toHaveText('\u2014');
    await expect(hIndexCard).toContainText(/does not include a verified h-index value/i);
    await expect(hIndexCard).toContainText(snapshot.metrics.hIndex.reason);
  }

  const impactFactorCard = page.locator('[data-impact-factor-status]');
  await expect(impactFactorCard).toHaveAttribute('data-impact-factor-status', snapshot.impactFactors.status);
  if (['ok', 'partial'].includes(snapshot.impactFactors.status)) {
    await expect(impactFactorCard.locator('.statistics-metric-value')).toHaveText(
      snapshot.impactFactors.total.toLocaleString('en-US', { maximumFractionDigits: 2 })
    );
    await expect(impactFactorCard).toContainText(snapshot.impactFactors.source);
    await expect(impactFactorCard).toContainText(snapshot.impactFactors.edition);
    await expect(impactFactorCard).toContainText(
      `${snapshot.impactFactors.coveredPublications.toLocaleString('en-US')} of ${snapshot.impactFactors.publicationTotal.toLocaleString('en-US')}`
    );
  } else {
    await expect(impactFactorCard.locator('.statistics-metric-value')).toHaveText('\u2014');
    await expect(impactFactorCard).toContainText(snapshot.impactFactors.reason);
    await expect(impactFactorCard).toContainText(/not counted as zero/i);
  }
});

test('lab statistics render a verified Google Scholar h-index when the snapshot provides one', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  const snapshot = await snapshotResponse.json();
  snapshot.metrics.hIndex = {
    status: 'ok',
    value: 37,
    since: 24,
    sinceYear: 2021,
    source: 'Google Scholar',
    provider: 'Google Scholar author profile',
    reason: null,
    updatedAt: '2026-07-30T00:00:00.000Z',
    matched: null,
    publicationTotal: snapshot.publications.total,
    method: 'Reported by the Google Scholar author profile.',
    profileUrl: 'https://scholar.google.com/citations?user=q-UUrywAAAAJ&hl=en'
  };
  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(snapshot)
  }));

  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
  const card = page.locator('[data-h-index-status]');
  await expect(card).toHaveAttribute('data-h-index-status', 'ok');
  await expect(card.locator('.statistics-metric-value')).toHaveText('37');
  await expect(card).toContainText('since 2021: 24');
  await expect(card).toContainText('Reported by the Google Scholar author profile.');
  await expect(card.getByRole('link', { name: 'Open Google Scholar profile' })).toHaveAttribute('href', snapshot.metrics.hIndex.profileUrl);
});

test('lab statistics keep a stale h-index visible with its source and method', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  const snapshot = await snapshotResponse.json();
  snapshot.metrics.hIndex = {
    status: 'stale',
    value: 37,
    since: 24,
    sinceYear: 2021,
    source: 'Google Scholar',
    provider: 'Legacy manual Google Scholar profile snapshot',
    reason: 'The latest provider refresh was unavailable.',
    updatedAt: '2026-06-15T00:00:00.000Z',
    matched: null,
    publicationTotal: snapshot.publications.total,
    method: 'Reported by the Google Scholar author profile.',
    profileUrl: 'https://scholar.google.com/citations?user=q-UUrywAAAAJ&hl=en'
  };
  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(snapshot)
  }));

  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
  const card = page.locator('[data-h-index-status]');
  await expect(card).toHaveAttribute('data-h-index-status', 'stale');
  await expect(card.locator('.statistics-metric-value')).toHaveText('37');
  await expect(card.locator('.statistics-metric-status')).toContainText('Using last available snapshot');
  await expect(card).toContainText('Google Scholar');
  await expect(card).toContainText('Legacy manual Google Scholar profile snapshot');
  await expect(card).toContainText('Reported by the Google Scholar author profile.');
  await expect(card).toContainText('The latest provider refresh was unavailable.');
});

test('lab statistics label a partial OpenAlex catalogue h-index and its coverage', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  const snapshot = await snapshotResponse.json();
  snapshot.metrics.hIndex = {
    status: 'partial',
    value: 31,
    since: null,
    sinceYear: null,
    source: 'OpenAlex',
    provider: 'OpenAlex API',
    reason: 'One catalogue publication did not have a usable OpenAlex citation count.',
    updatedAt: '2026-07-30T00:00:00.000Z',
    matched: snapshot.publications.total - 1,
    publicationTotal: snapshot.publications.total,
    method: 'Derived from per-publication OpenAlex citation counts for the curated DOI catalogue.'
  };
  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(snapshot)
  }));

  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
  const card = page.locator('[data-h-index-status]');
  await expect(card).toHaveAttribute('data-h-index-status', 'partial');
  await expect(card.locator('.statistics-metric-value')).toHaveText('31');
  await expect(card.locator('.statistics-metric-status')).toContainText('Partial coverage');
  await expect(card).toContainText('OpenAlex');
  await expect(card).toContainText('curated DOI catalogue');
  await expect(card).toContainText(
    `${(snapshot.publications.total - 1).toLocaleString('en-US')} of ${snapshot.publications.total.toLocaleString('en-US')}`
  );
});

test('lab statistics show licensed aggregate JIF provenance without raw records', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  const snapshot = await snapshotResponse.json();
  snapshot.impactFactors = {
    status: 'partial',
    metric: 'Journal Impact Factor',
    total: 123.45,
    coveredPublications: snapshot.publications.total - 1,
    publicationTotal: snapshot.publications.total,
    source: 'Clarivate Journal Citation Reports',
    edition: '2025 JCR edition',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    updatedAt: '2026-07-30T00:00:00.000Z',
    reason: 'One catalogue publication has no licensed JIF match.'
  };
  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(snapshot)
  }));

  await page.goto('/Statistics.dc.html', { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-impact-factor-status]');
  await expect(card).toHaveAttribute('data-impact-factor-status', 'partial');
  await expect(card.locator('.statistics-metric-value')).toHaveText('123.45');
  await expect(card).toContainText(
    `${(snapshot.publications.total - 1).toLocaleString('en-US')} of ${snapshot.publications.total.toLocaleString('en-US')}`
  );
  const provenance = card.locator('[data-impact-factor-provenance]');
  await expect(provenance).toContainText('Metric: Journal Impact Factor');
  await expect(provenance).toContainText('Source: Clarivate Journal Citation Reports');
  await expect(provenance).toContainText('Edition: 2025 JCR edition');
  await expect(provenance).toContainText(/aggregate publication display authorized/i);
  await expect(card).toContainText(/Formula: sum the licensed journal-level JIF/i);
  await expect(card).toContainText(/Missing matches are excluded, not counted as zero/i);
  await expect(card).toContainText(/not a measure of an individual article's or researcher's quality/i);
  expect(JSON.stringify(snapshot.impactFactors)).not.toMatch(/factorsByDoi|10\.\d{4,9}\//i);
});

test('lab statistics fail closed when previous-year JCR standing is not authorized', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  const snapshot = await snapshotResponse.json();

  expect(snapshot.journalStanding.status).toBe('unavailable');
  expect(snapshot.journalStanding.bands).toEqual([]);
  expect(snapshot.journalStanding.aggregateRankingDisplayAuthorized).toBe(false);
  expect(JSON.stringify(snapshot.journalStanding)).not.toMatch(
    /10\.\d{4,9}\/|rankingsByDoi|jcrYear|categoryTotal|jifPercentile/i
  );

  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
  const section = page.locator('[data-journal-standing]');
  await expect(section).toHaveAttribute('data-journal-standing-status', 'unavailable');
  await expect(section.locator('[data-journal-standing-bars]')).toHaveCount(0);
  await expect(section.locator('[data-journal-standing-unavailable]')).toContainText(
    snapshot.journalStanding.reason
  );
  await expect(section).toContainText(/publication-year or current JCR percentiles and quartiles cannot replace unavailable year/i);
});

test('lab statistics render authorized exclusive previous-year JCR standing bands', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  const snapshot = await snapshotResponse.json();
  const publicationTotal = snapshot.publications.total;
  const coveredPublications = 7;
  snapshot.journalStanding = {
    status: 'partial',
    publicationTotal,
    coveredPublications,
    unavailablePublications: publicationTotal - coveredPublications,
    bands: [
      { id: 'top1', label: 'Top 1%', count: 1 },
      { id: 'top5', label: 'Top 5%', count: 1 },
      { id: 'top10', label: 'Top 10%', count: 1 },
      { id: 'otherQ1', label: 'Other Q1', count: 1 },
      { id: 'q2', label: 'Q2', count: 1 },
      { id: 'q3', label: 'Q3', count: 1 },
      { id: 'q4', label: 'Q4', count: 1 },
      {
        id: 'unavailable',
        label: 'Unavailable',
        count: publicationTotal - coveredPublications
      }
    ],
    source: 'Clarivate Journal Citation Reports',
    edition: 'Historical JCR data through 2025',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    aggregateRankingDisplayAuthorized: true,
    updatedAt: '2026-07-30T00:00:00.000Z',
    authorizationReference: 'Public aggregate permission 2026-001',
    authorizationDate: '2026-07-29',
    yearBasis: 'Previous-year JCR: publication year Y uses JCR year Y-1.',
    reason: `Partial coverage: ${coveredPublications} of ${publicationTotal} catalogue publications have an authorized previous-year JCR ranking; ${publicationTotal - coveredPublications} are unavailable and no publication-year or current JCR data are substituted.`
  };
  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(snapshot)
  }));

  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
  const section = page.locator('[data-journal-standing]');
  await expect(section).toHaveAttribute('data-journal-standing-status', 'partial');
  await expect(section.getByRole('heading', { level: 2 })).toContainText('Previous-year JCR standing');
  await expect(section.getByRole('heading', { level: 2 })).toContainText('게재연도 전년도 JCR');
  await expect(section).toContainText('a 2026 publication uses 2025 JCR');
  await expect(section).toContainText('a 2025 publication uses 2024 JCR');
  const rows = section.locator('[data-journal-standing-bars] .statistics-bar-row');
  await expect(rows).toHaveCount(8);
  await expect(rows.filter({ hasText: 'Top 1%' })).toContainText('1');
  await expect(rows.filter({ hasText: 'Q4' })).toContainText('1');
  await expect(rows.filter({ hasText: 'Unavailable' })).toContainText(
    (publicationTotal - coveredPublications).toLocaleString('en-US')
  );
  await expect(section).toContainText(`${coveredPublications} of ${publicationTotal}`);
  const provenance = section.locator('[data-journal-standing-provenance]');
  await expect(provenance).toContainText('Source: Clarivate Journal Citation Reports');
  await expect(provenance).toContainText('Edition: Historical JCR data through 2025');
  await expect(provenance).toContainText('permission reference Public aggregate permission 2026-001');
  await expect(provenance).toContainText(/publication year Y uses JCR year Y-1/i);
  await expect(section).toContainText(/Exclusive bands:/);
  await expect(section).toContainText(/highest supplied JIF percentile across JCR categories/i);
  await expect(section).toContainText(/JCR data matching publication year Y.*are never substituted/i);
  expect(JSON.stringify(snapshot.journalStanding)).not.toMatch(
    /10\.\d{4,9}\/|rankingsByDoi|jcrYear|categoryTotal|jifPercentile/i
  );
});

test('lab statistics explain unavailable annual history and fail safely without a snapshot', async ({ page, request }) => {
  const snapshotResponse = await request.get('/data/lab-statistics.json');
  const snapshot = await snapshotResponse.json();
  const googleScholar = snapshot.citations.sources.find(source => source.id === 'googleScholar');
  expect(googleScholar).toBeTruthy();
  googleScholar.status = 'unavailable';
  googleScholar.total = null;
  googleScholar.reason = 'The citation provider is temporarily unavailable.';
  googleScholar.countsByYear = [];
  googleScholar.cumulativeCountsByYear = [];
  googleScholar.history = {
    status: 'unavailable',
    annualTotal: null,
    reportedTotal: null,
    reconciliationDelta: null,
    unassignedCount: null,
    excessAnnualCount: null,
    reason: 'provider-year-history-unavailable'
  };

  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(snapshot)
  }), { times: 1 });
  await page.goto('/Statistics.dc.html', { waitUntil: 'load' });
  const googleScholarCard = page.locator('[data-citation-source-card]')
    .filter({ hasText: googleScholar.label });
  await expect(googleScholarCard.locator('.statistics-source-total')).toHaveText('\u2014');
  await expect(googleScholarCard.locator('.statistics-source-total')).not.toHaveText('0');
  await expect(googleScholarCard).toContainText(googleScholar.provider);
  await expect(googleScholarCard).toContainText(googleScholar.reason);
  await page.selectOption('#citation-source-select', 'googleScholar');
  await expect(page.getByText(/Annual and cumulative history are unavailable for Google Scholar/)).toBeVisible();

  await page.route('**/data/lab-statistics.json*', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: '{}'
  }));
  await page.reload({ waitUntil: 'load' });
  await expect(page.getByRole('alert')).toContainText('Statistics are temporarily unavailable.');
  await expect(page.locator('.statistics-summary-grid')).toHaveCount(0);
});
