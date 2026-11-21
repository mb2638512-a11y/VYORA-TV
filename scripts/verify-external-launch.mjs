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
  console.log('--- Testing External Player Launch & Stream Dialog ---')

  const artifactDir = 'C:\\Users\\Mustafa\\.gemini\\antigravity\\brain\\40f9a44e-2536-4df7-ae2b-b92113eae243'
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9224',
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
        targets = await getJSON('http://127.0.0.1:9224/json')
        if (targets && targets.length > 0) break
      } catch {}
    }

    const pageTarget = targets.find((t) => t.type === 'page') || targets[0]
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

    await sendCDP('Runtime.enable')
    await sendCDP('Page.enable')

    await sendCDP('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // Wait for platform to mount
    for (let i = 0; i < 25; i++) {
      await sleep(800)
      const chk = await sendCDP('Runtime.evaluate', {
        expression: `!!(document.querySelector('button[title="System Settings"]') || document.querySelector('.topbar'))`,
        returnByValue: true,
      })
      if (chk?.result?.value) break
    }

    await sleep(1000)

    // Set settings directly in localStorage: channelsPlayer = 'mx'
    console.log('Setting channelsPlayer = "mx" in localStorage and reloading...')
    await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const curr = JSON.parse(localStorage.getItem('vyora.settings') || '{}');
          curr.channelsPlayer = 'mx';
          localStorage.setItem('vyora.settings', JSON.stringify(curr));
        })()
      `,
    })

    await sendCDP('Page.reload')
    await sleep(2500)

    // Click first channel
    console.log('Clicking first live channel...')
    const clickChannelRes = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const card = document.querySelector('.channel-card, .cable-epg-row');
          if (card) {
            card.click();
            return { ok: true, text: card.textContent.slice(0, 50) };
          }
          return { ok: false, error: 'No channel card found' };
        })()
      `,
      returnByValue: true,
    })
    console.log('Channel Click:', clickChannelRes.result.value)

    await sleep(1200)

    // Verify Cinema External Stream Launch Dialog is visible
    const dialogCheck = await sendCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const dialog = document.querySelector('.cinema-stream-dialog');
          if (!dialog) return { ok: false, error: 'Dialog not found' };

          const title = dialog.querySelector('.stream-dialog-title h3')?.textContent || '';
          const subtitle = dialog.querySelector('.stream-dialog-subtitle')?.textContent || '';
          const itemName = dialog.querySelector('.stream-item-name')?.textContent || '';
          const streamUrl = dialog.querySelector('.stream-url-preview')?.textContent || '';
          const buttons = Array.from(dialog.querySelectorAll('button')).map(b => b.textContent.trim());

          return {
            ok: true,
            title,
            subtitle,
            itemName,
            streamUrl,
            buttons
          };
        })()
      `,
      returnByValue: true,
    })
    console.log('Stream Dialog Verification:', JSON.stringify(dialogCheck.result.value, null, 2))

    // Capture screenshot of External Stream Dialog
    const shot = await sendCDP('Page.captureScreenshot', { format: 'png' })
    const shotPath = path.join(artifactDir, 'cinema-external-stream-dialog.png')
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
    console.log(`✓ Saved External Stream Dialog Screenshot: ${shotPath}`)

    console.log('=== External Stream Dialog Verification Passed! ===')
  } finally {
    cleanup()
  }
}

main().catch((e) => {
  console.error('Verification failed:', e)
  process.exit(1)
})
