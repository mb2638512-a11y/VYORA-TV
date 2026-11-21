// Decisive architecture test.
//
// Headless Chrome is detected by Google (it redirects to /sorry/index), so the
// test runs HEADED Chrome with the real system proxy — the same conditions the
// Vyora app's own WebView/iframe has.
//
// It answers one question: can a page be shown inside an iframe with a real
// browser engine executing its JavaScript? If YES, the browser must load
// websites DIRECTLY and must NOT scrape them server-side.
import { spawn } from 'child_process'
import fs from 'fs'
import http from 'http'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = 9237
const PROBE_URL = 'file:///E:/Vyora%20TV/scripts/_engine_html/frame-probe.html'

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
  async screenshot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'))
    console.log('  screenshot ->', path)
  }
}

/** List every frame in the page with its own URL. */
async function listFrames(cdp) {
  const { frameTree } = await cdp.send('Page.getFrameTree')
  const out = []
  const walk = (node) => {
    out.push({ url: node.frame.url, id: node.frame.id, parent: node.frame.parentId || null })
    ;(node.childFrames || []).forEach(walk)
  }
  walk(frameTree)
  return out
}

async function main() {
  const proc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1400,900',
      '--window-position=0,0',
      `--user-data-dir=C:\\Windows\\Temp\\chrome-frame-${Date.now()}`,
      PROBE_URL,
    ],
    { stdio: 'ignore' },
  )

  try {
    const cdp = new CDP(await getWsUrl())
    await cdp.connect()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    await sleep(9000)

    const frames = await listFrames(cdp)
    console.log('\n=== FRAMES ===')
    for (const f of frames) console.log(`  ${f.parent ? 'child' : 'main '} ${f.url.slice(0, 130)}`)

    const probeText = await cdp.eval(`document.getElementById('probe') ? document.getElementById('probe').innerText : 'NO PROBE'`)
    console.log('\n=== PROBE OUTPUT ===\n' + probeText)

    await cdp.screenshot('scripts/_engine_html/frame-probe-result.png')

    // Now measure the CHILD frame's DOM through CDP (works cross-origin).
    let childInfo = null
    for (const f of frames) {
      if (f.parent && f.url.includes('google.com')) {
        // Create an isolated world bound to that frame's execution context.
        let ctxId = null
        try {
          const created = await cdp.send('Page.createIsolatedWorld', {
            frameId: f.id,
            worldName: 'probe',
            grantUniveralAccess: true,
          })
          ctxId = created.executionContextId
        } catch (e) {
          console.log('  createIsolatedWorld failed:', e.message)
        }
        const opts = { expression: `(() => {
            const d = document;
            const links = Array.from(d.querySelectorAll('a[href]'));
            const h3 = Array.from(d.querySelectorAll('h3')).map(h=>h.innerText.trim()).filter(Boolean);
            return {
              title: d.title,
              anchors: links.length,
              h3count: h3.length,
              h3sample: h3.slice(0,5),
              textLen: (d.body? d.body.innerText : '').trim().length,
              externalLinks: links.filter(a=>/^https?:/.test(a.href) && !/google\\./.test(a.href)).length,
              hasSorry: location.href.includes('/sorry/'),
            };
          })()` }
        if (ctxId) opts.contextId = ctxId
        const { result } = await cdp.send('Runtime.evaluate', opts).catch(() => ({ result: null }))
        childInfo = result?.value || null
      }
    }

    if (childInfo) {
      console.log('\n=== GOOGLE CHILD FRAME DOM (via CDP) ===')
      console.log('  title:', childInfo.title)
      console.log('  anchors:', childInfo.anchors, 'external:', childInfo.externalLinks)
      console.log('  h3 count:', childInfo.h3count)
      console.log('  h3 sample:', JSON.stringify(childInfo.h3sample))
      console.log('  text length:', childInfo.textLen)
      console.log(
        childInfo.h3count > 0 && childInfo.textLen > 500
          ? '\n  ✅ VERDICT: Google renders REAL RESULTS inside a nested iframe with a real JS engine.'
          : '\n  ❌ VERDICT: Google does NOT render results in the nested iframe.',
      )
    } else {
      console.log('\n  (no google child frame found)')
    }
  } finally {
    proc.kill()
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
