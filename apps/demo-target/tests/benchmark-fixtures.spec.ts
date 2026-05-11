import { expect, type Locator, type Page, test } from '@playwright/test';

async function assertElementNotObstructed(page: Page, locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error(`${label} has no bounding box.`);
  }

  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const result = await locator.evaluate(
    (targetElement, { x, y }) => {
      const top = document.elementFromPoint(x, y);
      const topElement = top as HTMLElement | null;
      const isClear = Boolean(top && (top === targetElement || targetElement.contains(top)));

      return {
        isClear,
        topNode: topElement
          ? `${topElement.tagName} ${(topElement.textContent ?? '').replace(/\s+/g, ' ').trim()}`
          : 'none',
      };
    },
    center,
  );

  expect(result.isClear, `${label} is covered by ${result.topNode}`).toBe(true);
}

test('hidden-mobile-cta: mobile checkout CTA is visible, unobstructed, and completes checkout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^pro\b/i }).click();

  const payNow = page.getByRole('link', { name: /pay now/i });
  await expect(payNow).toBeVisible();
  await assertElementNotObstructed(page, payNow, 'Pay now CTA');

  await payNow.click();
  await expect(page).toHaveURL(/success/);
  await expect(page.getByRole('heading', { name: /checkout complete/i })).toBeVisible();
});

test('wrong-plan-param: selecting Pro passes plan=pro into checkout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^pro\b/i }).click();

  await expect(page).toHaveURL(/\/checkout\?plan=pro/);
  await expect(page.getByRole('heading', { name: /pro plan/i })).toBeVisible();
  await expect(page.getByText('Total due today: $49.00')).toBeVisible();
});

test('keyboard-focus-trap: keyboard focus reaches Pay now and activates checkout', async ({ page }) => {
  await page.goto('/checkout?plan=pro');
  const payNow = page.getByRole('link', { name: /pay now/i });

  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');

    if (await payNow.evaluate((element) => element === document.activeElement)) {
      break;
    }
  }

  await expect(payNow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/success/);
});

test('api-route-404: checkout API accepts Pro checkout submissions', async ({ request }) => {
  const response = await request.post('/api/checkout', {
    data: { plan: 'pro' },
  });
  const body = await response.json() as { ok?: boolean; plan?: string; redirectTo?: string };

  expect(response.status(), 'Checkout API should not 404 or 500').toBe(200);
  expect(body).toEqual({ ok: true, plan: 'pro', redirectTo: '/success' });
});

test('signup-route-typo: signup submission reaches success', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill('qa@example.com');
  await page.getByLabel('Workspace').fill('FlowPR Labs');
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page).toHaveURL(/success/);
  await expect(page.getByRole('heading', { name: /checkout complete/i })).toBeVisible();
});
