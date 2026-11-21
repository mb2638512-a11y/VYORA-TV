import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'

const baseURL = process.env.VYORA_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
await page.addInitScript(() => {
  window.__vyoraModes = []
  window.__vyoraSuggestionEngines = []
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input?.url || ''
    if (raw.includes('/api/suggest')) {
      const requestUrl = new URL(raw, window.location.href)
      const engine = requestUrl.searchParams.get('engine') || ''
      window.__vyoraSuggestionEngines.push(engine)
      return Promise.resolve(new Response(JSON.stringify({
        engine,
        suggestions: [`${engine} suggestion result`],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return originalFetch(input, init)
  }
  window.VyoraBridge = {
    setBrowserDisplayMode(mode) {
      window.__vyoraModes.push(mode)
    },
  }
})
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1200)

  const browserRegion = page.getByRole('region', { name: 'Chromium Web Browser' })
  if (!(await browserRegion.isVisible().catch(() => false))) {
    const openBrowser = page.getByRole('button', { name: /open browser|browser/i }).first()
    if (!(await openBrowser.count())) {
      throw new Error('Could not find the Open Browser control on the VYORA home screen')
    }
    await openBrowser.click()
  }

  await browserRegion.waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('button[title*="Responsive View"], button[title*="Desktop 1080p View"]').first().waitFor({ state: 'visible', timeout: 10000 })

  // Verify autocomplete uses the active search provider, not Google's list
  // under every engine. The API is stubbed so CI never depends on third parties.
  const engineTrigger = page.locator('.chromium-engine-trigger')
  const omnibox = page.locator('.chromium-omnibox-input')
  for (const engine of ['bing', 'duckduckgo']) {
    await engineTrigger.click()
    await page.locator('.chromium-engine-menu button.chromium-engine-option').filter({ hasText: engine === 'bing' ? 'Bing' : 'DuckDuckGo' }).first().evaluate((element) => element.click())
    await page.locator('.chromium-engine-menu').waitFor({ state: 'hidden', timeout: 3000 })
    const selectedEngine = await page.locator('.chromium-engine-trigger-name').textContent()
    if (!selectedEngine?.toLowerCase().includes(engine === 'bing' ? 'bing' : 'duckduckgo')) {
      throw new Error(`Expected ${engine} to be selected, got: ${selectedEngine}`)
    }
    await omnibox.fill('vyora browser')
    await page.waitForTimeout(350)
    const observedEngines = await page.evaluate(() => window.__vyoraSuggestionEngines || [])
    if (!observedEngines.includes(engine)) {
      throw new Error(`${engine} autocomplete request did not include the selected provider`)
    }
    await page.locator('.chromium-suggestions').getByText(`${engine} suggestion result`).waitFor({ state: 'visible', timeout: 5000 })
  }

  // Bookmark JSON backup and restore must work without a backend.
  const exportPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await exportPromise
  if (exported.suggestedFilename() !== 'vyora-bookmarks.json') {
    throw new Error('Bookmark export did not create the expected JSON file')
  }
  await page.locator('input[aria-label="Import bookmarks file"]').setInputFiles({
    name: 'vyora-smoke-bookmarks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      bookmarks: [{ title: 'Smoke Bookmark', url: 'https://example.com/', color: '#123456' }],
    })),
  })
  await page.locator('.chromium-bookmarks-bar').getByText('Smoke Bookmark').waitFor({ state: 'visible', timeout: 5000 })

  // Closing the only tab must create and activate a fresh New Tab instead
  // of leaving the browser with an activeTabId that no longer exists.
  await page.getByRole('button', { name: 'Close Tab' }).click()
  await page.locator('.chromium-tab-title').getByText('New Tab').waitFor({ state: 'visible', timeout: 5000 })
  await page.keyboard.press('Control+Shift+T')
  await page.waitForFunction(() => document.querySelectorAll('.chromium-tab').length === 2, null, { timeout: 5000 })

  await fs.mkdir('artifacts/browser-smoke', { recursive: true })
  await page.screenshot({ path: 'artifacts/browser-smoke/browser-before.png', fullPage: true })

  const modeButton = page.locator('button[title*="Responsive View"], button[title*="Desktop 1080p View"]').first()
  await modeButton.click()
  await page.locator('button[title*="Desktop 1080p View: ON"]').waitFor({ state: 'visible', timeout: 5000 })

  const nativeModes = await page.evaluate(() => window.__vyoraModes || [])
  if (!nativeModes.includes('desktop')) {
    throw new Error('Desktop mode did not reach the native WebView bridge')
  }

  await page.screenshot({ path: 'artifacts/browser-smoke/browser-desktop-mode.png', fullPage: true })
  if (pageErrors.length) throw new Error('Browser page errors: ' + pageErrors.join(' | '))
  console.log('VYORA browser smoke test passed; native mode calls:', nativeModes.join(', '))
} catch (error) {
  await fs.mkdir('artifacts/browser-smoke', { recursive: true })
  await page.screenshot({ path: 'artifacts/browser-smoke/browser-failure.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser.close()
}
