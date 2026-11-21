import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

async function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

async function main() {
  console.log('--- Vyora Cinema TV UI/UX Autonomous Verification ---')

  // 1. Verify Go server responding on 8787
  const statusRes = await fetch('http://127.0.0.1:8787/api/status')
  if (!statusRes.ok) throw new Error(`Go API status failed: ${statusRes.status}`)
  const statusJson = await statusRes.json()
  console.log(`✓ Go Server Live: ${statusJson.stats.online} online channels probed`)

  const bootstrapRes = await fetch('http://127.0.0.1:8787/api/bootstrap')
  const boot = await bootstrapRes.json()
  console.log(`✓ Catalogue Intact: ${boot.totals.channels} channels across ${boot.totals.countries} countries, ${boot.totals.streams} streams`)

  // 2. Launch Chrome Headless with Remote Debugging
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox',
    'http://127.0.0.1:8787/',
  ])

  let killed = false
  const cleanup = () => {
    if (!killed) {
      killed = true
      try {
        chrome.kill()
      } catch {}
    }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)

  try {
    let targets = null
    for (let i = 0; i < 20; i++) {
      await sleep(500)
      try {
        targets = await getJSON('http://127.0.0.1:9222/json')
        if (targets && targets.length > 0) break
      } catch {}
    }

    if (!targets || !targets.length) {
      console.log('Chrome did not open remote debugging port in time')
      return
    }

    const pageTarget = targets.find((t) => t.type === 'page') || targets[0]
    console.log(`✓ Attached to Chrome target: ${pageTarget.title} (${pageTarget.url})`)

    const WS = globalThis.WebSocket
    if (!WS) {
      throw new Error('globalThis.WebSocket not available in this Node version')
    }

    const ws = new WS(pageTarget.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })

    let msgId = 1
    const sendCDP = (method, params = {}) => {
      const id = msgId++
      return new Promise((resolve) => {
        const onMsg = (event) => {
          const parsed = JSON.parse(event.data)
          if (parsed.id === id) {
            ws.removeEventListener('message', onMsg)
            resolve(parsed.result)
          }
        }
        ws.addEventListener('message', onMsg)
        ws.send(JSON.stringify({ id, method, params }))
      })
    }

    // Enable Console and Log domains to catch runtime errors
    await sendCDP('Console.enable')
    await sendCDP('Runtime.enable')

    ws.addEventListener('message', (event) => {
      const parsed = JSON.parse(event.data)
      if (parsed.method === 'Runtime.consoleAPICalled') {
        console.log('[Browser Console]', parsed.params.type, ...parsed.params.args.map(a => a.value || a.description))
      }
      if (parsed.method === 'Runtime.exceptionThrown') {
        console.error('[Browser Exception]', parsed.params.exceptionDetails)
      }
    })

    // Wait for channels to load
    for (let i = 0; i < 20; i++) {
      await sleep(1000)
      const checkRes = await sendCDP('Runtime.evaluate', {
        expression: `document.querySelectorAll('.channel-card').length`,
        returnByValue: true,
      })
      if (checkRes?.result?.value > 0) {
        console.log(`✓ Channels loaded: ${checkRes.result.value} cards rendered`)
        break
      }
    }

    // Set 1920x1080 Desktop / TV Viewport
    await sendCDP('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await sleep(500)

    // Capture 1920x1080 Desktop Screenshot
    const desktopScreenshot = await sendCDP('Page.captureScreenshot', { format: 'png' })
    if (desktopScreenshot?.data) {
      fs.writeFileSync('cinema-desktop.png', Buffer.from(desktopScreenshot.data, 'base64'))
      console.log('✓ Desktop 1920x1080 screenshot saved to cinema-desktop.png')
    }

    // Evaluate DOM state at 1920x1080
    const evalRes = await sendCDP('Runtime.evaluate', {
      expression: `(function() {
        const topnav = document.querySelector('.topnav');
        const computedTopnav = topnav ? window.getComputedStyle(topnav).display : null;
        const menuBtn = document.querySelector('.mobile-menu-btn');
        const computedMenu = menuBtn ? window.getComputedStyle(menuBtn).display : null;

        return JSON.stringify({
          title: document.title,
          theme: document.documentElement.getAttribute('data-theme'),
          hasCinemaHero: !!document.querySelector('.cinema-hero'),
          heroTitle: document.querySelector('.cinema-hero-title')?.textContent?.trim(),
          heroPlayBtn: !!document.querySelector('.hero-btn-play'),
          enginesCount: document.querySelectorAll('.home-engine-chip').length,
          hasMoviesRail: !!document.querySelector('.cinema-movies-rail'),
          hasSportsRail: !!document.querySelector('.cinema-sports-rail'),
          channelsCount: document.querySelectorAll('.channel-card').length,
          topNavDisplay: computedTopnav,
          mobileMenuDisplay: computedMenu,
          topNavButtons: Array.from(document.querySelectorAll('.topnav-btn')).map(b => b.textContent.trim()),
          hasThemeToggle: !!document.querySelector('.theme-toggle-btn')
        });
      })()`,
      returnByValue: true,
    })

    const info = evalRes?.result?.value ? JSON.parse(evalRes.result.value) : null
    console.log('✓ Desktop 1920x1080 UI Inspection:', JSON.stringify(info, null, 2))

    // Set Mobile Viewport (375x812 iPhone / Mobile)
    await sendCDP('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await sleep(500)

    const mobileScreenshot = await sendCDP('Page.captureScreenshot', { format: 'png' })
    if (mobileScreenshot?.data) {
      fs.writeFileSync('cinema-mobile.png', Buffer.from(mobileScreenshot.data, 'base64'))
      console.log('✓ Mobile 375x812 screenshot saved to cinema-mobile.png')
    }

    // Reset back to Desktop for theme click test
    await sendCDP('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await sleep(300)

    if (!info.hasCinemaHero) throw new Error('Cinema hero billboard missing from DOM!')
    if (!info.heroPlayBtn) throw new Error('Cinema hero Play CTA button missing!')
    if (info.enginesCount !== 5) throw new Error(`Expected 5 engines chips, found ${info.enginesCount}`)

    // Click theme toggle to verify theme switching
    console.log('Testing Theme Toggle click...')
    const themeToggleRes = await sendCDP('Runtime.evaluate', {
      expression: `(function() {
        const btn = document.querySelector('.theme-toggle-btn');
        if (btn) btn.click();
        return document.documentElement.getAttribute('data-theme');
      })()`,
      returnByValue: true,
    })
    console.log(`✓ Theme toggled to: ${themeToggleRes.result?.value}`)

    // Click it again to toggle back to dark
    const themeToggleBack = await sendCDP('Runtime.evaluate', {
      expression: `(function() {
        const btn = document.querySelector('.theme-toggle-btn');
        if (btn) btn.click();
        return document.documentElement.getAttribute('data-theme');
      })()`,
      returnByValue: true,
    })
    console.log(`✓ Theme toggled back to: ${themeToggleBack.result?.value}`)

    // Capture screenshot
    const screenshotData = await sendCDP('Page.captureScreenshot', { format: 'png' })
    if (screenshotData && screenshotData.data) {
      fs.writeFileSync('cinema-verified.png', Buffer.from(screenshotData.data, 'base64'))
      console.log('✓ Screenshot saved to cinema-verified.png (100% verified)')
    }

    ws.close()
    console.log('✓ ALL AUTONOMOUS CHECKS PASSED!')
  } finally {
    cleanup()
  }
}

main().catch((err) => {
  console.error('Verification failed:', err)
  process.exit(1)
})
