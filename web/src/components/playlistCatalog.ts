export type CuratedPlaylist = { id: string; name: string; group: 'TV Shows' | 'Movies' | 'Live TV' | 'TV Category' | 'Country'; url: string }
const TMDB = 'https://aymrgknetzpucldhpkwm.supabase.co/storage/v1/object/public/tmdb/'
const IPTV = 'https://iptv-org.github.io/iptv/'
export const CURATED_PLAYLISTS: CuratedPlaylist[] = [
  { id: 'trending-series', name: 'Trending TV Shows', group: 'TV Shows', url: TMDB + 'trending-series.m3u' },
  { id: 'top-movies', name: 'Top IMDb Movies 2024–2025', group: 'Movies', url: TMDB + 'top-movies.m3u' },
  ...[['action','Action'],['adventure','Adventure'],['animation','Animation'],['comedy','Comedy'],['crime','Crime'],['documentary','Documentary'],['drama','Drama'],['family','Family'],['fantasy','Fantasy'],['history','History'],['horror','Horror'],['music','Music'],['mystery','Mystery'],['romance','Romance'],['science-fiction','Science Fiction'],['tv','TV'],['thriller','Thriller'],['war','War'],['western','Western']].map(([id,label]) => ({ id:'movie-'+id, name:label+' Movies', group:'Movies' as const, url:TMDB+id+'-movies.m3u' })),
  { id:'public-all', name:'All Public TV Channels', group:'Live TV', url:IPTV+'index.m3u' },
  ...[['entertainment','Entertainment'],['movies','Movies'],['news','News'],['sports','Sports'],['documentary','Documentary'],['music','Music']].map(([id,label]) => ({ id:'tv-'+id, name:label+' TV', group:'TV Category' as const, url:IPTV+'categories/'+id+'.m3u' })),
  ...[['us','United States'],['uk','United Kingdom'],['ca','Canada'],['au','Australia'],['vn','Vietnam']].map(([id,label]) => ({ id:'country-'+id, name:label+' TV', group:'Country' as const, url:IPTV+'countries/'+id+'.m3u' })),
]
