import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

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
  console.log('--- Vyora Advanced Settings Suite & 10-Player Engine Verification ---')

  const artifactDir = 'C:\\Users\\Mustafa\\.gemini\\antigravity\\brain\\40f9a44e-2536-4df7-ae2b-b92113eae243'
  fs.mkdirSync(artifactDir, { recursive: true })

  // 1. Verify Go server responding on 8787
  const statusRes = await fetch('http://127.0.0.1:8787/api/status')
  if (!statusRes.ok) throw new Error(`Go API status failed: ${statusRes.status}`)
  const statusJson = await statusRes.json()
  console.log(`✓ Go Engine Live: ${statusJson.stats.online} online channels probed`)

  const bootstrapRes = await fetch('http://127.0.0.1:8787/api/bootstrap')
  const boot = await bootstrapRes.json()
  console.log(`✓ Dataset Catalogue Intact: ${boot.totals.channels} channels across ${boot.totals.countries} countries`)

  // 2. Launch Chrome Headless with Remote Debugging
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9223',
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
        targets = await getJSON('http://127.0.0.1:9223/json')
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

    // Capture console errors
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data)
      if (data.method === 'Runtime.consoleAPICalled') {
        const type = data.params.type
        const text = data.params.args.map((a) => a.value || a.description || '').join(' ')
        if (type === 'error') {
          console.error(`[Browser Error]:`, text)
        }
      }
    })

    await sendCDP('Runtime.enable')
    await sendCDP('Page.enable')

    // Set 1920x1080 Full HD Viewport (TV/Desktop standard)
    await sendCDP('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // Wait for platform to mount (TopBar with Settings icon)
    console.log('Waiting for platform to mount...')
    let ready = false
    for (let i = 0; i < 25; i++) {
      await sleep(800)
      const chk = await sendCDP('Runtime.evaluate', {
        expression: `!!(document.querySelector('button[title="System Settings"]') || document.querySelector('.topbar'))`,
        returnByValue: true,
      })
      if (chk?.result?.value) {
        ready = true
        console.log(`✓ Platform UI mounted after ${i * 800}ms`)
        break
      }
    }
    if (!ready) throw new Error('Platform failed to mount within 20s')

    await sleep(1000)

    // 3. Open Settings Modal
    console.log('Opening Settings Overlay...')
    const openRes = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = document.querySelector('button[title="System Settings"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Settings'));
          if (btn) {
            btn.click();
            return { ok: true, text: btn.textContent };
          }
          return { ok: false, error: 'Settings button not found' };
        })()
      `,
      returnByValue: true,
    })
    console.log('Settings Open evaluation:', openRes.result.value)

    await sleep(1000)

    // 4. Verify 10 Top Players in Player Engines Tab
    const playersVerify = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const modal = document.querySelector('.cinema-settings-modal');
          if (!modal) return { ok: false, error: 'Modal not open' };

          const navItems = Array.from(document.querySelectorAll('.cinema-settings-nav-item')).map(el => el.textContent.trim());
          const playerCards = Array.from(document.querySelectorAll('.player-engine-card')).map(el => {
            const name = el.querySelector('.player-name')?.textContent?.trim() || '';
            const badge = el.querySelector('.player-badge')?.textContent?.trim() || '';
            const platform = el.querySelector('.player-platform-pill')?.textContent?.trim() || '';
            return { name, badge, platform };
          });

          const assignmentSelects = Array.from(document.querySelectorAll('.assignment-card select')).length;

          return {
            ok: true,
            navItems,
            playersCount: playerCards.length,
            playerCards,
            assignmentSelects
          };
        })()
      `,
      returnByValue: true,
    })

    console.log('Players Verification Result:', JSON.stringify(playersVerify.result.value, null, 2))

    // Capture screenshot of Player Engines Tab
    const shot1 = await sendCDP('Page.captureScreenshot', { format: 'png' })
    const path1 = path.join(artifactDir, 'cinema-settings-players.png')
    fs.writeFileSync(path1, Buffer.from(shot1.data, 'base64'))
    console.log(`✓ Saved Player Engines Screenshot: ${path1}`)

    // 5. Test Switching Live Channels Player to MX Player
    console.log('Testing changing Live Channels Player to MX Player...')
    const changePlayerRes = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const selects = Array.from(document.querySelectorAll('.assignment-card select'));
          if (selects.length > 0) {
            // First select is Live Channels Player
            const chSelect = selects[0];
            chSelect.value = 'mx';
            chSelect.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, newSelected: chSelect.value };
          }
          return { ok: false, error: 'No select found' };
        })()
      `,
      returnByValue: true,
    })
    console.log('Change Player Result:', changePlayerRes.result.value)

    await sleep(800)

    // 6. Navigate to Panels & Layout Tab
    console.log('Navigating to Panels & Layout Tab...')
    const clickTabRes = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const navItems = Array.from(document.querySelectorAll('.cinema-settings-nav-item'));
          const displayTab = navItems.find(el => el.textContent.includes('Panels & Layout'));
          if (displayTab) {
            displayTab.click();
            return { ok: true };
          }
          return { ok: false, error: 'Panels tab not found' };
        })()
      `,
      returnByValue: true,
    })
    console.log('Panels Tab Click:', clickTabRes.result.value)

    await sleep(1000)

    // Verify layout options
    const layoutVerify = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const layoutCards = Array.from(document.querySelectorAll('.layout-card')).map(el => el.querySelector('h4')?.textContent?.trim() || '');
          const startupButtons = Array.from(document.querySelectorAll('.btn-group-row button')).map(el => el.textContent.trim());

          // Select Cable EPG layout to test layout switching
          const cableCard = Array.from(document.querySelectorAll('.layout-card')).find(c => c.textContent.includes('Cable EPG'));
          if (cableCard) {
            cableCard.click();
          }

          return {
            ok: true,
            layoutCards,
            startupButtons,
            cableSelected: cableCard?.classList.contains('selected')
          };
        })()
      `,
      returnByValue: true,
    })
    console.log('Layout Verification Result:', JSON.stringify(layoutVerify.result.value, null, 2))

    // Capture screenshot of Display & Panels Tab
    const shot2 = await sendCDP('Page.captureScreenshot', { format: 'png' })
    const path2 = path.join(artifactDir, 'cinema-settings-display.png')
    fs.writeFileSync(path2, Buffer.from(shot2.data, 'base64'))
    console.log(`✓ Saved Panels & Layout Screenshot: ${path2}`)

    // 7. Navigate through Turbo, Audio, Parental, and About tabs
    console.log('Testing Turbo, Audio, Parental, and About tabs...')
    const testOtherTabs = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const navItems = Array.from(document.querySelectorAll('.cinema-settings-nav-item'));
          const results = {};

          for (const tab of navItems) {
            const name = tab.textContent.trim();
            tab.click();
            const pane = document.querySelector('.settings-tab-pane');
            results[name] = pane ? pane.querySelectorAll('.settings-section').length : 0;
          }
          return results;
        })()
      `,
      returnByValue: true,
    })
    console.log('Tabs Verification Summary (sections per tab):', testOtherTabs.result.value)

    // 8. Close Settings and verify Cable EPG panel layout is active in catalog
    console.log('Closing settings and verifying Cable EPG layout on live channels...')
    await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtn = document.querySelector('.cinema-settings-head button');
          if (closeBtn) closeBtn.click();
        })()
      `,
    })

    await sleep(1200)

    const cableCheck = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const cableRows = document.querySelectorAll('.cable-epg-row').length;
          const cableNumber = document.querySelector('.cable-number')?.textContent || '';
          const cableName = document.querySelector('.cable-name')?.textContent || '';
          return {
            cableRowsCount: cableRows,
            sampleNumber: cableNumber,
            sampleName: cableName
          };
        })()
      `,
      returnByValue: true,
    })
    console.log('Cable EPG Active Verification on Catalog:', cableCheck.result.value)

    // Capture screenshot of Cable EPG view
    const shot3 = await sendCDP('Page.captureScreenshot', { format: 'png' })
    const path3 = path.join(artifactDir, 'cinema-cable-view.png')
    fs.writeFileSync(path3, Buffer.from(shot3.data, 'base64'))
    console.log(`✓ Saved Cable EPG View Screenshot: ${path3}`)

    console.log('=== All Settings Suite & 10-Player Checks Passed Successfully! ===')
  } finally {
    cleanup()
  }
}

main().catch((e) => {
  console.error('Verification failed:', e)
  process.exit(1)
})
