const base = 'http://127.0.0.1:8787'

const targets = [
  ['DuckDuckGo search', 'https://html.duckduckgo.com/html/?q=youtube'],
  ['Bing search', 'https://www.bing.com/search?q=youtube'],
  ['Brave search', 'https://search.brave.com/search?q=youtube'],
  ['Google search', 'https://www.google.com/search?igu=1&q=youtube'],
  ['YouTube home', 'https://www.youtube.com/'],
  ['YouTube watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['Wikipedia', 'https://en.m.wikipedia.org/wiki/Internet'],
  ['BBC news', 'https://www.bbc.com/news'],
]

for (const [label, url] of targets) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${base}/api/webproxy?u=${encodeURIComponent(url)}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    })
    const loc = res.headers.get('location') || ''
    const ctype = res.headers.get('content-type') || ''
    let body = ''
    if (res.status === 200) {
      const buf = Buffer.from(await res.arrayBuffer())
      body = buf.toString('utf8', 0, 800)
      const hasBase = body.includes('<base')
      const hasResults = /result__a|result|search-result|<h3/i.test(body)
      console.log(
        `${label.padEnd(18)} ${res.status} ${String(Date.now() - t0).padStart(5)}ms ${ctype.slice(0, 24).padEnd(24)} base=${hasBase ? 'Y' : 'N'} results=${hasResults ? 'Y' : 'N'} bytes=${buf.length}`,
      )
      if (body.includes('VYORA_') || body.includes('webproxy')) console.log(`    (contains proxy markers)`)
      const errMatch = body.match(/<title[^>]*>([^<]{0,120})/i)
      if (errMatch) console.log(`    title: ${errMatch[1].trim()}`)
    } else {
      console.log(`${label.padEnd(18)} ${res.status} ${Date.now() - t0}ms -> ${loc.slice(0, 110)}`)
    }
  } catch (e) {
    console.log(`${label.padEnd(18)} FAILED ${Date.now() - t0}ms ${e.message}`)
  }
}
