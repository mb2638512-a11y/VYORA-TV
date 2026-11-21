import fs from 'node:fs';

async function downloadSample(url, name) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 VyoraTV/1.0' } });
    const text = await res.text();
    const lines = text.split('\n').slice(0, 30);
    console.log(`=== ${name} (${text.length} chars) ===`);
    console.log(lines.join('\n'));
  } catch (e) {
    console.log(`Failed ${name}:`, e.message);
  }
}

async function run() {
  await downloadSample('https://shahrukhalid.github.io/nexonic-iptv/playlists/vod/movies.m3u', 'Nexonic Movies');
  await downloadSample('https://shahrukhalid.github.io/nexonic-iptv/playlists/vod/series.m3u', 'Nexonic Series');
  await downloadSample('https://raw.githubusercontent.com/onlinem3u/publicdomainm3u/main/movies.m3u', 'PublicDomain Movies');
}

run();
