import { expect, test } from '@playwright/test'

test('the app serves its initial screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('TRAVEL PLANNER')).toBeVisible({ timeout: 5_000 })
})
