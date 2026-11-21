import fs from 'node:fs';
import path from 'node:path';

const sources = [
  { name: 'Dearbulut Online', url: 'https://dearbulut.github.io/iptv/playlists/online.m3u' },
  { name: 'Dearbulut Best', url: 'https://dearbulut.github.io/iptv/playlists/best.m3u' },
  { name: 'AdeelWajid Complete', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlist.m3u' },
  { name: 'AdeelWajid Pakistan', url: 'https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlists/countries/pk.m3u' },
  { name: 'WizakorHD Top', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-top.m3u' },
  { name: 'WizakorHD Complete', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist.m3u' },
  { name: 'WizakorHD Hindi', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-hindi.m3u' },
  { name: 'WizakorHD English Intl', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-english-intl.m3u' },
  { name: 'WizakorHD English India', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-english-india.m3u' },
  { name: 'WizakorHD Anime', url: 'https://raw.githubusercontent.com/wizakorhd/iptv/main/playlist-anime.m3u' },
];

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#EXTINF:')) {
      const tvgIdMatch = trimmed.match(/tvg-id="([^"]*)"/i);
      const tvgNameMatch = trimmed.match(/tvg-name="([^"]*)"/i);
      const tvgLogoMatch = trimmed.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = trimmed.match(/group-title="([^"]*)"/i);
      const commaIdx = trimmed.lastIndexOf(',');
      const rawName = commaIdx !== -1 ? trimmed.slice(commaIdx + 1).trim() : '';

      current = {
        tvgId: tvgIdMatch ? tvgIdMatch[1] : '',
        tvgName: tvgNameMatch ? tvgNameMatch[1] : '',
        name: rawName || (tvgNameMatch ? tvgNameMatch[1] : 'Unknown'),
        logo: tvgLogoMatch ? tvgLogoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : '',
        url: '',
      };
    } else if (!trimmed.startsWith('#') && current) {
      current.url = trimmed;
      items.push(current);
      current = null;
    }
  }

  return items;
}

async function main() {
  console.log('Downloading and analyzing playlists...');
  const overallChannels = new Map(); // id or name -> stream URLs
  const overallStreams = new Set();
  const summary = [];

  for (const src of sources) {
    try {
      console.log(`Fetching ${src.name}...`);
      const res = await fetch(src.url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        console.log(`Failed to fetch ${src.name}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      const items = parseM3U(text);

      let m3u8Count = 0;
      let otherCount = 0;

      for (const it of items) {
        overallStreams.add(it.url);
        const key = (it.tvgId || it.name).toLowerCase().trim();
        if (!overallChannels.has(key)) {
          overallChannels.set(key, []);
        }
        overallChannels.get(key).push(it);

        if (it.url.includes('.m3u8')) m3u8Count++;
        else otherCount++;
      }

      summary.push({
        source: src.name,
        totalItems: items.length,
        hls: m3u8Count,
        other: otherCount,
      });

      console.log(`-> ${src.name}: ${items.length} streams (HLS: ${m3u8Count}, Other: ${otherCount})`);
    } catch (err) {
      console.log(`Error on ${src.name}: ${err.message}`);
    }
  }

  console.log('\n==================================================');
  console.log('               PLAYLIST SUMMARY');
  console.log('==================================================');
  console.table(summary);
  console.log(`Total Unique Stream URLs: ${overallStreams.size}`);
  console.log(`Total Unique Channel Keys: ${overallChannels.size}`);
  console.log('==================================================\n');

  // Also check Dearbulut health.json
  try {
    const hRes = await fetch('https://dearbulut.github.io/iptv/api/v1/health.json', { signal: AbortSignal.timeout(15000) });
    if (hRes.ok) {
      const hData = await hRes.json();
      console.log('Dearbulut Health API Stats:', {
        total: hData.total_channels || hData.total || (Array.isArray(hData) ? hData.length : typeof hData),
        sample: typeof hData === 'object' ? Object.keys(hData).slice(0, 10) : 'not object'
      });
    }
  } catch (e) {
    console.log('Dearbulut Health API error:', e.message);
  }

  // Also check AdeelWajid validation_stats.json
  try {
    const vRes = await fetch('https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/validation_stats.json', { signal: AbortSignal.timeout(15000) });
    if (vRes.ok) {
      const vData = await vRes.json();
      console.log('AdeelWajid Validation Stats:', vData);
    }
  } catch (e) {
    console.log('AdeelWajid stats error:', e.message);
  }
}

main();
