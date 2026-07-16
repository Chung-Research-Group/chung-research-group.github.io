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
