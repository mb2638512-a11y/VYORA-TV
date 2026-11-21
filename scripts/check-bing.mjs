// scripts/check-bing.mjs
const BASE = 'http://127.0.0.1:8787'

async function test() {
  const res = await fetch(BASE + '/api/webproxy?u=' + encodeURIComponent('https://www.bing.com/search?q=news'))
  const html = await res.text()
  const re = /href=["']([^"']*ck\/a[^"']*)["']/gi
  let m
  let count = 0
  while ((m = re.exec(html)) !== null) {
    count++
    if (count <= 5) console.log(`[${count}] ${m[1]}`)
  }
  console.log('Total Bing ck/a links:', count)
}

test()
