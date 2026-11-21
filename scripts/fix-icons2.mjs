import fs from 'node:fs'

/* Search overlay */
{
  const p = 'E:/Vyora TV/web/src/components/SearchOverlay.tsx'
  let c = fs.readFileSync(p, 'utf8')
  c = c.replace(
    "\u{1F50D} {t('search')}",
    '<Icon name="search" size={22} /> {t(\'search\')}',
  )
  c = c.replace(
    "\u{2715} {t('close')}",
    '<Icon name="close" size={16} /> {t(\'close\')}',
  )
  c = c.replace('\u{232B}', '<Icon name="chevron-left" size={20} />')
  c = c.replace(/\u{2026}/g, '...')
  c = c.replace(/\u{201C}/g, '"').replace(/\u{201D}/g, '"')
  if (!c.includes("from './Icon'")) {
    c = c.replace(
      "import { ChannelLogo } from './ChannelLogo'",
      "import { ChannelLogo } from './ChannelLogo'\nimport { Icon } from './Icon'",
    )
  }
  fs.writeFileSync(p, c, 'utf8')
  console.log('SearchOverlay icons:', (c.match(/<Icon name=/g) || []).length)
}

/* Settings overlay */
{
  const p = 'E:/Vyora TV/web/src/components/SettingsOverlay.tsx'
  let c = fs.readFileSync(p, 'utf8')
  c = c.replace('\u{2699}', '<Icon name="settings" size={24} />')
  c = c.replace(
    "\u{2715} {t('close')}",
    '<Icon name="close" size={16} /> {t(\'close\')}',
  )
  c = c.replace(
    "\u{2B07} Download Android TV APK",
    '<Icon name="download" size={17} /> Download Android TV APK',
  )
  c = c.replace(/\u{2022}/g, '|')
  c = c.replace(/\u{2014}/g, '-')
  if (!c.includes("from './Icon'")) {
    c = c.replace(
      "import { categoryName } from '../lib/i18n'",
      "import { categoryName } from '../lib/i18n'\nimport { Icon } from './Icon'",
    )
  }
  fs.writeFileSync(p, c, 'utf8')
  console.log('SettingsOverlay icons:', (c.match(/<Icon name=/g) || []).length)
}

/* report leftovers everywhere */
for (const p of [
  'E:/Vyora TV/web/src/App.tsx',
  'E:/Vyora TV/web/src/components/SearchOverlay.tsx',
  'E:/Vyora TV/web/src/components/SettingsOverlay.tsx',
  'E:/Vyora TV/web/src/components/Cards.tsx',
  'E:/Vyora TV/web/src/components/PlayerOverlay.tsx',
]) {
  const c = fs.readFileSync(p, 'utf8')
  const bad = [...c.matchAll(/[^\x00-\x7F]+/g)].map((m) => JSON.stringify(m[0]))
  console.log(p.split('/').pop(), '->', bad.length ? bad.join(' ') : 'clean')
}
