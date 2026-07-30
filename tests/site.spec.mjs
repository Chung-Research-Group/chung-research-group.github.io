import { expect, test } from '@playwright/test';

const pages = [
  'index.html', 'News.dc.html', 'People.dc.html',
  'Software%20%26%20Data.dc.html', 'Publications.dc.html', 'Join%20Us.dc.html',
  'AIM.dc.html', 'CoRE%20MOF%20Database.dc.html', 'GWP-estimator.dc.html',
  'MOFClassifier.dc.html', 'PACMAN.dc.html', 'SESAMI-APP.dc.html'
];

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
  await expect(status).toContainText(/updated/i);
  await expect(page.getByText('Citations (Google Scholar)', { exact: true })).toBeVisible();
  await expect(page.getByText('Citations (OpenAlex)', { exact: true })).toBeVisible();
  await expect(page.getByText('Citations (Semantic Scholar)', { exact: true })).toBeVisible();
  await expect(page.locator('[data-publication-enrichment]').first()).toBeVisible();
  expect(externalMetadataRequests).toEqual([]);
});

test('publication citation exports are linked and served as complete files', async ({ page, request }) => {
  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  await expect(page.getByRole('link', { name: 'Download all publications as a BibTeX file' })).toHaveAttribute('href', 'exports/publications/publications.bib');
  await expect(page.getByRole('link', { name: 'Download all publications as a Citation File Format file' })).toHaveAttribute('href', 'exports/publications/CITATION.cff');
  const [bibtexResponse, cffResponse] = await Promise.all([
    request.get('/exports/publications/publications.bib'),
    request.get('/exports/publications/CITATION.cff')
  ]);
  expect(bibtexResponse.ok()).toBe(true);
  expect(cffResponse.ok()).toBe(true);
  expect((await bibtexResponse.text()).match(/^@article\{/gm)).toHaveLength(72);
  expect((await cffResponse.text()).match(/^  - type: "article"$/gm)).toHaveLength(72);
});

test('Google Scholar aggregate is rendered from the static snapshot', async ({ page }) => {
  await page.route('**/data/publication-metadata.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 2,
      snapshotUpdatedAt: '2026-07-30T00:00:00.000Z',
      sources: {
        googleScholar: {
          status: 'ok',
          reason: null,
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
  const card = page.getByText('Citations (Google Scholar)', { exact: true }).locator('..');
  await expect(card).toContainText('9,876');
});

test('publication search includes a rendered metadata field or keyword', async ({ page }) => {
  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
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
  const scholarCard = page.locator('[data-google-scholar-citations]');
  await expect(scholarCard).toBeVisible();
  await expect(scholarCard.locator('p').first()).toHaveText('\u2014');
  const publicationSearch = page.getByPlaceholder(/Search publications/);
  await publicationSearch.fill('PACMAN');
  await expect(page.getByText(/PACMAN: A Robust Partial Atomic Charge/)).toBeVisible();
});

test('graphical abstracts are generated locally and loaded only when expanded', async ({ page }) => {
  const graphicRequests = [];
  page.on('request', request => {
    if (request.url().includes('/images/publications/graphical-abstracts/')) {
      graphicRequests.push(request.url());
    }
  });

  await page.goto('/Publications.dc.html', { waitUntil: 'load' });
  const panels = page.locator('[data-graphical-abstract]');
  await expect(panels).toHaveCount(72);
  expect(graphicRequests).toEqual([]);

  const first = panels.first();
  const summary = first.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('open', '');
  const image = first.locator('[data-graphical-abstract-image]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
  expect(graphicRequests).toHaveLength(1);
  await expect(first.locator('[data-graphical-abstract-fallback]')).toBeHidden();
  await expect(first.getByText(/Not the publisher?s official graphical abstract/)).toBeVisible();
});

test('every published page has metadata and renders its heading', async ({ page }) => {
  test.setTimeout(90_000);
  for (const route of pages) {
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
  await expect(page.getByText(/^Machine Learning\s*?/).first()).toBeVisible();
  await expect(page.getByText(/^Reticular Materials\s*?/)).toHaveCount(0);
  const computationLabels = computationGroup.locator('.publication-filter-items > span');
  await expect(computationLabels.first()).toContainText('Grand Canonical Monte Carlo ? 27');

  // Major categories can be expanded and selected as aggregate filters.
  await physicsGroup.getByRole('button', { name: 'Expand Physics' }).click();
  await expect(page.getByText(/^Machine Learning\s*?/)).toHaveCount(0);
  await expect(page.getByText(/^Adsorption\s*?\s*41$/)).toBeVisible();
  await expect(page.getByText(/publications found/)).toBeVisible();
  await physicsGroup.getByRole('button', { name: 'Collapse Physics' }).click();

  // A major category opens all of its middle and detailed categories at once.
  await applicationGroup.getByRole('button', { name: 'Expand Applications' }).click();
  await expect(applicationGroup.locator('.publication-filter-section-title')).toHaveText(['?Separation', '?Catalysis', '?Energy Storage', '?Other']);
  await expect(applicationGroup.getByText(/^Xylene Isomer\s*?\s*1$/)).toBeVisible();
  await expect(applicationGroup.getByText(/^Hydrogen\s*?\s*4$/)).toBeVisible();
  const separationSection = applicationGroup.locator('[data-filter-section="Separation"]');
  await separationSection.getByRole('button', { name: 'Collapse Separation' }).click();
  await expect(applicationGroup.getByText(/^Xylene Isomer\s*?/)).toHaveCount(0);
  await separationSection.getByRole('button', { name: 'Expand Separation' }).click();
  await expect(applicationGroup.getByText(/^Xylene Isomer\s*?\s*1$/)).toBeVisible();
  await expect(applicationGroup.getByText(/^Catalysis\s*?/)).toHaveCount(0);
  await expect(page.getByText(/publications found/)).toBeVisible();
  await separationSection.getByRole('button', { name: 'Collapse Separation' }).click();

  // Review has no redundant Review ? 6 label; its topic filters appear on expand.
  await expect(reviewGroup.getByText(/^Review\s*?/)).toHaveCount(0);
  await reviewGroup.getByRole('button', { name: 'Expand Review' }).click();
  await expect(reviewGroup.getByText(/^Applications\s*?\s*2$/)).toBeVisible();

  await computationGroup.getByRole('button', { name: 'Expand Computation' }).click();
  const dft = page.getByText(/^Density Functional Theory\s*?/).first();
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
  await expect(page.getByText('Latest publications ? ?? ??', { exact: true })).toBeVisible();
  await expect(page.locator('[data-home-publication]')).toHaveCount(6);
});

test('graduate program data is rendered without duplicate education text', async ({ page }) => {
  await page.goto('/People.dc.html', { waitUntil: 'load' });
  await expect(page.getByText('B.S./M.S. Program', { exact: true })).toBeVisible();
  await expect(page.getByText("Master's Program, Graduate School of Data Science", { exact: true })).toBeVisible();
  await expect(page.getByText('Graduate School of Data Science, Pusan National University ??????? ?????')).toHaveCount(0);
});

test('Hyunji Kim is listed as a current undergraduate researcher', async ({ page }) => {
  await page.goto('/People.dc.html', { waitUntil: 'load' });
  const profile = page.locator('#m-kim-hyunji');
  await expect(profile.locator('h4').getByText('Kim, Hyunji', { exact: true })).toBeVisible();
  await expect(profile.locator('h4').getByText('???', { exact: true })).toBeVisible();
  await expect(profile.locator('a[href="https://github.com/Kimhyunji4"]')).toBeVisible();
  await expect(profile.locator('a[href="https://www.linkedin.com/in/hyunji-kim-051743359"]')).toBeVisible();
  await expect(profile.getByText('Modeling & Optimization', { exact: true })).toBeVisible();
});

test('undergraduate recruiting is open', async ({ page }) => {
  await page.goto('/Join%20Us.dc.html', { waitUntil: 'load' });
  const undergraduateOpening = page.getByText('Undergraduate interns').locator('..');
  await expect(undergraduateOpening.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByText(/?????? ?? ?????/)).toBeVisible();
  await expect(page.getByText(/????? ??? ????? 63?? 2/)).toBeVisible();
  await expect(page.getByText('?? ??? ? ?7??? 302?', { exact: true })).toBeVisible();
  const professorOfficeAddress = page.getByText('?? ??? ? ?7??? ????? 201?', { exact: true });
  await expect(professorOfficeAddress).toBeVisible();
  await expect(professorOfficeAddress.locator('xpath=ancestor::a')).toHaveCount(0);
  await expect(page.getByText('?? ??? ? +82 51 510 3757', { exact: true })).toBeVisible();
  await expect(page.getByText('?? ??? ? +82 51 510 3082', { exact: true })).toBeVisible();
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
  await expect(page.getByText(/????? ?????/)).toBeVisible();
  await expect(page.getByText(/????????? ??? ??/)).toBeVisible();

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
