import fs from 'node:fs';

const urls = [
  { name: 'Dearbulut Online', url: 'https://dearbulut.github.io/iptv/playlists/online.m3u' },
  { name: 'Dearbulut Best', url: 'https://dearbulut.github.io/iptv/playlists/best.m3u' },
  { name: 'Dearbulut Health API', url: 'https://dearbulut.github.io/iptv/api/v1/health.json' },
  { name: 'AdeelWajid Playlist', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlist.m3u' },
  { name: 'AdeelWajid PK', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlists/countries/pk.m3u' },
  { name: 'AdeelWajid Stats', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/validation_stats.json' },
  { name: 'WizakorHD Top', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-top.m3u' },
  { name: 'WizakorHD Complete', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist.m3u' },
  { name: 'WizakorHD Hindi', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-hindi.m3u' },
  { name: 'WizakorHD English Intl', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-english-intl.m3u' },
  { name: 'WizakorHD English India', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-english-india.m3u' },
  { name: 'WizakorHD Anime', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-anime.m3u' },
];

async function run() {
  console.log('Inspecting URLs...');
  for (const item of urls) {
    try {
      const res = await fetch(item.url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      const len = res.headers.get('content-length');
      const mb = len ? (parseInt(len, 10) / (1024 * 1024)).toFixed(2) + ' MB' : 'unknown';
      console.log(`[${res.status}] ${item.name} | Size: ${mb} | URL: ${item.url}`);
    } catch (e) {
      console.log(`[FAIL] ${item.name} | ${e.message} | URL: ${item.url}`);
    }
  }
}

run();
