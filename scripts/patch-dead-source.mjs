import fs from 'node:fs'

const file = 'E:/Vyora TV/server-go/proxy.go'
let src = fs.readFileSync(file, 'utf8')
const before = src

src = src.replace(
  /\trewritten := pm\.RewriteHLSPlaylist\(string\(trimmedBytes\), targetURL, referer, ua, cid\)\n\tif pruned, ok := pm\.pruneMasterVariants\(rewritten, referer, ua\); ok \{\n\t\trewritten = pruned\n\t\}/,
  `\trewritten := pm.RewriteHLSPlaylist(string(trimmedBytes), targetURL, referer, ua, cid)
	pruned, variantsOK := pm.pruneMasterVariants(rewritten, referer, ua)
	if !variantsOK {
		// Every variant of this master playlist is dead -> the source itself
		// is dead. The race then moves on to the next source immediately.
		return false
	}
	rewritten = pruned`,
)
if (src === before) {
  console.error('PATCH FAILED: warm path dead-variant handling')
  process.exit(1)
}
fs.writeFileSync(file, src, 'utf8')
console.log('patched: warm path treats an all-dead master as a dead source')
