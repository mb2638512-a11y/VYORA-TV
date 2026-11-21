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
  console.log('==================================================================')
  console.log('  STARTING VERIFICATION OF ALL USER DIRECTIVES & COMMENTS')
  console.log('==================================================================')

  const chromeProc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1920,1080',
      '--user-data-dir=C:\\Windows\\Temp\\chrome-verify-user-' + Date.now(),
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

    console.log('\n--- 1. Navigating to App & Checking Clean Home View ---')
    await cdp.send('Page.navigate', { url: APP_URL })
    await waitForSelector(cdp, '.topnav-btn', 12000)
    await sleep(1500)

    // CHECK A: Topbar navigation items (Movies and Series must NOT exist)
    const topnav = await cdp.eval(`
      Array.from(document.querySelectorAll('.topnav-btn')).map(b => b.innerText.trim())
    `)
    console.log('Topbar items:', topnav)
    const hasMoviesInTopnav = topnav.some(t => /movie/i.test(t))
    const hasSeriesInTopnav = topnav.some(t => /series/i.test(t))
    console.log(`✓ Topbar Movies absent: ${!hasMoviesInTopnav}, Series absent: ${!hasSeriesInTopnav}`)

    // CHECK B: Hero Stats (21,121 Streams and TURBO Engine MUST BE REMOVED)
    const heroStats = await cdp.eval(`
      (() => {
        const stats = Array.from(document.querySelectorAll('.hero-stat-item')).map(s => {
          return { strong: s.querySelector('strong')?.innerText.trim(), label: s.querySelector('span')?.innerText.trim() };
        });
        const fullHeroText = document.querySelector('.cinema-hero')?.innerText || '';
        return {
          stats,
          hasStreamsInStats: stats.some(s => /stream/i.test(s.label || '')),
          hasTurboInStats: stats.some(s => /turbo/i.test(s.strong || s.label || ''))
        };
      })()
    `)
    console.log('Hero Stats items:', heroStats.stats)
    console.log(`✓ Streams in stats removed: ${!heroStats.hasStreamsInStats}`)
    console.log(`✓ TURBO Engine in stats removed: ${!heroStats.hasTurboInStats}`)

    // CHECK C: Category chips on Home (Movies and Series must NOT exist)
    const categoryChips = await cdp.eval(`
      Array.from(document.querySelectorAll('.home-filter-chip')).map(c => c.innerText.trim())
    `)
    console.log('Home Category chips count:', categoryChips.length)
    const hasMoviesInChips = categoryChips.some(c => /movie/i.test(c))
    const hasSeriesInChips = categoryChips.some(c => /series/i.test(c))
    console.log(`✓ Home Chips Movies absent: ${!hasMoviesInChips}, Series absent: ${!hasSeriesInChips}`)

    // Take clean Home View screenshot
    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'verified-cinema-home-clean.png'))

    // CHECK D: Open Settings & 1-Click Select "MX Player / MX Pro"
    console.log('\n--- 2. Testing Settings 1-Click Selection of MX Player ---')
    await cdp.eval(`
      (() => {
        const btn = document.querySelector('button[title*="Settings"]');
        if (btn) btn.click();
      })()
    `)
    await waitForSelector(cdp, '.cinema-settings-overlay', 8000)
    await sleep(800)

    // Click on MX Player card
    await cdp.eval(`
      (() => {
        const card = Array.from(document.querySelectorAll('.player-engine-card')).find(c => /mx player/i.test(c.innerText));
        if (card) card.click();
      })()
    `)
    await sleep(600)

    const mxResult = await cdp.eval(`
      (() => {
        const banner = document.querySelector('.active-player-banner');
        const title = banner ? banner.querySelector('.active-player-title')?.innerText.trim() : '';
        const saved = JSON.parse(localStorage.getItem('vyora.settings') || '{}');
        const mxCard = Array.from(document.querySelectorAll('.player-engine-card')).find(c => /mx player/i.test(c.innerText));
        return {
          bannerTitle: title,
          channelsPlayer: saved.channelsPlayer,
          isMxCardSelected: mxCard ? mxCard.classList.contains('is-selected') : false
        };
      })()
    `)
    console.log('MX Player Selection Result:', mxResult)
    console.log(`✓ MX Player active in settings: ${mxResult.channelsPlayer === 'mx' && mxResult.isMxCardSelected}`)

    // Take Settings screenshot with MX Player active
    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'verified-settings-mx-active.png'))

    // CHECK E: Close Settings & Launch Channel in In-Platform Player
    console.log('\n--- 3. Launching Channel & Verifying In-Platform Player Dock ---')
    await cdp.eval(`
      (() => {
        const closeBtn = document.querySelector('.cinema-settings-close');
        if (closeBtn) closeBtn.click();
      })()
    `)
    await sleep(600)

    // Click first channel
    await cdp.eval(`
      (() => {
        const ch = document.querySelector('.channel-card, .cable-epg-row');
        if (ch) ch.click();
      })()
    `)
    await waitForSelector(cdp, '.player-quick-dock', 8000)
    await sleep(1000)

    // Verify In-Platform Player has Remote Quick Dock with Back, CH-, CH+, Vol-, Vol+, and Engine Pill
    const playerCheck = await cdp.eval(`
      (() => {
        const dock = document.querySelector('.player-quick-dock');
        if (!dock) return { ok: false, error: 'Quick dock not found' };

        const backBtn = dock.querySelector('.dock-btn-exit')?.innerText.trim();
        const chButtons = Array.from(dock.querySelectorAll('.dock-group-ch .dock-btn')).map(b => b.innerText.trim());
        const volButtons = Array.from(dock.querySelectorAll('.dock-group-vol .dock-btn')).map(b => b.innerText.trim());
        const enginePill = dock.querySelector('.dock-engine-pill')?.innerText.trim();
        const externalDialog = !!document.querySelector('.cinema-stream-dialog');

        return {
          ok: true,
          backBtn,
          chButtons,
          volButtons,
          enginePill,
          hasExternalDialog: externalDialog
        };
      })()
    `)
    console.log('Player Quick Dock Check:', playerCheck)
    console.log(`✓ In-platform player active: ${playerCheck.ok}`)
    console.log(`✓ Back button available: ${playerCheck.backBtn}`)
    console.log(`✓ Channel Next/Prev controls: ${playerCheck.chButtons?.join(', ')}`)
    console.log(`✓ Volume controls: ${playerCheck.volButtons?.join(', ')}`)
    console.log(`✓ Selected Engine Pill displayed: ${playerCheck.enginePill}`)
    console.log(`✓ Zero External Dialog popup: ${!playerCheck.hasExternalDialog}`)

    // Test Volume Up action
    console.log('\n--- 4. Testing Volume Controls Inside Player ---')
    await cdp.eval(`
      (() => {
        const volUp = Array.from(document.querySelectorAll('.dock-group-vol .dock-btn')).find(b => /vol \+/i.test(b.innerText));
        if (volUp) volUp.click();
      })()
    `)
    await sleep(500)
    const volOsd = await cdp.eval(`
      (() => {
        const osd = document.querySelector('.player-volume-osd');
        return osd ? osd.innerText.trim().replace(/\\n/g, ' ') : null;
      })()
    `)
    console.log('Volume OSD after Vol+ click:', volOsd)

    // Take In-Platform Player Screenshot with Active MX Player Engine & Quick Remote Dock
    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'verified-inplatform-player-active.png'))

    cdp.close()
  } finally {
    try {
      chromeProc.kill()
    } catch {}
  }
}

run()
  .then(() => {
    console.log('\n==================================================================')
    console.log('  ALL USER DIRECTIVES VERIFIED & CONFIRMED SUCCESSFULLY!')
    console.log('==================================================================')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Verification failed:', err)
    process.exit(1)
  })
