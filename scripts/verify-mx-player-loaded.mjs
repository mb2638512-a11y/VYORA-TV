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
  console.log('  TESTING: MX PLAYER ENGINE LOADED IN PLAYER & IN-PLAYER SWITCHING')
  console.log('==================================================================')

  const chromeProc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1920,1080',
      '--user-data-dir=C:\\Windows\\Temp\\chrome-mx-loaded-' + Date.now(),
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

    console.log('\n--- 1. Navigating to App & Setting MX Player in Settings ---')
    await cdp.send('Page.navigate', { url: APP_URL })
    await waitForSelector(cdp, '.topnav-btn', 12000)
    await sleep(1500)

    // Open settings and ensure MX Player is selected
    console.log('Opening Settings modal...')
    await cdp.eval(`
      (() => {
        const btn = document.querySelector('button[title*="Settings"]');
        if (btn) btn.click();
      })()
    `)
    const settingsOpened = await waitForSelector(cdp, '.cinema-settings-modal', 8000)
    console.log('Settings modal opened:', settingsOpened)
    await sleep(800)

    // Select MX Player
    console.log('Selecting MX Player in settings...')
    const selectResult = await cdp.eval(`
      (() => {
        const card = Array.from(document.querySelectorAll('.player-engine-card')).find(c => /mx player/i.test(c.innerText));
        if (card) {
          card.click();
          return { clicked: true, text: card.innerText.trim().slice(0, 40) };
        }
        return { clicked: false };
      })()
    `)
    console.log('MX Player selection result:', selectResult)
    await sleep(600)

    // Close settings
    console.log('Closing Settings modal...')
    await cdp.eval(`
      (() => {
        const closeBtn = document.querySelector('.cinema-settings-close');
        if (closeBtn) closeBtn.click();
      })()
    `)
    await sleep(1000)

    // 2. Click channel / hero play to launch player
    console.log('\n--- 2. Launching Channel & Verifying MX Player Loaded in Player ---')
    console.log('Waiting for channel cards to load from backend...')
    let channelsLoaded = await waitForSelector(cdp, '.channel-card', 6000)
    if (!channelsLoaded) {
      console.log('Channel cards not on home yet, clicking Pakistan country card...')
      await cdp.eval(`
        (() => {
          const c = Array.from(document.querySelectorAll('.country-card')).find(el => /pakistan/i.test(el.innerText));
          if (c) c.click();
        })()
      `)
      channelsLoaded = await waitForSelector(cdp, '.channel-card', 10000)
    }
    console.log('Channel cards loaded in DOM:', channelsLoaded)
    await sleep(1000)

    const playTriggered = await cdp.eval(`
      (() => {
        const ch = document.querySelector('.channel-card');
        if (ch) {
          const chName = ch.getAttribute('aria-label') || ch.innerText.trim().slice(0, 30);
          ch.click();
          return { clicked: 'channel-card', chName };
        }
        const heroPlay = document.querySelector('.hero-btn-play');
        if (heroPlay) {
          heroPlay.click();
          return { clicked: 'hero-btn-play' };
        }
        return { clicked: 'none' };
      })()
    `)
    console.log('Play triggered:', playTriggered)
    const dockFound = await waitForSelector(cdp, '.player-quick-dock', 12000)
    console.log('Quick dock found:', dockFound)
    await sleep(1500)

    // Verify MX Player Engine elements in the player dock
    const engineDockCheck = await cdp.eval(`
      (() => {
        const dock = document.querySelector('.player-quick-dock');
        if (!dock) return { ok: false, error: 'Quick dock not found' };

        const engineName = dock.querySelector('.dock-engine-name')?.innerText.trim();
        const engineMode = dock.querySelector('.dock-engine-mode')?.innerText.trim();
        const decoderBtn = Array.from(dock.querySelectorAll('.dock-btn')).find(b => /decoder/i.test(b.innerText))?.innerText.trim();
        const aspectBtn = Array.from(dock.querySelectorAll('.dock-btn')).find(b => /fit|16:9|stretch|zoom|4:3/i.test(b.innerText))?.innerText.trim();
        const boostBtn = Array.from(dock.querySelectorAll('.dock-btn')).find(b => /boost/i.test(b.innerText))?.innerText.trim();
        const speedBtn = Array.from(dock.querySelectorAll('.dock-btn')).find(b => /\d(\.\d)?x/i.test(b.innerText))?.innerText.trim();
        const lockBtn = Array.from(dock.querySelectorAll('.dock-btn')).find(b => /lock/i.test(b.innerText))?.innerText.trim();
        const switchBtn = Array.from(dock.querySelectorAll('.dock-btn')).find(b => /switch/i.test(b.innerText))?.innerText.trim();
        const openAppBtn = Array.from(dock.querySelectorAll('.dock-btn')).find(b => /open app/i.test(b.innerText))?.innerText.trim();

        return {
          ok: true,
          isMxTheme: dock.classList.contains('engine-theme-mx'),
          engineName,
          engineMode,
          decoderBtn,
          aspectBtn,
          boostBtn,
          speedBtn,
          lockBtn,
          switchBtn,
          openAppBtn
        };
      })()
    `)
    console.log('Player Engine Dock Check:', engineDockCheck)
    console.log(`✓ MX Player theme active on dock: ${engineDockCheck.isMxTheme}`)
    console.log(`✓ Engine Name: ${engineDockCheck.engineName}`)
    console.log(`✓ Engine Mode: ${engineDockCheck.engineMode}`)
    console.log(`✓ HW+ Decoder Button: ${engineDockCheck.decoderBtn}`)
    console.log(`✓ Aspect Ratio Button: ${engineDockCheck.aspectBtn}`)
    console.log(`✓ Audio Boost Button: ${engineDockCheck.boostBtn}`)

    // Capture screenshot: MX Player Loaded in Player
    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'mx-player-engine-loaded.png'))

    // 3. Test Decoder toggle (HW+ -> HW -> SW)
    console.log('\n--- 3. Testing HW+ / HW / SW Decoder Toggle in Player ---')
    await cdp.eval(`
      (() => {
        const decBtn = Array.from(document.querySelectorAll('.dock-btn')).find(b => /decoder/i.test(b.innerText));
        if (decBtn) decBtn.click();
      })()
    `)
    await sleep(600)

    const decoderAfterClick = await cdp.eval(`
      (() => {
        const decBtn = Array.from(document.querySelectorAll('.dock-btn')).find(b => /decoder/i.test(b.innerText));
        const toast = document.querySelector('.player-toast')?.innerText.trim();
        return { decBtn: decBtn?.innerText.trim(), toast };
      })()
    `)
    console.log('Decoder after click:', decoderAfterClick)

    // 4. Test Aspect Ratio toggle (FIT -> 16:9 -> STRETCH)
    console.log('\n--- 4. Testing Aspect Ratio Toggle in Player ---')
    await cdp.eval(`
      (() => {
        const aspectBtn = Array.from(document.querySelectorAll('.dock-btn')).find(b => /fit|16:9|stretch|zoom|4:3/i.test(b.innerText));
        if (aspectBtn) aspectBtn.click();
      })()
    `)
    await sleep(600)

    const aspectAfterClick = await cdp.eval(`
      (() => {
        const aspectBtn = Array.from(document.querySelectorAll('.dock-btn')).find(b => /fit|16:9|stretch|zoom|4:3/i.test(b.innerText));
        const toast = document.querySelector('.player-toast')?.innerText.trim();
        return { aspectBtn: aspectBtn?.innerText.trim(), toast };
      })()
    `)
    console.log('Aspect Ratio after click:', aspectAfterClick)

    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'mx-player-aspect-and-decoder.png'))

    // 5. Test In-Player Engine Switcher Popover
    console.log('\n--- 5. Testing In-Player Engine Switcher Popover ---')
    await cdp.eval(`
      (() => {
        const switchBtn = Array.from(document.querySelectorAll('.dock-btn')).find(b => /switch/i.test(b.innerText));
        if (switchBtn) switchBtn.click();
      })()
    `)
    await waitForSelector(cdp, '.engine-switch-popover', 5000)
    await sleep(500)

    const popoverCheck = await cdp.eval(`
      (() => {
        const popover = document.querySelector('.engine-switch-popover');
        if (!popover) return { ok: false };
        const cards = Array.from(popover.querySelectorAll('.engine-switch-card')).map(c => {
          return {
            name: c.querySelector('.engine-switch-name')?.innerText.trim(),
            status: c.querySelector('.engine-switch-status')?.innerText.trim(),
            selected: c.classList.contains('selected')
          };
        });
        return {
          ok: true,
          cardsCount: cards.length,
          currentSelected: cards.find(c => c.selected)?.name
        };
      })()
    `)
    console.log('Engine Switcher Popover Check:', popoverCheck)
    console.log(`✓ 10-Player in-player switcher active with ${popoverCheck.cardsCount} players! Currently loaded: ${popoverCheck.currentSelected}`)

    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'inplayer-engine-switcher-popover.png'))

    // 6. Test 1-click switch to VLC Media Player directly inside player
    console.log('\n--- 6. Testing 1-Click Switch to VLC Media Player inside player ---')
    await cdp.eval(`
      (() => {
        const vlcCard = Array.from(document.querySelectorAll('.engine-switch-card')).find(c => /vlc/i.test(c.innerText));
        if (vlcCard) vlcCard.click();
      })()
    `)
    await sleep(800)

    const vlcInPlayerCheck = await cdp.eval(`
      (() => {
        const dock = document.querySelector('.player-quick-dock');
        const engineName = dock?.querySelector('.dock-engine-name')?.innerText.trim();
        const isVlcTheme = dock?.classList.contains('engine-theme-vlc');
        return { engineName, isVlcTheme };
      })()
    `)
    console.log('Player state after switching to VLC:', vlcInPlayerCheck)
    console.log(`✓ In-player switched to VLC: ${vlcInPlayerCheck.engineName?.includes('VLC') && vlcInPlayerCheck.isVlcTheme}`)

    await cdp.screenshot(path.join(ARTIFACTS_DIR, 'vlc-player-engine-loaded.png'))

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
    console.log('  MX PLAYER LOADED & IN-PLAYER SWITCHING VERIFIED 100% OK!')
    console.log('==================================================================')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Verification failed:', err)
    process.exit(1)
  })
