const url = process.argv[2] || 'https://cdn4.mjunoon.tv:8087/streamtest/146M/chunks.m3u8'

async function timeIt(label, fn) {
  const t = Date.now()
  try {
    const r = await fn()
    const text = typeof r === 'string' ? r : await r.text()
    console.log(`${label}: ${Date.now() - t}ms  bytes=${text.length}`)
    return text
  } catch (e) {
    console.log(`${label}: FAILED after ${Date.now() - t}ms  ${String(e.message || e)}`)
    return null
  }
}

const t = Date.now()
try {
  const dns = await import('node:dns')
  const r = await dns.promises.lookup('cdn4.mjunoon.tv', { all: true })
  console.log(`dns: ${Date.now() - t}ms -> ${r.map((x) => x.address).join(',')}`)
} catch (e) {
  console.log('dns failed:', String(e.message || e))
}

await timeIt('direct fetch (node undici)', () => fetch(url))
