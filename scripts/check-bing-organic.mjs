// scripts/check-bing-organic.mjs
const BASE = 'http://127.0.0.1:8787'

async function test() {
  const res = await fetch(BASE + '/api/webproxy?u=' + encodeURIComponent('https://www.bing.com/search?q=news'))
  const html = await res.text()
  
  // Find all <li class="b_algo">
  const algoRegex = /<li\s+class=["'][^"']*b_algo[^"']*["'][^>]*>(.*?)<\/li>/gis
  let match
  let count = 0
  while ((match = algoRegex.exec(html)) !== null) {
    count++
    const block = match[1]
    const aMatch = block.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/is)
    if (aMatch) {
      console.log(`[Algo ${count}] Href: ${aMatch[1]}`)
      const uParamMatch = aMatch[1].match(/[?&]u=([^&]+)/)
      if (uParamMatch) {
        let b64 = uParamMatch[1]
        if (b64.startsWith('a1')) b64 = b64.slice(2)
        while (b64.length % 4 !== 0) b64 += '='
        try {
          console.log(`        Decoded target: ${Buffer.from(b64, 'base64').toString('utf-8')}`)
        } catch (e) {
          console.log(`        Decode error: ${e.message}`)
        }
      }
    }
  }
  console.log(`Total b_algo organic results: ${count}`)
}

test()
