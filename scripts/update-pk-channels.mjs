import fs from 'node:fs'
import path from 'node:path'

const pkPath = 'server/data/channels/PK.json'
const pkChannels = JSON.parse(fs.readFileSync(pkPath, 'utf8'))
const m3u = fs.readFileSync('data/raw/playlists/adeelwajid_pk.m3u', 'utf8')

const lines = m3u.split('\n')
const m3uMap = new Map()

for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('#EXTINF')) {
    const rawInf = lines[i]
    const url = lines[i + 1]?.trim()
    if (!url || !url.startsWith('http')) continue

    const idMatch = rawInf.match(/tvg-id="([^"]+)"/)
    const logoMatch = rawInf.match(/tvg-logo="([^"]+)"/)
    const groupMatch = rawInf.match(/group-title="([^"]+)"/)
    const titleMatch = rawInf.split(',')[1]?.trim()

    const rawId = idMatch ? idMatch[1].split('@')[0] : ''
    const logo = logoMatch ? logoMatch[1] : ''
    const group = groupMatch
      ? groupMatch[1].split(';').map((g) => g.toLowerCase().trim())
      : ['general']

    if (rawId) {
      if (!m3uMap.has(rawId)) m3uMap.set(rawId, [])
      m3uMap.get(rawId).push({ url, logo, group, title: titleMatch })
    }
  }
}

console.log('Parsed active channels in adeelwajid_pk.m3u:', m3uMap.size)

let updatedCount = 0
pkChannels.forEach((ch) => {
  const verifiedList = m3uMap.get(ch.id)
  if (verifiedList && verifiedList.length > 0) {
    updatedCount++
    const newStreams = verifiedList.map((item, idx) => ({
      id: `${ch.id}-v${idx}`,
      url: item.url,
      quality: '720p',
      label: `Live HLS ${idx + 1}`,
      hls: true,
    }))

    // Retain non-duplicate existing streams as secondary backups
    const existing = (ch.streams || []).filter(
      (s) => !newStreams.some((ns) => ns.url === s.url)
    )
    ch.streams = [...newStreams, ...existing]
    if (verifiedList[0].logo && (!ch.logo || ch.logo.includes('wikimedia'))) {
      ch.logo = verifiedList[0].logo
      ch.icon = verifiedList[0].logo
    }
  }
})

console.log('Updated PK channels with verified working streams:', updatedCount)
fs.writeFileSync(pkPath, JSON.stringify(pkChannels, null, 2), 'utf8')
fs.writeFileSync('web/public/data/channels/PK.json', JSON.stringify(pkChannels, null, 2), 'utf8')
fs.writeFileSync('web/dist/data/channels/PK.json', JSON.stringify(pkChannels, null, 2), 'utf8')
console.log('Saved PK.json to server, web/public, and web/dist!')
