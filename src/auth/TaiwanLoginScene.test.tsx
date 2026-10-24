import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuthLoadingPanel } from './AuthGate'

const preference = vi.hoisted(() => ({ dataset: 'okinawa' as string | undefined }))
vi.mock('../geo/osm-dataset-preference', () => ({ useOsmDataset: () => preference.dataset }))
afterEach(() => { preference.dataset = 'okinawa' })

it('uses the Taiwan festival scene for the saved Taiwan preference on the login welcome', () => {
  preference.dataset = 'taiwan'
  const html = renderToStaticMarkup(<AuthLoadingPanel welcome ready />)
  expect(html).toContain('Taiwan')
  expect(html).toContain('台灣原住民豐年祭')
  expect(html).toContain('taiwan-festival-dancer')
  expect(html).not.toContain('okinawa-login-scene')
  expect(html).toContain('準備出發')
})

it('keeps Okinawa welcome and regular loading behavior', () => {
  expect(renderToStaticMarkup(<AuthLoadingPanel welcome />)).toContain('okinawa-login-scene')
  preference.dataset = 'taiwan'
  const html = renderToStaticMarkup(<AuthLoadingPanel />)
  expect(html).toContain('tour-guide')
  expect(html).not.toContain('taiwan-login-scene')
})
