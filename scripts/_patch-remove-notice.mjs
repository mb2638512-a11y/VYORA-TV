// One-off: remove the "honest engine notice" bar from the injected script.
// It only existed to explain the silent DuckDuckGo swap, which is gone.
import fs from 'node:fs';

const p = 'server-go/webproxy.go';
let s = fs.readFileSync(p, 'utf8');

const startMark = '\t\t\t// 6. Honest engine notice.';
const endMark = '\t\t\t})();\n\t\t})();\n';
const si = s.indexOf(startMark);
if (si < 0) {
  console.log('notice block start not found');
  process.exit(1);
}
const ei = s.indexOf(endMark, si);
if (ei < 0) {
  console.log('notice block end not found');
  process.exit(1);
}
const endIdx = ei + '\t\t\t})();\n'.length;
const removed = s.slice(si, endIdx);
const kept = s.slice(0, si) + s.slice(endIdx);
fs.writeFileSync(p, kept, 'utf8');
console.log('Removed', removed.length, 'chars of notice-bar JS.');
console.log('remaining vyora_engine refs:', kept.split('vyora_engine').length - 1);
console.log('remaining engine-notice refs:', kept.split('engine-notice').length - 1);
