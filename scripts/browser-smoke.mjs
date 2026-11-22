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
    isTvDevice() {
      return sessionStorage.getItem('vyora-test-tv') === 'true'
    },
    setBrowserDisplayMode(mode) {
      window.__vyoraModes.push(mode)
    },
  }
})
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1200)

  // Exercise the newly integrated entertainment hubs against the local catalogue.
  await page.getByRole('button', { name: 'Movies', exact: true }).click()
  const movieCards = page.locator('.movie-card')
  await movieCards.first().waitFor({ state: 'visible', timeout: 15000 })
  if (await movieCards.count() !== 48) {
    throw new Error('Movies hub should initially render 48 cards, found ' + await movieCards.count())
  }
  await page.locator('.load-more').click()
  if (await movieCards.count() !== 96) {
    throw new Error('Movies Load More should render 96 cards, found ' + await movieCards.count())
  }
  const movieSearch = page.locator('.moviebox-search-input').first()
  await movieSearch.fill('Dune: Part Two')
  await page.locator('.movie-card').filter({ hasText: 'Dune: Part Two' }).first()
    .waitFor({ state: 'visible', timeout: 5000 })
  if (await movieCards.count() !== 1) throw new Error('Movie search should return one Dune: Part Two result')
  const duneMeta = await page.locator('.movie-card').filter({ hasText: 'Dune: Part Two' }).locator('.movie-card-sub').textContent()
  if (!duneMeta?.includes('2h 46m')) {
    throw new Error('Dune: Part Two duration should render as 2h 46m; got: ' + duneMeta)
  }
  await page.route('https://vidlink.pro/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body><main id="vyora-embed-smoke">Embedded player loaded</main></body></html>',
  }))
  await page.locator('.movie-card').filter({ hasText: 'Dune: Part Two' }).click()
  const embedFrame = page.locator('iframe.player-embed-frame')
  await embedFrame.waitFor({ state: 'visible', timeout: 10000 })
  await page.frameLocator('iframe.player-embed-frame').locator('#vyora-embed-smoke')
    .waitFor({ state: 'visible', timeout: 5000 })
  await page.locator('.player-loading-stage').waitFor({ state: 'hidden', timeout: 5000 })
  await page.locator('.hud-btn-back').click()
  await page.locator('.player-overlay').waitFor({ state: 'hidden', timeout: 5000 })
  await movieSearch.fill('')

  await page.getByRole('button', { name: 'Series', exact: true }).click()
  const seriesCards = page.locator('.series-card')
  await seriesCards.first().waitFor({ state: 'visible', timeout: 10000 })
  if (await seriesCards.count() !== 23) {
    throw new Error('Series hub expected 23 catalogue entries, found ' + await seriesCards.count())
  }
  const seriesSearch = page.locator('.moviebox-search-input').first()
  await seriesSearch.fill('House of the Dragon')
  if (await seriesCards.count() !== 1) {
    throw new Error('Series search should return exactly House of the Dragon')
  }
  await seriesSearch.fill('')

  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  const songCards = page.locator('.channel-card')
  await songCards.first().waitFor({ state: 'visible', timeout: 10000 })
  if (await songCards.count() !== 240) {
    throw new Error('Songs hub should initially render 240 channels, found ' + await songCards.count())
  }
  await page.locator('.load-more').click()
  if (await songCards.count() !== 480) {
    throw new Error('Songs Load More should render 480 channels, found ' + await songCards.count())
  }
  const songsSearch = page.locator('.moviebox-search-input').first()
  await songsSearch.fill('24/7 Lo-Fi Chill Beats Radio')
  if (await songCards.count() !== 1) {
    throw new Error('Songs search should return exactly the Lo-Fi Chill Beats channel')
  }
  await songsSearch.fill('')
  await page.getByRole('button', { name: 'Home', exact: true }).click()

  // Phone-first navigation: portrait viewport, persistent bottom navigation,
  // touch-sized controls, and a working Movies route without horizontal page overflow.
  await page.setViewportSize({ width: 390, height: 844 })
  const phoneNavWrapper = page.locator('.mobile-bottom-nav')
  const phoneNav = phoneNavWrapper.locator('.topnav')
  await phoneNav.getByRole('button', { name: 'Home', exact: true }).click()
  const phoneNavStyle = await phoneNavWrapper.evaluate((wrapper) => {
    const nav = wrapper.querySelector('.topnav')
    const buttons = Array.from(nav.querySelectorAll('.topnav-btn'))
    const rect = wrapper.getBoundingClientRect()
    const navStyle = getComputedStyle(nav)
    return {
      wrapperPosition: getComputedStyle(wrapper).position,
      bottomGap: Math.abs(window.innerHeight - rect.bottom),
      width: rect.width,
      overflowX: navStyle.overflowX,
      buttonCount: buttons.length,
      buttonsWidth: buttons.reduce((sum, button) => sum + button.getBoundingClientRect().width, 0),
      smallestButtonHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height)),
    }
  })
  if (phoneNavStyle.wrapperPosition !== 'fixed' || phoneNavStyle.bottomGap > 2 ||
      phoneNavStyle.width < 380 || phoneNavStyle.buttonCount < 8 ||
      !['auto', 'scroll'].includes(phoneNavStyle.overflowX) ||
      phoneNavStyle.buttonsWidth <= phoneNavStyle.width ||
      phoneNavStyle.smallestButtonHeight < 44) {
    throw new Error('Portrait phone bottom navigation is not fixed/touch-scrollable: ' + JSON.stringify(phoneNavStyle))
  }
  const phoneOverflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  if (phoneOverflow.content > phoneOverflow.viewport + 2) {
    throw new Error('Phone home screen overflows horizontally: ' + JSON.stringify(phoneOverflow))
  }
  await page.getByRole('button', { name: 'Movies', exact: true }).click()
  await page.locator('.movie-card').first().waitFor({ state: 'visible', timeout: 10000 })
  const phoneMovieLayout = await page.locator('.movie-card').first().evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth }
  })
  if (phoneMovieLayout.width <= 0 || phoneMovieLayout.left < -2 ||
      phoneMovieLayout.right > phoneMovieLayout.viewport + 2) {
    throw new Error('Movie card does not fit portrait phone viewport: ' + JSON.stringify(phoneMovieLayout))
  }
  await fs.mkdir('artifacts/browser-smoke', { recursive: true })
  await page.screenshot({ path: 'artifacts/browser-smoke/android-phone-portrait.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  // A native Leanback signal selects a separate 10-foot TV shell even at a
  // wide viewport; the phone bottom tab bar must not be mounted in TV mode.
  await page.evaluate(() => sessionStorage.setItem('vyora-test-tv', 'true'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  if (await page.locator('html').getAttribute('data-device') !== 'tv' ||
      !(await page.locator('.device-shell-tv').count()) ||
      await page.locator('.mobile-bottom-nav').count()) {
    throw new Error('Native Leanback detection did not select the separate TV navigation shell')
  }

  // Verify D-pad right moves through the primary TV tabs and scrolls the
  // navigation rail to reveal tabs that do not fit on the first screen.
  const tvNav = page.locator('.topbar-tv .topnav')
  const tvNavButtons = tvNav.locator('.topnav-btn')
  const tvNavCount = await tvNavButtons.count()
  await tvNavButtons.first().focus()
  for (let index = 1; index < tvNavCount; index += 1) {
    await page.keyboard.press('ArrowRight')
    const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim() || '')
    const expectedText = (await tvNavButtons.nth(index).textContent())?.trim() || ''
    if (!focusedText.includes(expectedText)) {
      throw new Error('TV D-pad navigation skipped a primary tab: expected ' + expectedText + ', got ' + focusedText)
    }
  }
  const tvNavScroll = await tvNav.evaluate((element) => element.scrollLeft)
  if (tvNavScroll <= 0) {
    throw new Error('TV D-pad navigation did not scroll the primary navigation rail to reveal later tabs')
  }

  await fs.mkdir('artifacts/browser-smoke', { recursive: true })
  await page.screenshot({ path: 'artifacts/browser-smoke/android-tv-shell.png', fullPage: true })
  await page.evaluate(() => sessionStorage.removeItem('vyora-test-tv'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)

  // Verify the built-in AllSiteHub catalogue, category filters, and search.
  const hubNav = page.getByRole('button', { name: 'AllSiteHub', exact: true })
  await hubNav.waitFor({ state: 'visible', timeout: 10000 })
  await hubNav.click()
  const hub = page.locator('.allsitehub-section')
  await hub.waitFor({ state: 'visible', timeout: 10000 })

  // The same synthetic key path used by the Android TV bridge must move focus
  // spatially between category chips, not merely scroll the page.
  const allCategoryTab = hub.getByRole('tab').filter({ hasText: 'All (64)' })
  await allCategoryTab.focus()
  await page.keyboard.press('ArrowRight')
  const focusedCategory = await page.evaluate(() => document.activeElement?.textContent || '')
  if (!focusedCategory.includes('Movies & Shows')) {
    throw new Error('Android TV D-pad navigation did not focus the next AllSiteHub category; focused: ' + focusedCategory)
  }

  const expectedCategories = [['Movies & Shows', 21], ['Anime', 22], ['Manga', 7], ['Live TV & Sports', 10], ['Games', 1], ['Cartoons', 1], ['All in One', 2]]
  const totalSites = await hub.locator('.app-card').count()
  if (totalSites !== 64) throw new Error('Expected 64 AllSiteHub sites, found ' + totalSites)
  const configuredUrls = await hub.locator('.app-card').evaluateAll((cards) =>
    cards.map((card) => ({
      url: card.getAttribute('data-site-url') || '',
      domain: card.getAttribute('data-site-domain') || '',
    }))
  )
  const uniqueUrls = new Set(configuredUrls.map((site) => site.url))
  if (uniqueUrls.size !== 64 || configuredUrls.some((site) => {
    try {
      const parsed = new URL(site.url)
      return parsed.protocol !== 'https:' || !site.domain || parsed.hostname !== site.domain &&
        !parsed.hostname.endsWith('.' + site.domain)
    } catch {
      return true
    }
  })) {
    throw new Error('AllSiteHub must contain 64 unique, valid HTTPS site URLs matching their domains')
  }
  for (const [name, count] of expectedCategories) {
    await hub.getByRole('tab').filter({ hasText: name + ' (' + count + ')' }).click()
    const actual = await hub.locator('.app-card').count()
    if (actual !== count) throw new Error('AllSiteHub category ' + name + ': expected ' + count + ', found ' + actual)
  }
  await hub.getByRole('tab').filter({ hasText: 'All (64)' }).click()

  const hubSearch = hub.getByRole('textbox', { name: 'Search AllSiteHub sites' })
  await hubSearch.fill('gojolive')
  const searchMatches = await hub.locator('.app-card').count()
  const gojoCard = hub.getByRole('group', { name: 'GojoLive website card' })
  if (searchMatches !== 1 || !(await gojoCard.isVisible())) {
    throw new Error('AllSiteHub search should return only GojoLive; found ' + searchMatches)
  }
  await hubSearch.fill('')
  await fs.mkdir('artifacts/browser-smoke', { recursive: true })
  await page.screenshot({ path: 'artifacts/browser-smoke/allsitehub.png', fullPage: true })

  // Check the directory at common TV and portrait-phone viewport sizes.
  for (const viewport of [{ width: 1280, height: 720 }, { width: 720, height: 1280 }]) {
    await page.setViewportSize(viewport)
    await hub.waitFor({ state: 'visible' })
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    if (dimensions.content > dimensions.viewport + 2) {
      throw new Error('AllSiteHub overflows horizontally at ' + viewport.width + 'x' + viewport.height +
        ' (' + dimensions.content + 'px content / ' + dimensions.viewport + 'px viewport)')
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  // Sorting should reorder the catalogue without changing its size.
  const sortButton = hub.getByRole('button', { name: /A–Z/ })
  const firstAZ = await hub.locator('.app-card-title').first().textContent()
  await sortButton.click()
  await hub.getByRole('button', { name: /Z–A/ }).waitFor({ state: 'visible', timeout: 3000 })
  const firstZA = await hub.locator('.app-card-title').first().textContent()
  if (!firstAZ || !firstZA || firstAZ === firstZA) {
    throw new Error('AllSiteHub A–Z / Z–A sort did not reorder the catalogue')
  }

  // Verify the Open action routes a selected site into VYORA Browser.
  // Fulfil a controlled external page: verify the browser iframe really
  // renders site HTML without making this CI test depend on provider uptime.
  await page.route('https://gojolive.site/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>GojoLive smoke</title></head><body><main id="vyora-site-smoke">External page rendered</main></body></html>',
  }))
  await hub.locator('.app-card').filter({ hasText: 'GojoLive' }).getByRole('button', { name: 'Open' }).click()
  const browserRegion = page.getByRole('region', { name: 'Chromium Web Browser' })
  await browserRegion.waitFor({ state: 'visible', timeout: 10000 })
  const openedUrl = await page.locator('.chromium-omnibox-input').inputValue()
  if (openedUrl !== 'https://gojolive.site/') {
    throw new Error('AllSiteHub Open should load GojoLive in VYORA Browser; got ' + openedUrl)
  }
  await page.frameLocator('iframe.chromium-iframe').locator('#vyora-site-smoke')
    .waitFor({ state: 'visible', timeout: 5000 })

  // A top-level window must not be able to spoof the iframe's privileged bridge.
  await page.evaluate(() => window.postMessage({
    type: 'VYORA_NAVIGATE',
    url: 'https://attacker.invalid/forged-navigation',
  }, '*'))
  await page.waitForTimeout(100)
  const urlAfterForgedMessage = await page.locator('.chromium-omnibox-input').inputValue()
  if (urlAfterForgedMessage !== openedUrl) {
    throw new Error('A non-iframe message changed the browser address')
  }
  const directFrameSandbox = await page.locator('iframe.chromium-iframe').getAttribute('sandbox')
  if (!directFrameSandbox?.includes('allow-same-origin')) {
    throw new Error('Direct external pages lost their normal same-origin sandbox capability')
  }

  if (!(await browserRegion.isVisible().catch(() => false))) {
    const openBrowser = page.getByRole('button', { name: /open browser|browser/i }).first()
    if (!(await openBrowser.count())) {
      throw new Error('Could not find the Open Browser control on the VYORA home screen')
    }
    await openBrowser.click()
  }

  await browserRegion.waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('button[title*="Responsive View"], button[title*="Desktop 1080p View"]').first().waitFor({ state: 'visible', timeout: 10000 })

  // Every browser tab must expose the complete Orbit search catalog. The
  // picker is searchable and each tab retains its own selected provider.
  const engineTrigger = page.locator('.chromium-engine-trigger')
  const omnibox = page.locator('.chromium-omnibox-input')
  await engineTrigger.click()
  const engineOptions = page.locator('.chromium-engine-menu button.chromium-engine-option')
  if (await engineOptions.count() !== 131) {
    throw new Error('Expected 130 Orbit destinations plus Brave Search, found ' + await engineOptions.count())
  }
  const engineCatalogSearch = page.getByRole('searchbox', { name: 'Search engine catalog' })
  await engineCatalogSearch.fill('Wikipedia')
  const wikipediaOption = engineOptions.filter({ hasText: 'Wikipedia' }).first()
  await wikipediaOption.waitFor({ state: 'visible', timeout: 5000 })
  await wikipediaOption.click()
  if (!(await page.locator('.chromium-engine-trigger-name').textContent())?.includes('Wikipedia')) {
    throw new Error('Wikipedia was not selected from the searchable engine catalog')
  }
  await omnibox.fill('Albert Einstein')
  await omnibox.press('Enter')
  await page.waitForFunction(() => {
    const frame = document.querySelector('.chromium-iframe')
    if (!frame) return false
    try {
      const src = new URL(frame.src)
      const target = src.searchParams.get('u') || frame.src
      return target.includes('en.wikipedia.org/wiki/Special:Search') && target.includes('Albert')
    } catch { return frame.src.includes('en.wikipedia.org/wiki/Special:Search') }
  }, null, { timeout: 5000 })
  await page.getByRole('button', { name: 'New Tab' }).click()
  if (!(await page.locator('.chromium-engine-trigger-name').textContent())?.includes('Google')) {
    throw new Error('New tab did not use the configured default search provider')
  }
  await engineTrigger.click()
  if (await engineOptions.count() !== 131) {
    throw new Error('The new tab does not expose the full search engine catalog')
  }
  await page.locator('.chromium-engine-backdrop').click()
  await page.locator('.chromium-tab').first().click()
  if (!(await page.locator('.chromium-engine-trigger-name').textContent())?.includes('Wikipedia')) {
    throw new Error('Switching tabs did not preserve the first tab search provider')
  }
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
  await page.locator('.chromium-tab.active .chromium-tab-close').click()
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
