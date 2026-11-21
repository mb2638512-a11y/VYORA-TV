// scripts/test-user-flow.mjs
const BASE = 'http://127.0.0.1:8787'

function b64(str) {
  return Buffer.from(str, 'utf-8').toString('base64')
}

async function test(name, fn) {
  const t0 = Date.now()
  try {
    const res = await fn()
    const dt = Date.now() - t0
    console.log(`[PASS] ${name} (${dt}ms) -> ${res}`)
    return true
  } catch (err) {
    const dt = Date.now() - t0
    console.log(`[FAIL] ${name} (${dt}ms) -> ${err.message}`)
    return false
  }
}

async function run() {
  console.log('===============================================================')
  console.log('   VYORA TV: 5-ENGINE SEARCH & VIDEO PLAYBACK VERIFICATION   ')
  console.log('===============================================================\n')

  let passed = 0
  let total = 0

  // PART 1: 5 ENGINES SEARCH FOR YOUTUBE
  console.log('--- 1. Searching for "youtube" across all 5 engines ---')

  const engines = [
    { name: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/?q=youtube' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=youtube' },
    { name: 'Google', url: 'https://www.google.com/search?q=youtube' },
    { name: 'Brave', url: 'https://search.brave.com/search?q=youtube' },
    { name: 'Yahoo', url: 'https://search.yahoo.com/search?p=youtube' },
  ]

  for (const eng of engines) {
    total++
    const ok = await test(`Engine: ${eng.name} search "youtube"`, async () => {
      const res = await fetch(`${BASE}/api/webproxy?u=${encodeURIComponent(eng.url)}`)
      if (res.status !== 200 && res.status !== 202) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      if (html.length < 500) throw new Error(`Too short (${html.length}b)`)
      const hasYt = html.toLowerCase().includes('youtube')
      if (!hasYt) throw new Error('Search results did not contain youtube')
      return `HTTP ${res.status}, ${html.length} bytes, has results`
    })
    if (ok) passed++
  }

  // PART 2: YOUTUBE VIDEO PLAYBACK TESTS
  console.log('\n--- 2. YouTube Video Playback & Embed Resolution ---')

  const ytVideos = [
    { name: 'YouTube Standard Watch', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', expectedId: 'jNQXAC9IVRw' },
    { name: 'YouTube Short URL (youtu.be)', url: 'https://youtu.be/jNQXAC9IVRw', expectedId: 'jNQXAC9IVRw' },
    { name: 'YouTube Shorts', url: 'https://www.youtube.com/shorts/jNQXAC9IVRw', expectedId: 'jNQXAC9IVRw' },
    { name: 'YouTube Rickroll Watch', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
  ]

  for (const v of ytVideos) {
    total++
    const ok = await test(`Video Playback: ${v.name}`, async () => {
      const res = await fetch(`${BASE}/api/webproxy?u=${encodeURIComponent(v.url)}`, { redirect: 'manual' })
      const loc = res.headers.get('location') || ''
      if (res.status !== 307 && res.status !== 302) {
        throw new Error(`Expected redirect (307/302), got HTTP ${res.status}`)
      }
      if (!loc.includes(`embed/${v.expectedId}`)) {
        throw new Error(`Redirect target wrong: ${loc}`)
      }
      // Also verify that the target embed can be loaded directly in iframe
      const embedRes = await fetch(loc, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/131' } })
      if (embedRes.status !== 200) {
        throw new Error(`Target embed failed with HTTP ${embedRes.status}`)
      }
      return `Redirects to ${loc.slice(0, 60)}... -> Embed HTTP 200 (Playable in iframe)`
    })
    if (ok) passed++
  }

  // PART 3: OTHER SITES VERIFICATION
  console.log('\n--- 3. Testing Diverse Target Websites via WebProxy ---')

  const otherSites = [
    { name: 'Wikipedia Main Page', url: 'https://en.wikipedia.org/wiki/Main_Page', needle: 'Wikipedia' },
    { name: 'Fast.com Speed Test', url: 'https://fast.com', needle: 'fast' },
    { name: 'Hacker News (YCombinator)', url: 'https://news.ycombinator.com', needle: 'Hacker News' },
    { name: 'Old Reddit Technology', url: 'https://old.reddit.com/r/technology', needle: 'technology' },
    { name: 'GitHub Explore', url: 'https://github.com/explore', needle: 'GitHub' },
    { name: 'Internet Archive', url: 'https://archive.org', needle: 'archive' },
    { name: 'Cricbuzz Live Cricket', url: 'https://www.cricbuzz.com', needle: 'cricbuzz' },
    { name: 'Example Domain', url: 'https://example.com', needle: 'example' },
  ]

  for (const s of otherSites) {
    total++
    const ok = await test(`Website: ${s.name}`, async () => {
      const res = await fetch(`${BASE}/api/webproxy?u=${encodeURIComponent(s.url)}`)
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      if (!html.toLowerCase().includes(s.needle.toLowerCase())) {
        throw new Error(`Missing expected text: "${s.needle}"`)
      }
      return `HTTP 200, ${html.length} bytes, verified content`
    })
    if (ok) passed++
  }

  // PART 4: APP LOGO EXTRACTION
  console.log('\n--- 4. Web App Logo Proxy for Installed Apps ---')

  const logoSites = [
    { name: 'YouTube Logo', url: 'https://www.youtube.com' },
    { name: 'Reddit Logo', url: 'https://www.reddit.com' },
    { name: 'Cricbuzz Logo', url: 'https://www.cricbuzz.com' },
    { name: 'Wikipedia Logo', url: 'https://www.wikipedia.org' },
    { name: 'Fast.com Logo', url: 'https://fast.com' },
    { name: 'GitHub Logo', url: 'https://github.com' },
  ]

  for (const l of logoSites) {
    total++
    const ok = await test(`Logo: ${l.name}`, async () => {
      const res = await fetch(`${BASE}/api/logo?u=${b64(l.url)}`)
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const ctype = res.headers.get('content-type') || ''
      if (!ctype.startsWith('image/')) throw new Error(`Not an image: ${ctype}`)
      const buf = await res.arrayBuffer()
      if (buf.byteLength < 50) throw new Error(`Image too small (${buf.byteLength}b)`)
      return `HTTP 200, Type: ${ctype}, Size: ${buf.byteLength} bytes`
    })
    if (ok) passed++
  }

  console.log('\n===============================================================')
  console.log(`SUMMARY: ${passed} / ${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`)
  console.log('===============================================================')

  if (passed === total) process.exit(0)
  else process.exit(1)
}

run()
