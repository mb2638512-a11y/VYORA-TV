import fs from 'node:fs'

const p = 'E:/Vyora TV/web/src/App.tsx'
const lines = fs.readFileSync(p, 'utf8').split('\n')
lines.forEach((l, i) => {
  if (l.includes('\uFFFD')) console.log(`${i + 1}: ${JSON.stringify(l)}`)
})
