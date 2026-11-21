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

const ANIME_SITES: Site[] = [
  { id: "yenime.net", title: "Yenime", url: "https://yenime.net/", domain: "yenime.net", category: 'Anime' },
  { id: "enma.lol", title: "Enma", url: "https://www.enma.lol/home", domain: "enma.lol", category: 'Anime' },
  { id: "animetsu.site", title: "Animetsu", url: "https://animetsu.site/", domain: "animetsu.site", category: 'Anime' },
  { id: "anishows.org", title: "AniShows", url: "https://anishows.org/home", domain: "anishows.org", category: 'Anime' },
  { id: "kaa.lt", title: "KAA", url: "https://kaa.lt/", domain: "kaa.lt", category: 'Anime' },
  { id: "animetvplus.xyz", title: "AnimeTV Plus", url: "https://animetvplus.xyz/", domain: "animetvplus.xyz", category: 'Anime' },
  { id: "anikototv.bz", title: "Anikoto TV", url: "https://anikototv.bz/", domain: "anikototv.bz", category: 'Anime' },
  { id: "justanime.to", title: "JustAnime", url: "https://justanime.to/", domain: "justanime.to", category: 'Anime' },
  { id: "hianime.fm", title: "HiAnime", url: "https://hianime.fm/home", domain: "hianime.fm", category: 'Anime' },
  { id: "flixani.studio", title: "FlixAni", url: "https://flixani.studio/", domain: "flixani.studio", category: 'Anime' },
  { id: "animesalt.cx", title: "AnimeSalt", url: "https://animesalt.cx/", domain: "animesalt.cx", category: 'Anime' },
  { id: "aniclover.cc", title: "AniClover", url: "https://aniclover.cc/", domain: "aniclover.cc", category: 'Anime' },
  { id: "senpaiflix.fun", title: "SenpaiFlix", url: "https://senpaiflix.fun/", domain: "senpaiflix.fun", category: 'Anime' },
  { id: "watchanimez.me", title: "WatchAnimez", url: "https://watchanimez.me/", domain: "watchanimez.me", category: 'Anime' },
  { id: "reanime.cz", title: "ReAnime", url: "https://reanime.cz/", domain: "reanime.cz", category: 'Anime' },
  { id: "aniwaves.tv", title: "AniWaves", url: "https://aniwaves.tv/home", domain: "aniwaves.tv", category: 'Anime' },
  { id: "animerulz.co.in", title: "AnimeRulz", url: "https://animerulz.co.in/", domain: "animerulz.co.in", category: 'Anime' },
  { id: "dub.animeplay.icu", title: "AnimePlay Dub", url: "https://dub.animeplay.icu/", domain: "dub.animeplay.icu", category: 'Anime' },
  { id: "otanox.online", title: "Otanox", url: "https://otanox.online/", domain: "otanox.online", category: 'Anime' },
  { id: "animex.one", title: "AnimeX", url: "https://animex.one/home", domain: "animex.one", category: 'Anime' },
  { id: "anitaku.io", title: "AniTaku", url: "https://anitaku.io/browse/", domain: "anitaku.io", category: 'Anime' },
]

const MANGA_SITES: Site[] = [
  { id: "mangaball.com", title: "MangaBall", url: "https://mangaball.com/", domain: "mangaball.com", category: 'Manga' },
  { id: "comick.dev", title: "Comick", url: "https://comick.dev/", domain: "comick.dev", category: 'Manga' },
  { id: "qtoon.org", title: "QToon", url: "https://qtoon.org/", domain: "qtoon.org", category: 'Manga' },
  { id: "weebcentral.com", title: "Weeb Central", url: "https://weebcentral.com/", domain: "weebcentral.com", category: 'Manga' },
  { id: "kingofshojo.com", title: "King of Shojo", url: "https://kingofshojo.com/", domain: "kingofshojo.com", category: 'Manga' },
  { id: "m.webtoons.com", title: "WEBTOON", url: "https://m.webtoons.com/en/?webtoon-platform-redirect=true", domain: "m.webtoons.com", category: 'Manga' },
  { id: "anireads.cc", title: "AniReads", url: "https://anireads.cc/", domain: "anireads.cc", category: 'Manga' },
]

const LIVE_TV_SPORTS_SITES: Site[] = [
  { id: "cinevid.sbs", title: "Cinevid", url: "https://cinevid.sbs/", domain: "cinevid.sbs", category: 'Live TV & Sports' },
  { id: "fancode.com", title: "FanCode", url: "https://www.fancode.com/", domain: "fancode.com", category: 'Live TV & Sports' },
  { id: "ondemand.st", title: "OnDemand", url: "https://ondemand.st/", domain: "ondemand.st", category: 'Live TV & Sports' },
  { id: "streameast.cool", title: "StreamEast", url: "https://streameast.cool/", domain: "streameast.cool", category: 'Live TV & Sports' },
  { id: "bhoomtv.net", title: "Bhoom TV", url: "https://bhoomtv.net/", domain: "bhoomtv.net", category: 'Live TV & Sports' },
  { id: "stmify.com", title: "Stmify", url: "https://stmify.com/", domain: "stmify.com", category: 'Live TV & Sports' },
  { id: "famelack.com", title: "Famelack", url: "https://famelack.com/", domain: "famelack.com", category: 'Live TV & Sports' },
  { id: "publiciptv.com", title: "Public IPTV", url: "https://publiciptv.com/?country=US", domain: "publiciptv.com", category: 'Live TV & Sports' },
  { id: "sportplus.watch", title: "SportPlus", url: "https://en97.sportplus.watch/", domain: "sportplus.watch", category: 'Live TV & Sports' },
  { id: "streamking.cx", title: "StreamKing", url: "https://streamking.cx/", domain: "streamking.cx", category: 'Live TV & Sports' },
]
const GAMES_SITES: Site[] = [
  { id: "crazygames.com", title: "CrazyGames", url: "https://www.crazygames.com/", domain: "crazygames.com", category: 'Games' },
]
const CARTOONS_SITES: Site[] = [
  { id: "kartoons.me", title: "Kartoons", url: "https://kartoons.me/", domain: "kartoons.me", category: 'Cartoons' },
]
const ALL_IN_ONE_SITES: Site[] = [
  { id: "dmasti.pk", title: "DMasti", url: "https://www.dmasti.pk/", domain: "dmasti.pk", category: 'All in One' },
]
const ALL_SITES: Site[] = [...MOVIES_SHOWS_SITES, ...ANIME_SITES, ...MANGA_SITES, ...LIVE_TV_SPORTS_SITES, ...GAMES_SITES, ...CARTOONS_SITES, ...ALL_IN_ONE_SITES]
export const ALLSITEHUB_CATEGORIES = ['Movies & Shows', 'Anime', 'Manga', 'Live TV & Sports', 'Games', 'Cartoons', 'All in One'] as const
export const ALLSITEHUB_SITE_COUNT = ALL_SITES.length
export function AllSiteHub({ onOpenSite }: { onOpenSite: (url: string) => void }) {
 const [query,setQuery]=useState(''); const [category,setCategory]=useState('All'); const [sort,setSort]=useState<'az'|'za'>('az')
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return ALL_SITES.filter(site=>(category==='All'||site.category===category)&&(!q||site.title.toLowerCase().includes(q)||site.domain.toLowerCase().includes(q))).sort((a,b)=>sort==='az'?a.title.localeCompare(b.title):b.title.localeCompare(a.title))},[query,category,sort])
 return <section className="row allsitehub-section">
  <div className="home-filter-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><div><h2 className="row-title"><Icon name="grid" size={24}/> AllSiteHub <span className="muted">({ALL_SITES.length} sites)</span></h2><p className="muted">Built-in site directory · Categories {ALLSITEHUB_CATEGORIES.length} of 8 received</p></div><span className="pill">Protected platform app</span></div>
  <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',margin:'14px 0'}}><input aria-label="Search AllSiteHub sites" className="input-text" value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search all ${ALLSITEHUB_SITE_COUNT} sites…`} style={{flex:'1 1 240px',minWidth:180,padding:'11px 14px',borderRadius:10}}/><button className="btn btn-ghost" data-focusable onClick={()=>setSort(v=>v==='az'?'za':'az')}><Icon name="arrow-down-a-z" size={16}/> {sort==='az'?'A–Z':'Z–A'}</button></div>
  <div className="chips chips-scroll" role="tablist" aria-label="AllSiteHub categories">{['All',...ALLSITEHUB_CATEGORIES].map(cat=>{const count=cat==='All'?ALL_SITES.length:ALL_SITES.filter(site=>site.category===cat).length;return <button key={cat} className={'chip '+(category===cat?'active':'')} data-focusable role="tab" aria-selected={category===cat} onClick={()=>setCategory(cat)}>{cat} ({count})</button>})}</div>
  <div className="apps-grid" style={{marginTop:16}}>{filtered.map(site=><article key={site.id} className="app-card installed-app-card" data-focusable onClick={()=>onOpenSite(site.url)} role="button" tabIndex={0}><div className="app-card-badge" style={{background:'linear-gradient(135deg,#253b68,#111827)'}}><img src={'https://www.google.com/s2/favicons?domain='+site.domain+'&sz=128'} alt="" loading="lazy" style={{width:34,height:34,borderRadius:8}}/></div><div className="app-card-body"><div className="app-badge-tag">{site.category}</div><h3 className="app-card-title">{site.title}</h3><p className="app-card-desc" style={{fontSize:12,opacity:.7}}>{site.domain}</p></div><button className="btn btn-primary app-card-launch" data-focusable onClick={e=>{e.stopPropagation();onOpenSite(site.url)}}><Icon name="external-link" size={15}/> Open</button></article>)}</div>
  {filtered.length===0?<div className="empty"><Icon name="search" size={28}/><p>No matching sites found.</p></div>:null}<p className="muted" style={{marginTop:14,fontSize:12}}>Sites open through VYORA Browser. Availability and playback depend on each external provider.</p>
 </section>
}