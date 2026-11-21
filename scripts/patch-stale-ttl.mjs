import fs from 'node:fs'

const file = 'E:/Vyora TV/server-go/proxy.go'
let src = fs.readFileSync(file, 'utf8')

const before = src
src = src.replace(
  /\treturn 2 \* time\.Second, 30 \* time\.Second\n\}/,
  '\treturn 2 * time.Second, 15 * time.Second\n}',
)
if (src === before) {
  console.error('PATCH FAILED: stale TTL not found')
  process.exit(1)
}
fs.writeFileSync(file, src, 'utf8')
console.log('stale TTL for live manifests: 30s -> 15s')
