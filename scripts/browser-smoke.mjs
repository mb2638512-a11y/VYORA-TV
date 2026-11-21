import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'

const baseURL = process.env.VYORA_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []

await page.addInitScript(() => {
  window.__vyoraModes = []
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
