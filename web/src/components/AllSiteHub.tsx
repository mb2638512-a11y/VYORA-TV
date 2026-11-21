import React, { useMemo, useState } from 'react'
import { Icon } from './Icon'
type Site = { id: string; title: string; url: string; domain: string; category: string }
const MOVIES_SHOWS_SITES: Site[] = [
  {
    "id": "cinezo.st",
    "title": "Cinezo",
    "url": "https://cinezo.st/",
    "domain": "cinezo.st",
    "category": "Movies & Shows"
  },
  {
    "id": "arrowtv.net",
    "title": "Arrow TV",
    "url": "https://arrowtv.net/",
    "domain": "arrowtv.net",
    "category": "Movies & Shows"
  },
  {
    "id": "vumeto.live",
    "title": "Vumeto",
    "url": "https://vumeto.live/",
    "domain": "vumeto.live",
    "category": "Movies & Shows"
  },
  {
    "id": "thugtv.st",
    "title": "Thug TV",
    "url": "https://thugtv.st/",
    "domain": "thugtv.st",
    "category": "Movies & Shows"
  },
  {
    "id": "1tube.org",
    "title": "1Tube",
    "url": "https://www.1tube.org/",
    "domain": "1tube.org",
    "category": "Movies & Shows"
  },
  {
    "id": "1shows.org",
    "title": "1Shows",
    "url": "https://www.1shows.org/",
    "domain": "1shows.org",
    "category": "Movies & Shows"
  },
  {
    "id": "1flex.org",
    "title": "1Flex",
    "url": "https://www.1flex.org/",
    "domain": "1flex.org",
    "category": "Movies & Shows"
  },
  {
    "id": "gaiaflix.xyz",
    "title": "GaiaFlix",
    "url": "https://gaiaflix.xyz/",
    "domain": "gaiaflix.xyz",
    "category": "Movies & Shows"
  },
  {
    "id": "redflix.club",
    "title": "RedFlix",
    "url": "https://redflix.club/",
    "domain": "redflix.club",
    "category": "Movies & Shows"
  },
  {
    "id": "ghostflix.st",
    "title": "GhostFlix",
    "url": "https://ghostflix.st/",
    "domain": "ghostflix.st",
    "category": "Movies & Shows"
  },
  {
    "id": "pantyflix.org",
    "title": "PantyFlix",
    "url": "https://pantyflix.org/",
    "domain": "pantyflix.org",
    "category": "Movies & Shows"
  },
  {
    "id": "shuttletv.pk",
    "title": "ShuttleTV",
    "url": "https://shuttletv.pk/",
    "domain": "shuttletv.pk",
    "category": "Movies & Shows"
  },
  {
    "id": "youshows.org",
    "title": "YouShows",
    "url": "https://youshows.org/",
    "domain": "youshows.org",
    "category": "Movies & Shows"
  },
  {
    "id": "primeshows.org",
    "title": "PrimeShows",
    "url": "https://primeshows.org/",
    "domain": "primeshows.org",
    "category": "Movies & Shows"
  },
  {
    "id": "willow.arlen.icu",
    "title": "Willow",
    "url": "https://willow.arlen.icu/",
    "domain": "willow.arlen.icu",
    "category": "Movies & Shows"
  },
  {
    "id": "vuflix.co",
    "title": "VuFlix",
    "url": "https://vuflix.co/",
    "domain": "vuflix.co",
    "category": "Movies & Shows"
  },
  {
    "id": "7reels.cc",
    "title": "7Reels",
    "url": "https://7reels.cc/",
    "domain": "7reels.cc",
    "category": "Movies & Shows"
  },
  {
    "id": "flixhub.aniflix.uno",
    "title": "FlixHub",
    "url": "https://flixhub.aniflix.uno/",
    "domain": "flixhub.aniflix.uno",
    "category": "Movies & Shows"
  },
  {
    "id": "cinehd.vc",
    "title": "CineHD",
    "url": "https://cinehd.vc/",
    "domain": "cinehd.vc",
    "category": "Movies & Shows"
  },
  {
    "id": "cinex.lol",
    "title": "CineX",
    "url": "https://cinex.lol/",
    "domain": "cinex.lol",
    "category": "Movies & Shows"
  },
  {
    "id": "zoryva.me",
    "title": "Zoryva",
    "url": "https://zoryva.me/",
    "domain": "zoryva.me",
    "category": "Movies & Shows"
  }
]
export const ALLSITEHUB_CATEGORIES = ['Movies & Shows'] as const
export const ALLSITEHUB_SITE_COUNT = MOVIES_SHOWS_SITES.length
export function AllSiteHub({ onOpenSite }: { onOpenSite: (url: string) => void }) {
 const [query,setQuery]=useState(''); const [category,setCategory]=useState('All'); const [sort,setSort]=useState<'az'|'za'>('az')
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return MOVIES_SHOWS_SITES.filter(site=>(category==='All'||site.category===category)&&(!q||site.title.toLowerCase().includes(q)||site.domain.toLowerCase().includes(q))).sort((a,b)=>sort==='az'?a.title.localeCompare(b.title):b.title.localeCompare(a.title))},[query,category,sort])
 return <section className="row allsitehub-section">
  <div className="home-filter-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><div><h2 className="row-title"><Icon name="grid" size={24}/> AllSiteHub <span className="muted">({MOVIES_SHOWS_SITES.length} sites)</span></h2><p className="muted">Built-in site directory · Category 1 of 8 received</p></div><span className="pill">Protected platform app</span></div>
  <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',margin:'14px 0'}}><input aria-label="Search AllSiteHub sites" className="input-text" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search 21 sites…" style={{flex:'1 1 240px',minWidth:180,padding:'11px 14px',borderRadius:10}}/><button className="btn btn-ghost" data-focusable onClick={()=>setSort(v=>v==='az'?'za':'az')}><Icon name="arrow-down-a-z" size={16}/> {sort==='az'?'A–Z':'Z–A'}</button></div>
  <div className="chips chips-scroll" role="tablist" aria-label="AllSiteHub categories">{['All',...ALLSITEHUB_CATEGORIES].map(cat=><button key={cat} className={'chip '+(category===cat?'active':'')} data-focusable role="tab" aria-selected={category===cat} onClick={()=>setCategory(cat)}>{cat} ({MOVIES_SHOWS_SITES.length})</button>)}</div>
  <div className="apps-grid" style={{marginTop:16}}>{filtered.map(site=><article key={site.id} className="app-card installed-app-card" data-focusable onClick={()=>onOpenSite(site.url)} role="button" tabIndex={0}><div className="app-card-badge" style={{background:'linear-gradient(135deg,#253b68,#111827)'}}><img src={'https://www.google.com/s2/favicons?domain='+site.domain+'&sz=128'} alt="" loading="lazy" style={{width:34,height:34,borderRadius:8}}/></div><div className="app-card-body"><div className="app-badge-tag">{site.category}</div><h3 className="app-card-title">{site.title}</h3><p className="app-card-desc" style={{fontSize:12,opacity:.7}}>{site.domain}</p></div><button className="btn btn-primary app-card-launch" data-focusable onClick={e=>{e.stopPropagation();onOpenSite(site.url)}}><Icon name="external-link" size={15}/> Open</button></article>)}</div>
  {filtered.length===0?<div className="empty"><Icon name="search" size={28}/><p>No matching sites found.</p></div>:null}<p className="muted" style={{marginTop:14,fontSize:12}}>Sites open through VYORA Browser. Availability and playback depend on each external provider.</p>
 </section>
}