import { expect, test } from '@playwright/test'

// Exercise the real router and page with a delayed, isolated workspace.
// No account or remote database is used by this rendering regression test.
test('map switching stays mounted and fits portrait, landscape, tablet and desktop', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const module = async (path: string, body: string) => {
    await page.route(`**/src/${path}`, route => route.fulfill({ contentType: 'application/javascript', body }))
  }
  await page.route('**/src/main.tsx', async route => {
    const original = await (await route.fetch()).text()
    const react = original.match(/from "([^" ]*\/react\.js[^" ]*)"/)![1]
    const reactDom = original.match(/from "([^" ]*\/react-dom_client\.js[^" ]*)"/)![1]
    await route.fulfill({ contentType: 'application/javascript', body: `
      import React from '${react}';
      import ReactDOM from '${reactDom}';
      import App from '/src/App.tsx';
      import '/src/index.css';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    ` })
  })
  await module('auth/useAuth.ts', `export const useAuth = () => ({ status: 'authenticated', userRole: 'member', hasWorkspaceAccess: true, user: { id: 'fixture', email: 'fixture@example.invalid' } });`)
  await module('database/useDatabaseMode.ts', `export const useDatabaseMode = () => 'indexeddb';`)
  await module('database/useHybridDataRevision.ts', `export const useHybridDataRevision = () => 0;`)
  await module('modules/region/region.controller.ts', `
    const regions = [
      { id: 'okinawa', name: '沖繩', mapProvider: 'osm' },
      { id: 'taiwan', name: '台灣', mapProvider: 'osm', osmDataset: 'taiwan' },
      { id: 'japan', name: '日本', mapProvider: 'osm', osmDataset: 'japan' },
    ];
    export class RegionController {}
    export const regionController = {
      async loadWorkspace() {
        await new Promise(resolve => setTimeout(resolve, 400));
        return { regions, trips: [{ id: 'trip', regionId: 'taiwan' }], places: [{ id: 'place', regionIds: ['japan'] }] };
      }
    };
  `)
  await page.addInitScript(() => {
    localStorage.setItem('travel-planner:map-provider', 'osm')
    localStorage.setItem('travel-planner:osm-dataset', 'okinawa')
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/regions')
  await expect(page.getByText('正在載入地圖…', { exact: true })).toBeVisible()
  await expect(page.getByText('預設地圖尚未載入', { exact: true })).toHaveCount(0)
  await expect(page.locator('.region-detail-heading h2')).toHaveText('沖繩')
  await page.evaluate(() => {
    const detail = document.querySelector('.region-detail')!
    const failures: string[] = []
    Object.assign(window, { regionRenderFailures: failures })
    new MutationObserver(() => {
      if (!detail.isConnected) failures.push('detail unmounted')
      if (document.querySelector('.region-empty-detail')) failures.push('empty detail flashed')
    }).observe(document.querySelector('#root')!, { childList: true, subtree: true })
  })
  for (const name of ['台灣', '日本', '沖繩', '日本', '台灣']) {
    await page.getByRole('button', { name: new RegExp(`${name}.*個行程`) }).click()
    await expect(page.locator('.region-detail-heading h2')).toHaveText(name)
    await expect(page.getByRole('button', { pressed: true })).toContainText(name)
  }
  await expect(page.locator('.region-stat').first()).toContainText('1 個')
  // Another tab/account preference update must also select in place.
  await page.evaluate(() => {
    localStorage.setItem('travel-planner:osm-dataset', 'japan')
    window.dispatchEvent(new StorageEvent('storage', { key: 'travel-planner:osm-dataset' }))
  })
  await expect(page.locator('.region-detail-heading h2')).toHaveText('日本')
  await expect(page.locator('.region-stat').last()).toContainText('1 個')
  expect(await page.evaluate(() => (window as unknown as { regionRenderFailures: string[] }).regionRenderFailures)).toEqual([])

  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [768, 1024], [1024, 768], [1440, 900], [568, 320], [844, 390]]) {
    await page.setViewportSize({ width, height })
    const bounds = await page.evaluate(() => {
      const root = document.documentElement
      const detail = document.querySelector('.region-detail-card')!.getBoundingClientRect()
      const list = document.querySelector('.region-list-card')!.getBoundingClientRect()
      const overflow = [...document.querySelectorAll('.region-content, .region-list-card, .region-detail-card')].filter(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1).length
      return { width: root.scrollWidth, height: root.scrollHeight, bottom: detail.bottom, gap: detail.top - list.bottom, overflow }
    })
    expect(bounds.width, `${width}x${height} page width`).toBeLessThanOrEqual(width)
    expect(bounds.height, `${width}x${height} page height`).toBeLessThanOrEqual(height)
    expect(bounds.bottom, `${width}x${height} visible detail`).toBeLessThanOrEqual(height)
    expect(bounds.overflow, `${width}x${height} inner overflow`).toBe(0)
    if (width <= 480) expect(bounds.gap).toBeLessThanOrEqual(10)
    const icons = page.locator('.region-stat-icon')
    await expect(icons).toHaveCount(2)
    await expect(icons.first()).toBeVisible()
    await expect(icons.last()).toBeVisible()
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`regions-${width}.png`) })
  }
  expect(errors).toEqual([])
})
