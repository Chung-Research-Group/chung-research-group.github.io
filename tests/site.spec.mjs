import { expect, test } from '@playwright/test';

const pages = [
  'index.html', 'News.dc.html', 'People.dc.html', 'Research.dc.html',
  'Software%20%26%20Data.dc.html', 'Publications.dc.html', 'Join%20Us.dc.html',
  'AIM.dc.html', 'CoRE%20MOF%20Database.dc.html', 'GWP-estimator.dc.html',
  'MOFClassifier.dc.html', 'PACMAN.dc.html', 'SESAMI-APP.dc.html'
];

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:/, route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'unpkg.com' ? route.continue() : route.abort();
  });
});

test('every published page has metadata and renders its heading', async ({ page }) => {
  for (const route of pages) {
    const response = await page.goto(`/${route}`, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), route).toBeTruthy();
    await expect(page.locator('html')).toHaveAttribute('lang', /en/);
    await expect(page).toHaveTitle(/Chung Research Group/);
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
  }
});

test('publication topic filters and search work', async ({ page }) => {
  await page.goto('/Publications.dc.html', { waitUntil: 'domcontentloaded' });
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
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Latest publications · 최신 논문', { exact: true })).toBeVisible();
  await expect(page.locator('[data-home-publication]')).toHaveCount(6);
});

test('graduate program data is rendered without duplicate education text', async ({ page }) => {
  await page.goto('/People.dc.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('B.S./M.S. Program', { exact: true })).toBeVisible();
  await expect(page.getByText("Master's Program, Graduate School of Data Science", { exact: true })).toBeVisible();
  await expect(page.getByText('Graduate School of Data Science, Pusan National University 데이터사이언스 전문대학원')).toHaveCount(0);
});

test('Hyunji Kim is listed as a current undergraduate researcher and recruiting is open', async ({ page }) => {
  await page.goto('/People.dc.html', { waitUntil: 'domcontentloaded' });
  const profile = page.locator('#m-kim-hyunji');
  await expect(profile.locator('h4').getByText('Kim, Hyunji', { exact: true })).toBeVisible();
  await expect(profile.locator('h4').getByText('김현지', { exact: true })).toBeVisible();
  await expect(profile.locator('a[href="https://github.com/Kimhyunji4"]')).toBeVisible();
  await expect(profile.locator('a[href="https://www.linkedin.com/in/hyunji-kim-051743359"]')).toBeVisible();
  await expect(profile.locator('img[src="images/slot-ph-kim-hyunji.webp"]').first()).toBeVisible();
  await expect(profile.getByText('Modeling & Optimization', { exact: true })).toBeVisible();
  await expect(profile.getByText('Chemical & Biomolecular Engineering, Pusan National University', { exact: true })).toBeVisible();
  await expect(profile.getByText(/B\.S\.|2027/)).toHaveCount(0);

  await page.goto('/Join%20Us.dc.html', { waitUntil: 'domcontentloaded' });
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
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/quantum and atomistic simulations/)).toBeVisible();
  for (const keyword of ['quantum and atomistic simulations', 'statistical mechanics', 'curated data', 'artificial intelligence']) {
    await expect(page.locator('strong', { hasText: keyword })).toBeVisible();
  }
  await expect(page.getByText(/양자·원자 시뮬레이션/)).toBeVisible();
  await expect(page.getByText(/에너지·환경·산업 분야의 응용/)).toBeVisible();

  await page.goto('/People.dc.html', { waitUntil: 'domcontentloaded' });
  const baek = page.locator('#m-baek');
  await expect(baek.getByText('AI & Data', { exact: true })).toBeVisible();
  await expect(baek.getByText('Atoms/Electrons', { exact: true })).toHaveCount(0);

  await page.goto('/Publications.dc.html', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/Search publications/).fill('Surface area determination');
  const jpcc = page.locator('[data-publication-no="19"]');
  await expect(jpcc).toBeVisible();
  await expect(jpcc.getByText('Review', { exact: true })).toHaveCount(0);
  await expect(jpcc.getByText('Grand Canonical Monte Carlo', { exact: true })).toBeVisible();
  await expect(jpcc.getByText('Reticular Materials', { exact: true })).toBeVisible();
  await expect(jpcc.getByText('Carbons', { exact: true })).toBeVisible();
});
