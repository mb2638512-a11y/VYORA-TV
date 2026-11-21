import fs from 'node:fs'

const file = 'E:/Vyora TV/server-go/proxy.go'
let src = fs.readFileSync(file, 'utf8')

function must(re, repl, label) {
  const before = src
  src = src.replace(re, repl)
  if (src === before) {
    console.error('PATCH FAILED: ' + label)
    process.exit(1)
  }
  console.log('patched: ' + label)
}

// 1) serve path (line ~408): prune the dead variants before serving
must(
  /\t\tif err == nil && \(bytes\.Contains\(trimmedBytes, \[\]byte\("#EXTM3U"\)\) \|\| bytes\.Contains\(trimmedBytes, \[\]byte\("#EXT-X-"\)\)\) \{\n\t\t\trewritten := pm\.RewriteHLSPlaylist\(string\(trimmedBytes\), targetURL, referer, ua, cid\)\n\t\t\trewrittenBytes := \[\]byte\(rewritten\)/,
  `\t\tif err == nil && (bytes.Contains(trimmedBytes, []byte("#EXTM3U")) || bytes.Contains(trimmedBytes, []byte("#EXT-X-"))) {
			rewritten := pm.RewriteHLSPlaylist(string(trimmedBytes), targetURL, referer, ua, cid)

			// A master playlist often advertises variants that are already
			// dead. Remove them here so the player does not waste attempts
			// on 404s - and fail over to the next source right away when
			// every variant is dead.
			if pruned, ok := pm.pruneMasterVariants(rewritten, referer, ua); ok {
				rewritten = pruned
			} else {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "all-variants-dead",
				})
				return
			}

			rewrittenBytes := []byte(rewritten)`,
  'serve path variant pruning',
)

// 2) warm path (line ~843): store a pre-pruned manifest
must(
  /\trewritten := pm\.RewriteHLSPlaylist\(string\(trimmedBytes\), targetURL, referer, ua, cid\)\n\trewrittenBytes := \[\]byte\(rewritten\)\n\n\tfreshTTL, staleTTL := manifestTTLs\(trimmedBytes\)/,
  `\trewritten := pm.RewriteHLSPlaylist(string(trimmedBytes), targetURL, referer, ua, cid)
	if pruned, ok := pm.pruneMasterVariants(rewritten, referer, ua); ok {
		rewritten = pruned
	}
	rewrittenBytes := []byte(rewritten)

	freshTTL, staleTTL := manifestTTLs(trimmedBytes)`,
  'warm path variant pruning',
)

fs.writeFileSync(file, src, 'utf8')
console.log('done')
