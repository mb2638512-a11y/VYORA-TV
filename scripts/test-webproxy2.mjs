const base = 'http://127.0.0.1:8787'

// Simulate what an <iframe> actually sends.
const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'iframe',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
}

const targets = [
  ['YouTube watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['YouTube home', 'https://www.youtube.com/'],
  ['DDG search', 'https://html.duckduckgo.com/html/?q=youtube'],
  ['Bing search', 'https://www.bing.com/search?q=youtube'],
  ['Brave search', 'https://search.brave.com/search?q=youtube'],
  ['Yahoo search', 'https://search.yahoo.com/search?p=youtube'],
]

for (const [label, url] of targets) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${base}/api/webproxy?u=${encodeURIComponent(url)}`, {
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(30000),
    })
    const loc = res.headers.get('location') || ''
    if (res.status === 200) {
      const buf = Buffer.from(await res.arrayBuffer())
      const html = buf.toString('utf8')
      const title = (html.match(/<title[^>]*>([^<]{0,100})/i) || [])[1] || ''
      const links = (html.match(/<a\s[^>]*href=/gi) || []).length
      const scripts = (html.match(/<script/gi) || []).length
      const baseTag = (html.match(/<base[^>]*href="([^"]*)"/i) || [])[1] || ''
      console.log(
        `${label.padEnd(16)} ${res.status} ${String(Date.now() - t0).padStart(5)}ms bytes=${String(buf.length).padStart(7)} links=${String(links).padStart(4)} scripts=${String(scripts).padStart(3)}`,
      )
      console.log(`   title: ${title.trim().slice(0, 80)}`)
      console.log(`   base : ${baseTag.slice(0, 100)}`)
    } else {
      console.log(`${label.padEnd(16)} ${res.status} ${Date.now() - t0}ms -> ${decodeURIComponent(loc).slice(0, 120)}`)
    }
  } catch (e) {
    console.log(`${label.padEnd(16)} FAILED ${Date.now() - t0}ms ${e.message}`)
  }
}
