// Capture the EXACT request headers a real Chromium sends to Google, so the Go
// proxy can replay them. The proxy currently sends a "Chrome-like" set and gets
// back a JavaScript-only shell; the real browser gets the full page.
import { spawn } from 'child_process'
import fs from 'fs'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = 9239

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(400)
  }
  throw new Error('no CDP endpoint')
}

async function main() {
  const proc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=C:\\Windows\\Temp\\chrome-hdr-${Date.now()}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  try {
    const ws = new WebSocket(await getWsUrl())
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })

    let id = 1
    const cb = new Map()
    const captured = []
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data.toString())
      if (m.id && cb.has(m.id)) {
        const { resolve, reject } = cb.get(m.id)
        cb.delete(m.id)
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      }
      if (m.method === 'Network.requestWillBeSent') {
        captured.push({
          url: m.params.request.url,
          headers: m.params.request.headers,
          method: m.params.request.method,
        })
      }
    }
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const i = id++
        cb.set(i, { resolve, reject })
        ws.send(JSON.stringify({ id: i, method, params }))
      })

    await send('Network.enable')
    await send('Page.enable')
    await send('Network.setCacheDisabled', { cacheDisabled: true })

    await send('Page.navigate', { url: 'https://www.google.com/search?igu=1&q=youtube' })
    await sleep(8000)

    const docReq = captured.find((r) => r.url.includes('/search') && r.method === 'GET')
    if (!docReq) {
      console.log('NO CAPTURED REQUEST. urls seen:')
      captured.forEach((r) => console.log('  ', r.method, r.url.slice(0, 120)))
      return
    }

    console.log('=== REAL BROWSER REQUEST ===')
    console.log('URL:', docReq.url)
    const keys = Object.keys(docReq.headers).sort()
    for (const k of keys) {
      console.log(`  ${k}: ${String(docReq.headers[k]).slice(0, 160)}`)
    }
    fs.writeFileSync('scripts/_engine_html/google_real_headers.json', JSON.stringify(docReq, null, 2))
    console.log('\n(saved -> scripts/_engine_html/google_real_headers.json)')
  } finally {
    proc.kill()
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
