// scripts/diagnose-links.mjs
const BASE = 'http://127.0.0.1:8787'

function unpackRedirect(u) {
  try {
    if (u.includes('duckduckgo.com/l/?') || u.includes('duckduckgo.com/l?')) {
      const parsed = new URL(u)
      let dest = parsed.searchParams.get('uddg') || parsed.searchParams.get('kh')
      if (dest) return decodeURIComponent(dest)
    }
    if (u.includes('bing.com/ck/a?')) {
      const parsed = new URL(u)
      const uParam = parsed.searchParams.get('u')
      if (uParam && uParam.startsWith('a1')) {
        const rawB64 = uParam.slice(2)
        const padded = rawB64 + '='.repeat((4 - (rawB64.length % 4)) % 4)
        return Buffer.from(padded, 'base64').toString('utf-8')
      }
    }
    if (u.includes('google.com/url?')) {
      const parsed = new URL(u)
      const q = parsed.searchParams.get('q') || parsed.searchParams.get('url')
      if (q) return decodeURIComponent(q)
    }
    if (u.includes('r.search.yahoo.com/')) {
      const match = u.match(/\/RU=([^/]+)\//)
      if (match) return decodeURIComponent(match[1])
    }
  } catch (e) {}
  return u
}

async function testEngine(engineName, searchUrl) {
  console.log(`\n===============================================================`)
  console.log(`TESTING SEARCH ENGINE: ${engineName}`)
  console.log(`Search URL: ${searchUrl}`)
  console.log(`===============================================================`)

  try {
    const res = await fetch(`${BASE}/api/webproxy?u=${encodeURIComponent(searchUrl)}`)
    const html = await res.text()
    console.log(`Search page response: HTTP ${res.status}, length: ${html.length}`)

    // Extract all hrefs
    const re = /href=["']([^"']+)["']/gi
    let match
    const candidates = []
    while ((match = re.exec(html)) !== null) {
      let href = match[1].replace(/&amp;/g, '&')
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue
      if (href.startsWith('/')) {
        // relative link on the search engine
        continue
      }
      candidates.push(href)
    }

    console.log(`Found ${candidates.length} external/redirect candidate links. Testing top 5...`)

    for (let i = 0; i < Math.min(5, candidates.length); i++) {
      const rawHref = candidates[i]
      const unpacked = unpackRedirect(rawHref)
      console.log(`\n[Link ${i+1}] Raw: ${rawHref.slice(0, 80)}...`)
      console.log(`        Unpacked: ${unpacked.slice(0, 80)}...`)

      // Test opening this link through the proxy
      const linkRes = await fetch(`${BASE}/api/webproxy?u=${encodeURIComponent(unpacked)}`)
      const body = await linkRes.text()
      const isErrorPage = body.includes('This site blocked the request') ||
                          body.includes('This site could not be reached') ||
                          body.includes('Invalid address') ||
                          body.includes('Page could not be loaded') ||
                          body.includes('No address to open')

      if (isErrorPage) {
        console.log(`        ❌ FAILED! Proxy returned error page (HTTP ${linkRes.status})`)
        const titleMatch = body.match(/<h2[^>]*>(.*?)<\/h2>/i) || body.match(/<title[^>]*>(.*?)<\/title>/i)
        const descMatch = body.match(/<p class="error-desc"[^>]*>(.*?)<\/p>/i)
        console.log(`           Title: ${titleMatch ? titleMatch[1] : 'N/A'}`)
        console.log(`           Desc: ${descMatch ? descMatch[1] : 'N/A'}`)
      } else {
        console.log(`        ✅ SUCCESS! HTTP ${linkRes.status}, Size: ${body.length} bytes`)
      }
    }
  } catch (err) {
    console.log(`Engine test error: ${err.message}`)
  }
}

async function run() {
  await testEngine('DuckDuckGo', 'https://html.duckduckgo.com/html/?q=latest+news')
  await testEngine('Bing', 'https://www.bing.com/search?q=latest+news')
  await testEngine('Google', 'https://www.google.com/search?q=cricket+news')
  await testEngine('Brave', 'https://search.brave.com/search?q=tech+news')
  await testEngine('Yahoo', 'https://search.yahoo.com/search?p=world+news')
}

run()
