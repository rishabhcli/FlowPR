import { expect, type Locator, type Page, test } from '@playwright/test';

async function assertElementNotObstructed(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Pay now CTA has no bounding box.');
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

  expect(result.isClear, `Pay now CTA is covered by ${result.topNode}`).toBe(true);
}

test('mobile checkout CTA is visible, unobstructed, and completes checkout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /pro/i }).click();

  const payNow = page.getByRole('link', { name: /pay now/i });
  await expect(payNow).toBeVisible();
  await assertElementNotObstructed(page, payNow);

  await payNow.click();
  await expect(page).toHaveURL(/success/);
  await expect(page.getByRole('heading', { name: /checkout complete/i })).toBeVisible();
});
