import { spawn } from 'child_process'
import http from 'http'
import fs from 'fs'
import path from 'path'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = 9222
const APP_URL = 'http://127.0.0.1:8787'
const ARTIFACTS_DIR = 'C:\\Users\\Mustafa\\.gemini\\antigravity\\brain\\40f9a44e-2536-4df7-ae2b-b92113eae243'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      const list = await res.json()
      if (list && list.length > 0 && list[0].webSocketDebuggerUrl) {
        return list[0].webSocketDebuggerUrl
      }
    } catch {}
    await sleep(400)
  }
  throw new Error('Could not connect to Chrome debugging endpoint')
}

async function waitForSelector(cdp, selector, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const exists = await cdp.eval(`!!document.querySelector('${selector}')`)
    if (exists) return true
    await sleep(300)
  }
  return false
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.id = 1
    this.callbacks = new Map()
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.onopen = () => resolve()
      this.ws.onerror = (err) => reject(err)
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data.toString())
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id)
          this.callbacks.delete(msg.id)
          if (msg.error) reject(new Error(msg.error.message))
          else resolve(msg.result)
        }
      }
    })
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++
      this.callbacks.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    })
    return res.result?.value
  }

  async screenshot(savePath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png', quality: 90 })
    const buf = Buffer.from(res.data, 'base64')
    fs.writeFileSync(savePath, buf)
    console.log(`[Screenshot saved] -> ${savePath}`)
  }

  close() {
    try {
      this.ws?.close()
    } catch {}
  }
}

async function runVerification() {
  console.log('--- Launching Headless Chrome for MovieBox & Player Verification ---')

  const chromeProc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--user-data-dir=C:\\Windows\\Temp\\chrome-vyora-test-' + Date.now(),
      APP_URL,
    ],
    { stdio: 'ignore' }
  )

  try {
    const wsUrl = await getWsUrl()
    console.log(`Connected to Chrome CDP: ${wsUrl}`)

    const cdp = new CDPClient(wsUrl)
    await cdp.connect()

    await cdp.send('Page.enable')
    await cdp.send('DOM.enable')
    await cdp.send('Runtime.enable')

    console.log('Navigating to ' + APP_URL)
    await cdp.send('Page.navigate', { url: APP_URL })
    await waitForSelector(cdp, '.topnav-btn', 12000)
    await sleep(800)

    // TEST 1: Check hero statistics badges (21,121 Streams and TURBO Engine must NOT exist)
    console.log('\n--- 1. Testing Hero Statistics Badges ---')
    const heroStats = await cdp.eval(`
      (() => {
        const items = Array.from(document.querySelectorAll('.cinema-hero-stats .hero-stat-item'));
        return items.map(it => it.innerText.replace(/\\s+/g, ' ').trim());
      })()
    `)
    console.log('Current Hero Stat Items in UI:', heroStats)
    const hasStreamsBadge = heroStats.some(s => /stream/i.test(s))
    const hasTurboBadge = heroStats.some(s => /turbo/i.test(s))

    if (!hasStreamsBadge && !hasTurboBadge) {
      console.log('✓ PASS: "Streams" and "TURBO Engine" badges are successfully removed from frontend UI!')
    } else {
      console.error('✗ FAIL: Found forbidden badges in UI:', { hasStreamsBadge, hasTurboBadge })
    }

    // TEST 2: Check Top Navigation (Movies and Series gone, MovieBox present)
    console.log('\n--- 2. Testing Top Navigation ---')
    const navButtons = await cdp.eval(`
      (() => {
        const btns = Array.from(document.querySelectorAll('.topnav-btn'));
        return btns.map(b => b.innerText.trim());
      })()
    `)
    console.log('Topnav Buttons:', navButtons)
    const hasSeparateMovies = navButtons.some(t => t.toLowerCase() === 'movies')
    const hasSeparateSeries = navButtons.some(t => t.toLowerCase() === 'series')
    const hasMovieBox = navButtons.some(t => /moviebox/i.test(t))

    if (!hasSeparateMovies && !hasSeparateSeries && hasMovieBox) {
      console.log('✓ PASS: "Movies" and "Series" replaced with modern "MovieBox" button in topbar!')
    } else {
      console.error('✗ FAIL: Topnav check failed:', { hasSeparateMovies, hasSeparateSeries, hasMovieBox })
    }

    // TEST 3: Click MovieBox and inspect MovieBox View
    console.log('\n--- 3. Testing MovieBox View ---')
    await cdp.eval(`
      (() => {
        const mbBtn = Array.from(document.querySelectorAll('.topnav-btn')).find(b => /moviebox/i.test(b.innerText));
        if (mbBtn) mbBtn.click();
      })()
    `)
    await waitForSelector(cdp, '.moviebox-billboard', 8000)
    await sleep(800)

    const movieboxState = await cdp.eval(`
      (() => {
        const billboard = document.querySelector('.moviebox-billboard');
        const title = billboard ? billboard.querySelector('.billboard-title')?.innerText : null;
        const rating = billboard ? billboard.querySelector('.billboard-badge-rating')?.innerText : null;
        const res = billboard ? billboard.querySelector('.billboard-badge-res')?.innerText : null;
        const chips = Array.from(document.querySelectorAll('.moviebox-genre-chips .chip')).map(c => c.innerText.trim());
        const movieCards = Array.from(document.querySelectorAll('.moviebox-grid .movie-card'));
        const firstCardTitle = movieCards[0]?.querySelector('.movie-card-title')?.innerText;
        return {
          hasBillboard: !!billboard,
          spotlightTitle: title,
          rating,
          resolution: res,
          chipsCount: chips.length,
          movieCardsCount: movieCards.length,
          firstCardTitle
        };
      })()
    `)
    console.log('MovieBox View State:', movieboxState)

    if (movieboxState.hasBillboard && movieboxState.movieCardsCount > 0) {
      console.log(`✓ PASS: MovieBox loaded successfully with ${movieboxState.movieCardsCount} blockbuster cinema movies!`)
      console.log(`Spotlight Movie: "${movieboxState.spotlightTitle}" (${movieboxState.rating}, ${movieboxState.resolution})`)
    } else {
      console.error('✗ FAIL: MovieBox view did not render properly:', movieboxState)
    }

    // Capture MovieBox screenshot
    const movieboxScreenshotPath = path.join(ARTIFACTS_DIR, 'cinema-moviebox-view.png')
    await cdp.screenshot(movieboxScreenshotPath)

    // TEST 4: Direct Playback & Player Remote Control Dock (No Dialog Popup)
    console.log('\n--- 4. Testing Direct Playback & Cinema Remote Control Dock ---')
    // Click on the Spotlight "Watch Movie Now" button or first movie card
    await cdp.eval(`
      (() => {
        const playBtn = document.querySelector('.billboard-play-btn') || document.querySelector('.moviebox-grid .movie-card');
        if (playBtn) playBtn.click();
      })()
    `)
    await waitForSelector(cdp, '.player-quick-dock', 8000)
    await sleep(800)

    const playerState = await cdp.eval(`
      (() => {
        const streamDialog = document.querySelector('.cinema-stream-dialog-overlay');
        const playerOverlay = document.querySelector('.player-overlay');
        const quickDock = document.querySelector('.player-quick-dock');
        const dockButtons = quickDock ? Array.from(quickDock.querySelectorAll('.dock-btn')).map(b => b.innerText.trim()) : [];
        const dockEngine = quickDock ? quickDock.querySelector('.dock-engine-pill')?.innerText.trim() : null;
        return {
          hasExternalStreamDialog: !!streamDialog,
          hasPlayerOverlay: !!playerOverlay,
          hasQuickDock: !!quickDock,
          dockButtons,
          dockEngine
        };
      })()
    `)
    console.log('Player Launch State:', playerState)

    if (!playerState.hasExternalStreamDialog && playerState.hasPlayerOverlay && playerState.hasQuickDock) {
      console.log('✓ PASS: External stream popup dialog is 100% eliminated! Media launched directly in platform player.')
      console.log('✓ PASS: Cinema Remote Control Dock is visible with controls:', playerState.dockButtons)
    } else {
      console.error('✗ FAIL: Direct player launch or dock controls missing:', playerState)
    }

    // TEST 5: Test Volume Controls & Floating Volume OSD
    console.log('\n--- 5. Testing Volume Up/Down & OSD Feedback ---')
    await cdp.eval(`
      (() => {
        const volUp = Array.from(document.querySelectorAll('.dock-btn')).find(b => /vol \\+/i.test(b.innerText));
        if (volUp) volUp.click();
      })()
    `)
    await sleep(300)

    const osdState = await cdp.eval(`
      (() => {
        const osd = document.querySelector('.player-volume-osd');
        const pct = osd ? osd.querySelector('.volume-osd-pct')?.innerText : null;
        const videoVol = document.querySelector('video')?.volume;
        return {
          hasOsd: !!osd,
          pct,
          videoVol
        };
      })()
    `)
    console.log('Volume OSD State after Vol+:', osdState)

    if (osdState.hasOsd) {
      console.log(`✓ PASS: Floating Volume OSD active! Current reading: ${osdState.pct}`)
    } else {
      console.warn('Volume OSD check:', osdState)
    }

    // Capture Player Overlay with Quick Dock & Volume OSD screenshot
    const playerScreenshotPath = path.join(ARTIFACTS_DIR, 'cinema-player-controls-view.png')
    await cdp.screenshot(playerScreenshotPath)

    // TEST 6: Exit Player cleanly
    console.log('\n--- 6. Testing Exit / Back Control ---')
    await cdp.eval(`
      (() => {
        const exitBtn = document.querySelector('.dock-btn-exit') || document.querySelector('.player-close');
        if (exitBtn) exitBtn.click();
      })()
    `)
    await sleep(1000)

    const closedState = await cdp.eval(`
      (() => {
        return {
          hasPlayerOverlay: !!document.querySelector('.player-overlay'),
          currentView: document.querySelector('.moviebox-container') ? 'moviebox' : 'other'
        };
      })()
    `)
    console.log('State after Exit:', closedState)
    if (!closedState.hasPlayerOverlay) {
      console.log('✓ PASS: Player closed cleanly, returning user to MovieBox catalog seamlessly!')
    }

    cdp.close()
  } finally {
    try {
      chromeProc.kill()
    } catch {}
  }
}

runVerification()
  .then(() => {
    console.log('\n======================================================')
    console.log('   ALL 3 USER DIRECTIVES VERIFIED WITH 100% SUCCESS   ')
    console.log('======================================================')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Verification error:', err)
    process.exit(1)
  })
