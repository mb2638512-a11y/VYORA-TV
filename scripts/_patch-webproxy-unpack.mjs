// One-off maintenance: replace webproxy.go's duplicated redirect unpacker with
// the shared UnwrapRedirect from search.go, and drop the "engine notice" bar
// (it existed only to explain the silent DuckDuckGo swap, which is gone).
import fs from 'node:fs';

const p = 'server-go/webproxy.go';
let s = fs.readFileSync(p, 'utf8');

// 1. Remove the unpackRedirectURL function entirely.
const fnStart = s.indexOf('// unpackRedirectURL extracts the destination target from search engine redirect URLs');
if (fnStart < 0) {
  console.log('unpackRedirectURL not found');
  process.exit(1);
}
// find the end of the function: the line "return rawURL\n}\n" after the fn start
const retIdx = s.indexOf('\treturn rawURL\n}\n', fnStart);
if (retIdx < 0) {
  console.log('end of unpackRedirectURL not found');
  process.exit(1);
}
const endIdx = retIdx + '\treturn rawURL\n}\n'.length;
s = s.slice(0, fnStart) + s.slice(endIdx);

// 2. Point the call site at the shared helper.
s = s.replace('targetURL = unpackRedirectURL(targetURL)', 'targetURL = UnwrapRedirect(targetURL)');

fs.writeFileSync(p, s, 'utf8');
console.log('unpackRedirectURL removed. Remaining refs:', (s.split('unpackRedirectURL').length - 1));
console.log('UnwrapRedirect refs:', s.split('UnwrapRedirect(').length - 1);
