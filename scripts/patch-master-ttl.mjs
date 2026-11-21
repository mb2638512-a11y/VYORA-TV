import fs from 'node:fs'

const file = 'E:/Vyora TV/server-go/proxy.go'
let src = fs.readFileSync(file, 'utf8')
const before = src

// Master playlists point at child variants whose URLs are often signed and
// expire. Caching them for 30 minutes produced 404s on the child (the
// "Attempt 4/2" loop). Keep them short and let the standby/hover warm keep
// the copy fresh.
src = src.replace(
  /\tif bytes\.Contains\(body, \[\]byte\("#EXT-X-STREAM-INF"\)\) \{\n\t\treturn 30 \* time\.Minute, 30 \* time\.Minute\n\t\}/,
  `\tif bytes.Contains(body, []byte("#EXT-X-STREAM-INF")) {
		// Master playlists: the child variant URLs can be signed and expire,
		// so the copy must stay young.
		return 60 * time.Second, 3 * time.Minute
	}`,
)
if (src === before) {
  console.error('PATCH FAILED: master TTL')
  process.exit(1)
}
fs.writeFileSync(file, src, 'utf8')
console.log('patched: master playlist TTL 30min -> 60s (stale 3min)')
