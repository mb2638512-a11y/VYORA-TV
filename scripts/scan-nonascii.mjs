import fs from 'node:fs'

for (const p of [
  'E:/Vyora TV/web/src/App.tsx',
  'E:/Vyora TV/web/src/components/Cards.tsx',
  'E:/Vyora TV/web/src/components/PlayerOverlay.tsx',
  'E:/Vyora TV/web/src/components/SearchOverlay.tsx',
  'E:/Vyora TV/web/src/components/SettingsOverlay.tsx',
  'E:/Vyora TV/web/src/components/TopBar.tsx',
  'E:/Vyora TV/web/src/components/ChannelLogo.tsx',
  'E:/Vyora TV/web/src/lib/i18n.ts',
  'E:/Vyora TV/web/src/lib/api.ts',
  'E:/Vyora TV/web/src/lib/nav.ts',
  'E:/Vyora TV/web/src/lib/bridge.ts',
  'E:/Vyora TV/web/src/hooks/useChannelHealth.ts',
  'E:/Vyora TV/web/src/styles.css',
  'E:/Vyora TV/web/src/types.ts',
  'E:/Vyora TV/web/src/main.tsx',
]) {
  let c
  try {
    c = fs.readFileSync(p, 'utf8')
  } catch {
    continue
  }
  const seqs = new Map()
  for (const m of c.matchAll(/[^\x00-\x7F]+/g)) {
    const s = m[0]
    seqs.set(s, (seqs.get(s) || 0) + 1)
  }
  if (seqs.size) {
    console.log('--- ' + p.split('/').slice(-2).join('/'))
    for (const [s, n] of seqs) {
      console.log(`   ${JSON.stringify(s)} x${n}  [${[...s].map((x) => x.codePointAt(0).toString(16)).join(' ')}]`)
    }
  }
}
