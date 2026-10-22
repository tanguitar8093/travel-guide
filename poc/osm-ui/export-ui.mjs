import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const output = path.resolve('poc/ui')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(15000)

const staticBehavior = `
const states={itinerary:'osm-itinerary.html',places:'osm-places.html','route-calculator':'osm-route-calculator.html'};
document.querySelectorAll('a[href]').forEach(a=>{const key=a.getAttribute('href').replace(/^\\//,'').split('?')[0];if(states[key])a.href=states[key];});
const menu=document.querySelector('.workspace-sidebar-toggle');
if(menu)menu.onclick=()=>{const shell=document.querySelector('.workspace-layout');const open=shell.dataset.sidebarOpen!=='true';shell.dataset.sidebarOpen=String(open);menu.setAttribute('aria-expanded',String(open));const side=document.querySelector('.workspace-sidebar');side.inert=!open;side.setAttribute('aria-hidden',String(!open));};
document.querySelectorAll('.preview-search-help').forEach(b=>b.onclick=()=>b.parentElement.querySelector('dialog').showModal());
document.querySelectorAll('.preview-search-dialog').forEach(d=>{d.querySelector('button').onclick=()=>d.close();d.onclick=e=>{if(e.target===d)d.close();};});
document.querySelectorAll('button').forEach(b=>{
const label=(b.textContent||'').trim();
if(b.classList.contains('primary-button')&&label.includes('地點'))b.onclick=()=>location.href='osm-places-new.html';
if(label==='編輯資料')b.onclick=()=>location.href='osm-places-edit.html';
if(label==='取消'&&location.pathname.includes('osm-places'))b.onclick=()=>location.href='osm-places.html';
if(b.classList.contains('route-endpoint-trigger'))b.onclick=()=>location.href='osm-route-new-place.html';
if(label==='新地點搜尋')b.onclick=()=>location.href='osm-route-new-place.html';
if(label==='已存地點')b.onclick=()=>location.href='osm-route-saved-place.html';
if(b.classList.contains('route-dialog-close'))b.onclick=()=>location.href='osm-route-calculator.html';
if(b.closest('.itinerary-day-strip'))b.onclick=()=>location.href=label.includes('08')?'osm-itinerary-day-2.html':'osm-itinerary.html';
});
`

async function save(filename, title) {
  const map = page.locator('.maplibregl-canvas').first()
  let mapImage
  if (await map.count()) mapImage = (await map.screenshot()).toString('base64')
  const html = await page.evaluate(({ title, mapImage, staticBehavior }) => {
    const root = document.body.cloneNode(true)
    root.querySelectorAll('script').forEach(el => el.remove())
    const css = [...document.styleSheets].flatMap(sheet => {
      try { return [...sheet.cssRules].map(rule => rule.cssText) } catch { return [] }
    }).join('\n')
    // Preserve form state, since attributes do not follow React's controlled values.
    const originals = document.querySelectorAll('input,textarea,select')
    root.querySelectorAll('input,textarea,select').forEach((field, i) => {
      const original = originals[i]
      if (field.tagName === 'INPUT') {
        field.setAttribute('value', original.value)
        original.checked ? field.setAttribute('checked','') : field.removeAttribute('checked')
      } else if (field.tagName === 'TEXTAREA') field.textContent = original.value
      else [...field.options].forEach(option => option.value === original.value ? option.setAttribute('selected','') : option.removeAttribute('selected'))
    })
    if (mapImage) root.querySelectorAll('.maplibregl-map').forEach(host => {
      host.replaceChildren()
      const image = document.createElement('img')
      image.src = 'data:image/png;base64,' + mapImage
      image.alt = '已核准的沖繩 OSM 底圖與圖釘畫面'
      image.style.cssText = 'display:block;width:100%;height:100%;object-fit:fill'
      host.append(image)
    })
    root.querySelectorAll('vite-error-overlay').forEach(el=>el.remove())
    return '<!doctype html>\n<html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' · 已核准 UI 設計稿</title><!-- Approved by user, 2026-10-23 Asia/Taipei. Static UI snapshot; no database or API operations. Map is an embedded image. --><style>' + css + '</style></head>' + root.outerHTML.replace('</body>', '<script>' + staticBehavior + '</script></body>') + '</html>'
  }, { title, mapImage, staticBehavior })
  await writeFile(path.join(output, filename), html)
  console.log('Saved', filename)
}

try {
  await page.goto('http://127.0.0.1:5174/itinerary')
  await page.locator('.itinerary-google-map .google-map-marker').first().waitFor({ timeout: 65000 })
  await page.waitForTimeout(1000)
  await save('osm-itinerary.html', '行程・OSM 地圖')
  await page.getByRole('button', { name: '08', exact: false }).click()
  await save('osm-itinerary-day-2.html', '行程・第二天')

  await page.goto('http://127.0.0.1:5174/places')
  await page.getByRole('button', { name: '編輯資料' }).waitFor()
  await page.waitForTimeout(500)
  await save('osm-places.html', '地點・詳細資料')
  await page.getByRole('button', { name: '編輯資料' }).click()
  await page.getByPlaceholder('地點、Google 連結或緯度, 經度').waitFor()
  await save('osm-places-edit.html', '地點・編輯')
  await page.getByRole('button', { name: '取消', exact: true }).first().click()
  await page.locator('.primary-button').first().click()
  await page.getByPlaceholder('地點、Google 連結或緯度, 經度').waitFor()
  await save('osm-places-new.html', '地點・新增與搜尋')

  await page.goto('http://127.0.0.1:5174/route-calculator')
  await page.locator('.route-map-host .google-map-marker').first().waitFor({ timeout: 65000 })
  await page.waitForTimeout(1000)
  await save('osm-route-calculator.html', '路程試算・OSM 地圖')
  await page.locator('.route-endpoint-trigger').first().click()
  await save('osm-route-saved-place.html', '路程試算・已存地點')
  await page.getByRole('button', { name: '新地點搜尋', exact: true }).click()
  await page.getByPlaceholder('地點、Google 連結或緯度, 經度').fill('26.2170, 127.7195')
  await page.locator('.preview-location-result').click()
  await page.getByLabel('地點名稱（自行命名）').fill('海邊停車場')
  await save('osm-route-new-place.html', '路程試算・新地點搜尋與命名')
} finally {
  await browser.close()
}
