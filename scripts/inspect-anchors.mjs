// Dump the structure of a saved provider HTML file: which classes wrap the
// result links, so the Go parsers can be written against verified markup.
import fs from 'node:fs';

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const skip = /brave\.com|bravecdn|cdn\.search|static\.brave|duckduckgo\.com|bing\.com|microsoft|bing\.net|msn\.com|r\.bing\.com|th\.bing\.com|google\.com|gstatic|youtube\.com|ytimg|ggpht/;

const anchorRe = /<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/g;
let m;
const shown = new Set();
let count = 0;
while ((m = anchorRe.exec(html)) !== null && count < 14) {
  const attrs = m[1];
  const hrefM = attrs.match(/\bhref="([^"]*)"/);
  if (!hrefM) continue;
  let href = hrefM[1].replace(/&amp;/g, '&');
  if (href.startsWith('//')) href = 'https:' + href;
  if (!/^https?:/.test(href)) continue;
  if (skip.test(href)) continue;
  const clsM = attrs.match(/\bclass="([^"]*)"/);
  const cls = clsM ? clsM[1] : '(none)';
  const text = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const key = cls;
  const dup = shown.has(href);
  shown.add(href);
  console.log(`\n[${count}] href: ${href.slice(0, 95)}`);
  console.log(`    class: ${cls}`);
  console.log(`    text: ${text}`);
  if (dup) console.log('    (duplicate href)');
  count++;
}
if (count === 0) console.log('NO EXTERNAL ANCHORS');
