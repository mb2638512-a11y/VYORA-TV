// Inspect the real result-link markup each provider returns, so the Go
// parsers can be written against verified selectors instead of guesses.
import fs from 'node:fs';

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const skip = /brave\.com|bravecdn|cdn\.search|static\.brave|duckduckgo\.com|bing\.com|microsoft|bing\.net|msn\.com|r\.bing\.com|th\.bing\.com|go\.microsoft|apis\.google|gstatic\.com/;

console.log('FILE:', file, 'len:', html.length);

const re = /<a\b([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>([\s\S]{0,300}?)<\/a>/g;
let m;
const seen = new Set();
let count = 0;
while ((m = re.exec(html)) !== null && count < 12) {
  const url = m[2].replace(/&amp;/g, '&');
  if (skip.test(url)) continue;
  if (seen.has(url)) continue;
  seen.add(url);
  const attrs = (m[1] + ' ' + m[3]).trim().replace(/\s+/g, ' ');
  const inner = m[4].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
  console.log(`\n[${count}] URL: ${url.slice(0, 100)}`);
  console.log(`    ATTRS: ${attrs.slice(0, 180)}`);
  console.log(`    TEXT: ${inner}`);
  count++;
}
if (count === 0) console.log('NO EXTERNAL RESULT LINDS FOUND');
