import fs from 'node:fs'

const proxyFile = 'E:/Vyora TV/server-go/proxy.go'
let src = fs.readFileSync(proxyFile, 'utf8')
const orig = src

function must(re, repl, label) {
  const before = src
  src = src.replace(re, repl)
  if (src === before) {
    console.error('PATCH FAILED: ' + label)
    process.exit(1)
  }
  console.log('patched: ' + label)
}

// 1) warmManifest -> warmManifestLane(..., fast, withSegments)
must(
  /func \(pm \*ProxyManager\) warmManifest\(targetURL, referer, ua, cid string, timeout time\.Duration\) bool \{\n\treturn pm\.warmManifestLane\(targetURL, referer, ua, cid, timeout, false\)\n\}/,
  `func (pm *ProxyManager) warmManifest(targetURL, referer, ua, cid string, timeout time.Duration) bool {
	return pm.warmManifestLane(targetURL, referer, ua, cid, timeout, false, true)
}`,
  'warmManifest signature',
)

must(
  /func \(pm \*ProxyManager\) warmManifestFast\(targetURL, referer, ua, cid string, timeout time\.Duration\) bool \{\n\treturn pm\.warmManifestLane\(targetURL, referer, ua, cid, timeout, true\)\n\}/,
  `func (pm *ProxyManager) warmManifestFast(targetURL, referer, ua, cid string, timeout time.Duration) bool {
	return pm.warmManifestLane(targetURL, referer, ua, cid, timeout, true, true)
}

// PrefetchLight warms only the manifest (cheap). The standby pre-warmer uses
// it so the bandwidth stays free for the segments the user is about to watch.
func (pm *ProxyManager) PrefetchLight(targetURL, referer, ua, cid string) (bool, int) {
	t0 := time.Now()
	ok := pm.warmManifestLane(targetURL, referer, ua, cid, 7000*time.Millisecond, false, false)
	return ok, int(time.Since(t0).Milliseconds())
}`,
  'warmManifestFast + PrefetchLight',
)

must(
  /func \(pm \*ProxyManager\) warmManifestLane\(targetURL, referer, ua, cid string, timeout time\.Duration, fast bool\) bool \{/,
  'func (pm *ProxyManager) warmManifestLane(targetURL, referer, ua, cid string, timeout time.Duration, fast bool, withSegments bool) bool {',
  'warmManifestLane signature',
)

// 2) only warm the child variant / segments when segments are wanted
must(
  /\t\} else if bytes\.Contains\(trimmedBytes, \[\]byte\("#EXTINF"\)\) \{\n\t\tsegCount := 0/,
  '\t} else if withSegments && bytes.Contains(trimmedBytes, []byte("#EXTINF")) {\n\t\tsegCount := 0',
  'segment warm guard',
)

must(
  /\t\t\t\t\tif subTarget != "" && subTarget != targetURL \{\n\t\t\t\t\t\tgo pm\.Prefetch\(subTarget, subRef, subUA, cid\)\n\t\t\t\t\t\}/,
  `\t\t\t\t\tif subTarget != "" && subTarget != targetURL {
						if withSegments {
							go pm.Prefetch(subTarget, subRef, subUA, cid)
						} else {
							go pm.PrefetchLight(subTarget, subRef, subUA, cid)
						}
					}`,
  'child variant warm lane',
)

fs.writeFileSync(proxyFile, src, 'utf8')

// 3) standby pre-warmer: refresh more often, manifest only, fewer channels
const warmFile = 'E:/Vyora TV/server-go/prewarmer.go'
let w = fs.readFileSync(warmFile, 'utf8')
const wOrig = w

w = w.replace(
  /\/\/ Continuous background refresh every 25 seconds \(HLS live segments rotate every 6-10s\)\n\t\tticker := time\.NewTicker\(25 \* time\.Second\)/,
  `// Continuous background refresh every 12 seconds (HLS live segments rotate
		// every 6-10s, so the warm copy has to stay close to the live edge)
		ticker := time.NewTicker(12 * time.Second)`,
)
w = w.replace(
  /\/\/ Pick top 36 channels from store\n\ttop := spw\.store\.GetTop\(36\)/,
  '// Pick the top 24 channels from store\n\ttop := spw.store.GetTop(24)',
)
w = w.replace(
  /_, _ = spw\.proxyMgr\.Prefetch\(targetURL, ref, ua, cid\)/,
  '// Manifest only: the media segments are warmed when the user points at\n\t\t\t// the channel, so the standby loop does not eat the bandwidth.\n\t\t\t_, _ = spw.proxyMgr.PrefetchLight(targetURL, ref, ua, cid)',
)
if (w === wOrig) {
  console.error('PATCH FAILED: prewarmer')
  process.exit(1)
}
fs.writeFileSync(warmFile, w, 'utf8')
console.log('patched: standby pre-warmer (12s, top 24, manifest only)')
