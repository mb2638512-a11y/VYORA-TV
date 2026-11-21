import fs from 'node:fs'

const p = 'E:/Vyora TV/web/src/lib/i18n.ts'
let s = fs.readFileSync(p, 'utf8')

if (s.includes('searchChannels')) {
  console.log('i18n keys already present')
  process.exit(0)
}

const enAnchor = "  noResults: 'No channels found',\n"
const urAnchor = "  noResults: 'Koi channel nahi mila',\n"

if (!s.includes(enAnchor) || !s.includes(urAnchor)) {
  console.error('PATCH FAILED: i18n anchors not found')
  process.exit(1)
}

s = s.replace(enAnchor, enAnchor + "  searchChannels: 'Search channels...',\n  select: 'Select',\n")
s = s.replace(urAnchor, urAnchor + "  searchChannels: 'Channel dhoondein...',\n  select: 'Chunein',\n")

fs.writeFileSync(p, s, 'utf8')
console.log('i18n keys added (en + ur)')
