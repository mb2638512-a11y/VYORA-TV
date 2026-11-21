import fs from 'node:fs'

const p = 'E:/Vyora TV/web/src/App.tsx'
const c = fs.readFileSync(p, 'utf8')
const i = c.indexOf('row-title">')
const slice = c.slice(i, i + 40)
console.log('slice   :', JSON.stringify(slice))
console.log('codepoint:', [...slice].map((ch) => ch.codePointAt(0).toString(16)).join(' '))
console.log('double encoded marker present:', c.includes('ðŸ'))
console.log('real emoji present:', c.includes('\u{1F30D}'), c.includes('\u{1F50D}'))
