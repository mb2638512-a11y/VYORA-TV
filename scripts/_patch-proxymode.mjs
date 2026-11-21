// Reset proxyMode on every navigation so each new URL gets a fresh direct
// attempt, and let the frame-block detector re-trigger the proxy fallback.
import fs from 'node:fs';

const p = 'web/src/components/ChromiumBrowser.tsx';
let s = fs.readFileSync(p, 'utf8');

const edits = [
  [
    '        engine: initialEngine,\n        proxyMode: true,',
    '        engine: initialEngine,\n        proxyMode: false,',
  ],
  [
    '            url: normalized,\n            displayUrl: normalized,\n            frameUrl: normalized,\n            title: domainTitle,',
    '            url: normalized,\n            displayUrl: normalized,\n            frameUrl: normalized,\n            proxyMode: false,\n            title: domainTitle,',
  ],
  [
    '              url: prevUrl,\n              displayUrl: prevUrl,\n              frameUrl: prevUrl,',
    '              url: prevUrl,\n              displayUrl: prevUrl,\n              frameUrl: prevUrl,\n              proxyMode: false,',
  ],
  [
    '              url: nextUrl,\n              displayUrl: nextUrl,\n              frameUrl: nextUrl,',
    '              url: nextUrl,\n              displayUrl: nextUrl,\n              frameUrl: nextUrl,\n              proxyMode: false,',
  ],
  [
    '          ? { ...t, frameUrl: t.url, isLoading: true, navKey: (t.navKey || 0) + 1 }',
    '          ? { ...t, frameUrl: t.url, proxyMode: false, isLoading: true, navKey: (t.navKey || 0) + 1 }',
  ],
  ['      engine,\n      proxyMode: true,', '      engine,\n      proxyMode: false,'],
  [
    "          engine: settings.defaultEngine || 'google',\n          proxyMode: true,",
    "          engine: settings.defaultEngine || 'google',\n          proxyMode: false,",
  ],
];

let applied = 0;
for (const [from, to] of edits) {
  if (!s.includes(from)) {
    console.log('NOT FOUND:', JSON.stringify(from.slice(0, 60)));
    continue;
  }
  s = s.replace(from, to);
  applied++;
}
fs.writeFileSync(p, s, 'utf8');
console.log('Applied', applied, 'of', edits.length, 'edits.');
console.log('proxyMode:false =', (s.match(/proxyMode: false/g) || []).length);
console.log('proxyMode:true  =', (s.match(/proxyMode: true/g) || []).length);
