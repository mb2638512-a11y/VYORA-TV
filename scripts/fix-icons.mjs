import fs from 'node:fs'

const p = 'E:/Vyora TV/web/src/App.tsx'
const lines = fs.readFileSync(p, 'utf8').split('\n')

// line number (1 based) -> replacement for the whole line
const fix = {
  579: `              <Icon name="globe" size={17} /> {t('global')}`,
  586: `              <Icon name="star" size={17} /> {t('favorites')}`,
  597: `              <Icon name="search" size={17} /> {t('search')}`,
  611: `              <Icon name="settings" size={19} />`,
  660: `              <h2 className="row-title"><Icon name="globe" size={22} /> {t('countries')}</h2>`,
  669: `                    <Icon name="globe" size={40} />`,
  688: `              <h2 className="row-title"><Icon name="film" size={22} /> {t('byCategory')}</h2>`,
  726: `                <h2 className="row-title"><Icon name="clock" size={22} /> {t('recent')}</h2>`,
  746: `              <Icon name="star" size={22} /> {t('favorites')} {favouriteChannels.length ? \`(\${favouriteChannels.length})\` : ''}`,
  749: `              <div className="empty"><Icon name="star" size={18} /> {t('favorites')} - {t('noResults')}</div>`,
  771: `              <Icon name="globe" size={22} /> {t('global')} <span className="muted">({globalTotal})</span>`,
  820: `                {groupByCountry ? t('groupByCountry') : t('flatList')}`,
  888: `                <div className="empty muted">{t('endOfList')}</div>`,
  907: `                : \`\${categoryName(settings.lang, (view as any).id)}\`}{' '}`,
  972: `              {numberEntry || '-'}`,
  978: `              <Icon name="close" size={16} /> {t('close')}`,
  995: `              <Icon name="play" size={16} /> {t('open')}`,
  1002: `              <Icon name="chevron-left" size={18} />`,
}

for (const [ln, text] of Object.entries(fix)) {
  lines[Number(ln) - 1] = text
}

let c = lines.join('\n')

// make sure the Icon component is imported
if (!c.includes("from './components/Icon'")) {
  c = c.replace(
    "import { TopBar } from './components/TopBar'",
    "import { TopBar } from './components/TopBar'\nimport { Icon } from './components/Icon'",
  )
}

// nothing non-ascii may survive (all of it was corruption)
const leftover = [...c.matchAll(/[^\x00-\x7F]+/g)].map((m) => JSON.stringify(m[0]))
fs.writeFileSync(p, c, 'utf8')
console.log('icons:', (c.match(/<Icon name=/g) || []).length)
console.log('leftover non-ascii:', leftover.length ? leftover.join(' ') : 'none')
