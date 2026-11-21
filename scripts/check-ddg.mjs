// scripts/check-ddg.mjs
const BASE = 'http://127.0.0.1:8787'

async function test() {
  const res = await fetch(BASE + '/api/webproxy?u=' + encodeURIComponent('https://html.duckduckgo.com/html/?q=latest+news'))
  const html = await res.text()
  
  // Find all <a> tags
  const aRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis
  let match
  let count = 0
  console.log(`=== DuckDuckGo HTML Result Links ===`)
  while ((match = aRegex.exec(html)) !== null) {
    const href = match[1]
    const text = match[2].replace(/<[^>]+>/g, '').trim()
    if (href.includes('uddg=') || href.includes('duckduckgo.com/l/')) {
      count++
      console.log(`[${count}] Href: ${href}`)
      console.log(`    Text: ${text.slice(0, 50)}`)
    }
  }
  console.log(`Total redirect links found: ${count}`)
}

test()
