import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'data', 'raw', 'playlists');
fs.mkdirSync(OUT, { recursive: true });

const files = [
  { name: 'dearbulut_online.m3u', url: 'https://dearbulut.github.io/iptv/playlists/online.m3u' },
  { name: 'dearbulut_best.m3u', url: 'https://dearbulut.github.io/iptv/playlists/best.m3u' },
  { name: 'adeelwajid_complete.m3u', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlist.m3u' },
  { name: 'adeelwajid_pk.m3u', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlists/countries/pk.m3u' },
  { name: 'wizakorhd_top.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-top.m3u' },
  { name: 'wizakorhd_complete.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist.m3u' },
  { name: 'wizakorhd_hindi.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-hindi.m3u' },
  { name: 'wizakorhd_english_intl.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-english-intl.m3u' },
  { name: 'wizakorhd_english_india.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-english-india.m3u' },
  { name: 'wizakorhd_anime.m3u', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-anime.m3u' },
];

async function download(item) {
  const dest = path.join(OUT, item.name);
  console.log(`[START] ${item.name} from ${item.url}`);
  try {
    const res = await fetch(item.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) {
      console.log(`[FAIL] ${item.name}: HTTP ${res.status}`);
      return;
    }
    const fileStream = fs.createWriteStream(dest, { flags: 'w' });
    await finished(Readable.fromWeb(res.body).pipe(fileStream));
    const stat = fs.statSync(dest);
    console.log(`[DONE] ${item.name}: ${(stat.size / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.log(`[ERR] ${item.name}: ${err.message}`);
  }
}

async function main() {
  for (const f of files) {
    await download(f);
  }
  console.log('\nAll downloads complete!');
}

main();
