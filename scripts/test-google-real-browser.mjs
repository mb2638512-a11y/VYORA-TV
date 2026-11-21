// Real-browser (CDP) check: does Google serve RESULTS when a genuine Chromium
// engine renders it with JavaScript enabled? This decides the whole browser
// architecture: if a real engine gets results, the browser must render Google
// natively instead of proxying a scraped shell.
import { spawn } from 'child_process'
import fs from 'fs'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = 9231

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
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

class CDP {
  constructor(u) {
    this.u = u
    this.id = 1
    this.cb = new Map()
  }
  async connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.u)
      this.ws.onopen = () => res()
      this.ws.onerror = rej
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data.toString())
        if (m.id && this.cb.has(m.id)) {
          const { resolve, reject } = this.cb.get(m.id)
          this.cb.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      }
    })
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++
      this.cb.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }
}

async function main() {
  const proc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1920,1080',
      `--user-data-dir=C:\\Windows\\Temp\\chrome-gtest-${Date.now()}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  try {
    const cdp = new CDP(await getWsUrl())
    await cdp.connect()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')

    const failed = []
    cdp.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data.toString())
      if (m.method === 'Network.loadingFailed') failed.push(m.params.errorText)
    })

    const targets = [
      ['google-search', 'https://www.google.com/search?q=youtube'],
      ['google-igu', 'https://www.google.com/search?igu=1&q=youtube'],
      ['google-noscript', 'https://www.google.com/search?q=youtube&gbv=1'],
      ['ddg-html', 'https://html.duckduckgo.com/html/?q=youtube'],
      ['bing', 'https://www.bing.com/search?q=youtube'],
      ['brave', 'https://search.brave.com/search?q=youtube'],
      ['youtube', 'https://www.youtube.com/results?search_query=youtube'],
    ]

    for (const [name, url] of targets) {
      await cdp.send('Page.navigate', { url })
      await sleep(4500)

      const info = await cdp.eval(`(() => {
        const out = { title: document.title, url: location.href, links: 0, results: 0, text: 0 };
        const as = Array.from(document.querySelectorAll('a[href]'));
        out.links = as.length;
        // Heuristic: count links that point at an external destination.
        out.results = as.filter(a => {
          const h = a.href || '';
          return /^https?:/.test(h) && !/google\\.|bing\\.|duckduckgo\\.|brave\\.|youtube\\.com/.test(h);
        }).length;
        out.text = (document.body ? document.body.innerText : '').trim().length;
        const h3s = Array.from(document.querySelectorAll('h3')).map(h => h.innerText.trim()).filter(Boolean);
        out.h3 = h3s.slice(0, 4);
        out.lis = Array.from(document.querySelectorAll('li')).length;
        return out;
      })()`)

      console.log(
        `\n=== ${name} ===\n  finalUrl: ${info.url}\n  title: ${info.title}\n  anchors=${info.links} external=${info.results} li=${info.lis} textLen=${info.text}`,
      )
      if (info.h3?.length) console.log('  h3s:', JSON.stringify(info.h3))
      if (failed.length) {
        console.log('  network failures:', [...new Set(failed)].slice(0, 5).join(' | '))
        failed.length = 0
      }
    }
  } finally {
    proc.kill()
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
