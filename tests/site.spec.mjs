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
  await expect(page.getByText('Computation', { exact: true })).toBeVisible();
  await expect(page.getByText('Physics', { exact: true })).toBeVisible();
  await expect(page.getByText('Systems', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Machine Learning\s*×/).first()).toBeVisible();
  await expect(page.getByText(/^Reticular Materials\s*×/).first()).toBeVisible();
  await expect(page.getByText(/^Review\s*×/).first()).toBeVisible();
  const dft = page.getByText(/^DFT\s*×/).first();
  await expect(dft).toBeVisible();
  await dft.click();
  await expect(page.getByText(/publications found/)).toBeVisible();
  await dft.click();
  await page.getByPlaceholder(/Search publications/).fill('PACMAN');
  await expect(page.getByText(/PACMAN: A Robust Partial Atomic Charge/)).toBeVisible();
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
  await expect(profile.getByText('B.S. Chemical & Biomolecular Engineering, Pusan National University (2027)', { exact: true })).toBeVisible();

  await page.goto('/Join%20Us.dc.html', { waitUntil: 'domcontentloaded' });
  const undergraduateOpening = page.getByText('Undergraduate interns').locator('..');
  await expect(undergraduateOpening.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByText(/학부연구생을 상시 모집합니다/)).toBeVisible();
  await expect(page.getByText(/부산광역시 금정구 부산대학로 63번길 2/)).toBeVisible();
  await expect(page.getByText(/제7공학관 302호 \(학생연구실\) · 부속연구동 201호 \(교수연구실\)/)).toBeVisible();
});


test('quantum language, Baek focus, and audited review taxonomy are rendered', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/quantum and atomistic simulations/)).toBeVisible();
  for (const keyword of ['quantum and atomistic simulations', 'statistical mechanics', 'curated data', 'artificial intelligence']) {
    await expect(page.locator('strong', { hasText: keyword })).toBeVisible();
  }
  await expect(page.getByText(/양자·원자 시뮬레이션/)).toBeVisible();

  await page.goto('/People.dc.html', { waitUntil: 'domcontentloaded' });
  const baek = page.locator('#m-baek');
  await expect(baek.getByText('AI & Data', { exact: true })).toBeVisible();
  await expect(baek.getByText('Atoms/Electrons', { exact: true })).toHaveCount(0);

  await page.goto('/Publications.dc.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-publication-no="19"]')).toHaveCount(0);
  await page.getByPlaceholder(/Search publications/).fill('Surface area determination');
  await expect(page.getByText('Review', { exact: true })).toHaveCount(0);
  await expect(page.getByText('GCMC', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reticular Materials', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Carbons', { exact: true }).first()).toBeVisible();
});
