import fs from 'node:fs/promises'
import path from 'node:path'
import { isIP } from 'node:net'

const sourcePath = 'web/src/components/AllSiteHub.tsx'
const outputDir = 'artifacts/allsitehub-audit'
const timeoutMs = 10000
const concurrency = 3

function extractSites(source) {
  const patterns = [
    /\{\s*"id"\s*:\s*"([^"]+)"\s*,\s*"title"\s*:\s*"([^"]+)"\s*,\s*"url"\s*:\s*"([^"]+)"/g,
    /\{\s*id\s*:\s*["']([^"']+)["']\s*,\s*title\s*:\s*["']([^"']+)["']\s*,\s*url\s*:\s*["']([^"']+)["']/g,
  ]
  const sites = []
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      sites.push({ id: match[1], title: match[2], url: match[3] })
    }
  }
  return sites
}

function csvCell(value) {
  const text = String(value ?? '')
  return '"' + text.replaceAll('"', '""') + '"'
}

async function checkSite(site) {
  const started = Date.now()
  let current
  try {
    current = new URL(site.url)
    if (current.protocol !== 'https:' || current.username || current.password) {
      throw new Error('Only credential-free HTTPS URLs are permitted')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      // One byte-range GET checks HTTP reachability without downloading a page
      // or media. Redirects are recorded, never followed automatically.
      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Range: 'bytes=0-0',
          'User-Agent': 'VYORA-AllSiteHub-Link-Audit/1.0',
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.5',
        },
      })
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => {})
      let redirectHost = ''
      if (location) {
        try { redirectHost = new URL(location, current).host } catch {}
      }
      return {
        ...site,
        status: response.status,
        result: response.status >= 200 && response.status < 400 ? 'reachable' :
          response.status === 401 || response.status === 403 ? 'restricted' : 'http_error',
        redirectHost,
        durationMs: Date.now() - started,
        error: '',
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    return {
      ...site,
      status: 0,
      result: error?.name === 'AbortError' ? 'timeout' : 'network_error',
      redirectHost: '',
      durationMs: Date.now() - started,
      error: [error?.message, error?.cause?.code, error?.cause?.message]
        .filter(Boolean).join(' | ').slice(0, 240),
    }
  }
}

const source = await fs.readFile(sourcePath, 'utf8')
const sites = extractSites(source)
if (sites.length !== 64) {
  throw new Error(`Expected exactly 64 unique AllSiteHub sites; extracted ${sites.length}. Refusing an incomplete audit.`)
}
const ids = new Set()
for (const site of sites) {
  if (ids.has(site.id)) throw new Error(`Duplicate AllSiteHub site id: ${site.id}`)
  ids.add(site.id)
  const parsed = new URL(site.url)
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    isIP(parsed.hostname) ||
    parsed.hostname === 'localhost' ||
    parsed.hostname.endsWith('.localhost') ||
    parsed.hostname.endsWith('.local') ||
    parsed.hostname.endsWith('.internal') ||
    (parsed.hostname !== site.id && !parsed.hostname.endsWith('.' + site.id))
  ) {
    throw new Error(`Unsafe or non-HTTPS site is not allowed: ${site.url}`)
  }
}

if (process.argv.includes('--validate-only')) {
  console.log(`AllSiteHub catalogue validation passed: ${sites.length} unique credential-free HTTPS sites.`)
  process.exit(0)
}

const results = new Array(sites.length)
let nextIndex = 0
async function worker() {
  while (true) {
    const index = nextIndex++
    if (index >= sites.length) return
    results[index] = await checkSite(sites[index])
    const row = results[index]
    process.stdout.write(`[${index + 1}/${sites.length}] ${row.result.padEnd(12)} ${row.status || '-'} ${row.title} (${row.durationMs}ms)\n`)
  }
}
await fs.mkdir(outputDir, { recursive: true })
await Promise.all(Array.from({ length: concurrency }, () => worker()))

const summary = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  reachable: results.filter((r) => r.result === 'reachable').length,
  restricted: results.filter((r) => r.result === 'restricted').length,
  httpErrors: results.filter((r) => r.result === 'http_error').length,
  timeouts: results.filter((r) => r.result === 'timeout').length,
  networkErrors: results.filter((r) => r.result === 'network_error').length,
  note: 'HTTP reachability only. This does not verify page rendering, login, embedded playback, or legal availability.',
  results,
}
await fs.writeFile(path.join(outputDir, 'results.json'), JSON.stringify(summary, null, 2))
const columns = ['title', 'id', 'url', 'status', 'result', 'redirectHost', 'durationMs', 'error']
const csv = [columns.join(','), ...results.map((row) => columns.map((key) => csvCell(row[key])).join(','))].join('\n')
await fs.writeFile(path.join(outputDir, 'results.csv'), csv + '\n')

const counts = `Reachable: ${summary.reachable} · Restricted (401/403): ${summary.restricted} · HTTP errors: ${summary.httpErrors} · Timeouts: ${summary.timeouts} · Network errors: ${summary.networkErrors}`
console.log(`\nAllSiteHub audit complete: ${counts}`)
console.log(summary.note)
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## AllSiteHub link audit\n\n- Total: ${summary.total}\n- ${counts}\n\n> ${summary.note}\n\nFull CSV and JSON reports are attached as workflow artifacts.\n`)
}
