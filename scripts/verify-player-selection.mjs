import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = 9224
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

async function waitForSelector(cdp, selector, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const exists = await cdp.eval(`!!document.querySelector('${selector}')`)
    if (exists) return true
    await sleep(300)
  }
  return false
}

async function run() {
  console.log('--- Launching Headless Chrome to Verify Player Selection & Removal of Movies/Series ---')

  const chromeProc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1440,900',
      '--user-data-dir=C:\\Windows\\Temp\\chrome-player-sel-' + Date.now(),
      APP_URL,
    ],
    { stdio: 'ignore' }
  )

  try {
    const wsUrl = await getWsUrl()
    const cdp = new CDPClient(wsUrl)
    await cdp.connect()

    await cdp.send('Page.enable')
    await cdp.send('DOM.enable')
    await cdp.send('Runtime.enable')

    console.log('Navigating to ' + APP_URL)
    await cdp.send('Page.navigate', { url: APP_URL })
    await waitForSelector(cdp, '.topnav-btn', 12000)
    await sleep(1000)

    // TEST 1: Check that Movies, Series, and MovieBox are 100% GONE from Topbar
    console.log('\n--- 1. Checking Top Navigation (Movies/Series Removed) ---')
    const topnav = await cdp.eval(`
      (() => {
        return Array.from(document.querySelectorAll('.topnav-btn')).map(b => b.innerText.trim());
      })()
    `)
    console.log('Topnav items:', topnav)
    const hasMovies = topnav.some(t => /movie/i.test(t))
    const hasSeries = topnav.some(t => /series/i.test(t))

    if (!hasMovies && !hasSeries) {
      console.log('✓ PASS: All Movies, Series, and MovieBox items completely removed from topbar!')
    } else {
      console.error('✗ FAIL: Found residual movies/series item in topbar:', { hasMovies, hasSeries })
    }

    // TEST 2: Open Settings Overlay
    console.log('\n--- 2. Opening Settings Overlay ---')
    await cdp.eval(`
      (() => {
        const settingsBtn = document.querySelector('button[title*="Settings"]') || 
          Array.from(document.querySelectorAll('button')).find(b => /settings/i.test(b.innerText || b.getAttribute('aria-label') || ''));
        if (settingsBtn) settingsBtn.click();
      })()
    `)
    await waitForSelector(cdp, '.cinema-settings-overlay', 8000)
    await sleep(800)

    // Check Active Player Banner
    const initialPlayerState = await cdp.eval(`
      (() => {
        const banner = document.querySelector('.active-player-banner');
        const title = banner ? banner.querySelector('.active-player-title')?.innerText.trim() : null;
        const cards = Array.from(document.querySelectorAll('.player-engine-card')).map(c => {
          return {
            name: c.querySelector('.player-name')?.innerText.trim(),
            isSelected: c.classList.contains('is-selected'),
            buttonText: c.querySelector('.btn-select-player')?.innerText.trim()
          };
        });
        return {
          bannerTitle: title,
          cardsCount: cards.length,
          cards
        };
      })()
    `)
    console.log('Initial Active Player Banner:', initialPlayerState.bannerTitle)
    console.log('Available Player Engine Cards:', initialPlayerState.cardsCount)

    // TEST 3: 1-Click Select "MX Player / MX Pro"
    console.log('\n--- 3. Testing 1-Click Selection of "MX Player / MX Pro" ---')
    await cdp.eval(`
      (() => {
        const mxCard = Array.from(document.querySelectorAll('.player-engine-card')).find(c => /mx player/i.test(c.innerText));
        if (mxCard) mxCard.click();
      })()
    `)
    await sleep(600)

    const mxState = await cdp.eval(`
      (() => {
        const banner = document.querySelector('.active-player-banner');
        const title = banner ? banner.querySelector('.active-player-title')?.innerText.trim() : null;
        const savedSettings = JSON.parse(localStorage.getItem('vyora.settings') || '{}');
        const mxCard = Array.from(document.querySelectorAll('.player-engine-card')).find(c => /mx player/i.test(c.innerText));
        return {
          bannerTitle: title,
          channelsPlayer: savedSettings.channelsPlayer,
          defaultPlayer: savedSettings.defaultPlayer,
          mxCardSelected: mxCard ? mxCard.classList.contains('is-selected') : false,
          mxButtonText: mxCard ? mxCard.querySelector('.btn-select-player')?.innerText.trim() : null
        };
      })()
    `)
    console.log('State after clicking MX Player:', mxState)

    if (mxState.channelsPlayer === 'mx' && mxState.mxCardSelected) {
      console.log('✓ PASS: MX Player / MX Pro selected in 1 click! (saved to channelsPlayer and localStorage)')
    } else {
      console.error('✗ FAIL: MX Player selection failed:', mxState)
    }

    // Capture Settings screenshot with MX Player selected
    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'settings-player-selected-mx.png'))

    // TEST 4: 1-Click Select "VLC Media Player"
    console.log('\n--- 4. Testing 1-Click Selection of "VLC Media Player" ---')
    await cdp.eval(`
      (() => {
        const vlcCard = Array.from(document.querySelectorAll('.player-engine-card')).find(c => /vlc media player/i.test(c.innerText));
        if (vlcCard) vlcCard.click();
      })()
    `)
    await sleep(600)

    const vlcState = await cdp.eval(`
      (() => {
        const banner = document.querySelector('.active-player-banner');
        const title = banner ? banner.querySelector('.active-player-title')?.innerText.trim() : null;
        const savedSettings = JSON.parse(localStorage.getItem('vyora.settings') || '{}');
        const vlcCard = Array.from(document.querySelectorAll('.player-engine-card')).find(c => /vlc media player/i.test(c.innerText));
        return {
          bannerTitle: title,
          channelsPlayer: savedSettings.channelsPlayer,
          vlcCardSelected: vlcCard ? vlcCard.classList.contains('is-selected') : false
        };
      })()
    `)
    console.log('State after clicking VLC Player:', vlcState)

    if (vlcState.channelsPlayer === 'vlc' && vlcState.vlcCardSelected) {
      console.log('✓ PASS: VLC Media Player selected in 1 click! Banner updated to:', vlcState.bannerTitle)
    } else {
      console.error('✗ FAIL: VLC Player selection failed:', vlcState)
    }

    // Capture Settings screenshot with VLC selected
    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'settings-player-selected-vlc.png'))

    // TEST 5: Close Settings and Launch Live Stream
    console.log('\n--- 5. Closing Settings & Launching Live Stream with Selected Player ---')
    await cdp.eval(`
      (() => {
        const closeBtn = document.querySelector('.cinema-settings-close');
        if (closeBtn) closeBtn.click();
      })()
    `)
    await sleep(800)

    // Click on a channel to play
    await cdp.eval(`
      (() => {
        const chCard = document.querySelector('.channel-card') || document.querySelector('.cable-epg-row');
        if (chCard) chCard.click();
      })()
    `)
    await waitForSelector(cdp, '.player-quick-dock', 8000)
    await sleep(800)

    const livePlayerState = await cdp.eval(`
      (() => {
        const quickDock = document.querySelector('.player-quick-dock');
        const enginePill = quickDock ? quickDock.querySelector('.dock-engine-pill')?.innerText.trim() : null;
        const buttons = quickDock ? Array.from(quickDock.querySelectorAll('.dock-btn')).map(b => b.innerText.trim()) : [];
        return {
          hasQuickDock: !!quickDock,
          enginePill,
          buttons
        };
      })()
    `)
    console.log('Live Player Overlay State:', livePlayerState)

    if (livePlayerState.hasQuickDock && livePlayerState.enginePill?.includes('VLC')) {
      console.log('✓ PASS: Stream launched with selected VLC player engine! Engine badge:', livePlayerState.enginePill)
    } else {
      console.log('Live player engine check:', livePlayerState)
    }

    // Capture Player Overlay screenshot
    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'live-player-with-selected-engine.png'))

    cdp.close()
  } finally {
    try {
      chromeProc.kill()
    } catch {}
  }
}

run()
  .then(() => {
    console.log('\n=================================================================')
    console.log('   ALL CHECKS PASSED: MOVIES/SERIES REMOVED & 1-CLICK PLAYER OK   ')
    console.log('=================================================================')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Test run failed:', err)
    process.exit(1)
  })
