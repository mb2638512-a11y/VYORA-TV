// One-off maintenance: remove the dead helper block from webproxy.go.
// The Google/YouTube helpers now live in search.go; the search-engine
// fallback helpers were deleted with the silent DuckDuckGo swap.
import fs from 'node:fs';

const p = 'server-go/webproxy.go';
let s = fs.readFileSync(p, 'utf8');

const startMark = '// hasSearchResults reports whether a search results page actually carries organic';
const endMarker = '\treturn ""\n}\n';

const si = s.indexOf(startMark);
if (si < 0) {
  console.log('START MARK NOT FOUND');
  process.exit(1);
}
const fnIdx = s.indexOf('func youtubeVideoID');
const ei = s.indexOf(endMarker, fnIdx);
if (ei < 0) {
  console.log('END MARK NOT FOUND');
  process.exit(1);
}
const endIdx = ei + endMarker.length;

const removed = s.slice(si, endIdx);
const kept = s.slice(0, si) + s.slice(endIdx);
fs.writeFileSync(p, kept, 'utf8');

console.log('Removed', removed.length, 'chars. File now', kept.length, 'chars.');
const names = ['hasSearchResults', 'isChallengePage', 'decodeHTMLBody', 'toYouTubeEmbed(', 'isYouTubeHost(', 'youtubeVideoID('];
for (const n of names) {
  const c = kept.split(n).length - 1;
  console.log('  refs to', n, '=', c);
}
