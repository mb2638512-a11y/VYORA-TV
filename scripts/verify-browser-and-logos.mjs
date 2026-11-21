// verify-browser-and-logos.mjs
const BASE = 'http://127.0.0.1:8787'

function b64(str) {
  return Buffer.from(str, 'utf-8').toString('base64')
}

async function testEndpoint(name, url, checkFn) {
  try {
    const t0 = Date.now()
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 VyoraVerification/1.0' } })
    const dt = Date.now() - t0
    const text = await res.text()
    const ok = checkFn(res, text)
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} (${dt}ms) - Status: ${res.status}`)
    if (!ok) {
      console.log(`       Preview: ${text.slice(0, 150)}`)
    }
    return ok
  } catch (err) {
    console.log(`[FAIL] ${name} - Error: ${err.message}`)
    return false
  }
}

async function testLogo(name, targetUrl) {
  try {
    const t0 = Date.now()
    // Test through /api/logo with base64 (standard platform route)
    const url = `${BASE}/api/logo?u=${b64(targetUrl)}`
    const res = await fetch(url)
    const dt = Date.now() - t0
    const contentType = res.headers.get('content-type') || ''
    const buf = await res.arrayBuffer()
    const isImage = res.status === 200 && (contentType.startsWith('image/') || contentType.includes('icon') || contentType.includes('octet-stream'))
    const hasBytes = buf.byteLength > 40
    const ok = isImage && hasBytes
    console.log(`[${ok ? 'PASS' : 'FAIL'}] Logo: ${name} (${dt}ms) - Status: ${res.status}, Type: ${contentType}, Size: ${buf.byteLength}B`)
    return ok
  } catch (err) {
    console.log(`[FAIL] Logo: ${name} - Error: ${err.message}`)
    return false
  }
}

async function run() {
  console.log('=== VYORA CHROMIUM BROWSER & LOGO SUITE VERIFICATION ===\n')

  let total = 0
  let passed = 0

  // 1. Check API health & bootstrap
  total++
  if (await testEndpoint('Vyora Server API Health', `${BASE}/api/health`, (res, text) => {
    return res.status === 200 && text.includes('"status":"ok"')
  })) passed++

  total++
  if (await testEndpoint('Vyora Server Bootstrap', `${BASE}/api/bootstrap`, (res, text) => {
    return res.status === 200 && text.includes('countries')
  })) passed++

  // 2. Test Search Engines via WebProxy
  const engines = [
    { name: 'DuckDuckGo HTML Search', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://html.duckduckgo.com/html/?q=pakistan+news')}`, needle: 'duckduckgo' },
    { name: 'DuckDuckGo Lite Search', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://lite.duckduckgo.com/lite/?q=cricket')}`, needle: 'duckduckgo' },
    { name: 'Bing Web Search', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://www.bing.com/search?q=weather')}`, needle: 'bing' },
    { name: 'Google Web Search', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://www.google.com/search?q=technology')}`, needle: 'google' },
    { name: 'Yahoo Web Search', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://search.yahoo.com/search?p=sports')}`, needle: 'sports' },
  ]

  for (const eng of engines) {
    total++
    if (await testEndpoint(eng.name, eng.url, (res, text) => {
      const hasContent = text.length > 300
      const hasScriptOrResults = text.includes('VYORA_NAVIGATE') || text.includes('proxyNav') || text.toLowerCase().includes(eng.needle)
      return (res.status === 200 || res.status === 202) && hasContent && hasScriptOrResults
    })) passed++
  }

  // 3. Test Direct Target Websites via WebProxy
  const websites = [
    { name: 'Wikipedia', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://en.wikipedia.org/wiki/Television')}`, needle: 'Television' },
    { name: 'Fast.com', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://fast.com')}`, needle: 'fast' },
    { name: 'Example Domain', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://example.com')}`, needle: 'Example' },
    { name: 'Archive.org', url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://archive.org')}`, needle: 'archive' },
  ]

  for (const site of websites) {
    total++
    if (await testEndpoint(`Website: ${site.name}`, site.url, (res, text) => {
      return res.status === 200 && text.toLowerCase().includes(site.needle.toLowerCase())
    })) passed++
  }

  // 4. Test Search Engine Redirect Unpacking via WebProxy
  const sampleRedirects = [
    {
      name: 'DuckDuckGo Redirect Unpack -> cricbuzz.com',
      url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.cricbuzz.com%2F&rut=1')}`,
      needle: 'cricbuzz'
    },
    {
      name: 'Google Redirect Unpack -> wikipedia.org',
      url: `${BASE}/api/webproxy?u=${encodeURIComponent('https://www.google.com/url?q=https://en.wikipedia.org/wiki/Main_Page&sa=U')}`,
      needle: 'wikipedia'
    },
  ]

  for (const redir of sampleRedirects) {
    total++
    if (await testEndpoint(redir.name, redir.url, (res, text) => {
      return res.status === 200 && text.toLowerCase().includes(redir.needle.toLowerCase())
    })) passed++
  }

  // 5. Test Logo Proxy for Installed Apps
  const testDomains = [
    { name: 'YouTube', url: 'https://www.youtube.com' },
    { name: 'Fast.com', url: 'https://fast.com' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
    { name: 'Weather.com', url: 'https://weather.com' },
    { name: 'Twitch', url: 'https://www.twitch.tv' },
    { name: 'Reddit', url: 'https://www.reddit.com' },
    { name: 'Cricbuzz', url: 'https://www.cricbuzz.com' },
    { name: 'Netflix', url: 'https://www.netflix.com' },
    { name: 'GitHub', url: 'https://github.com' },
  ]

  console.log('\n--- Web App Logo Proxy Tests ---')
  for (const d of testDomains) {
    total++
    if (await testLogo(d.name, d.url)) passed++
  }

  console.log(`\n========================================`)
  console.log(`SUMMARY: ${passed}/${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`)
  console.log(`========================================`)

  if (passed === total) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

run()
