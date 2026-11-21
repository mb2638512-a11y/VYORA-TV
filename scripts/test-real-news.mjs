// scripts/test-real-news.mjs
const BASE = 'http://127.0.0.1:8787'

const sites = [
  'https://www.foxnews.com/',
  'https://www.cnn.com/',
  'https://apnews.com/',
  'https://www.bbc.co.uk/news',
  'https://news.sky.com/',
  'https://abcnews.com/',
  'https://www.washingtonpost.com/',
  'https://www.cbsnews.com/us/'
]

async function run() {
  for (const url of sites) {
    try {
      const res = await fetch(`${BASE}/api/webproxy?u=${encodeURIComponent(url)}`)
      const text = await res.text()
      const isError = text.includes('This site blocked the request') ||
                      text.includes('This site could not be reached') ||
                      text.includes('Invalid address') ||
                      text.includes('Page could not be loaded') ||
                      res.status !== 200

      if (isError) {
        console.log(`❌ FAILED: ${url}`)
        console.log(`   Status: ${res.status}`)
        const titleMatch = text.match(/<h2[^>]*>(.*?)<\/h2>/i) || text.match(/<title[^>]*>(.*?)<\/title>/i)
        const descMatch = text.match(/<p class="error-desc"[^>]*>(.*?)<\/p>/i)
        console.log(`   Title: ${titleMatch ? titleMatch[1] : 'N/A'}`)
        console.log(`   Desc: ${descMatch ? descMatch[1] : 'N/A'}`)
      } else {
        console.log(`✅ OK: ${url} (Status ${res.status}, ${text.length} bytes)`)
      }
    } catch (e) {
      console.log(`❌ ERROR: ${url} -> ${e.message}`)
    }
  }
}

run()
