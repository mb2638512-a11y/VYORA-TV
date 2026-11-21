// Fetch each engine exactly like the Go proxy does, save the HTML, and report
// which marker fired the fallback decision.
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';

const pick = (url) => (url.startsWith('https:') ? https : http);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TARGETS = {
  google: 'https://www.google.com/search?igu=1&q=youtube',
  google_socs: 'https://www.google.com/search?igu=1&q=youtube',
  google_nocookie_socs: 'https://www.google.com/search?q=youtube',
  bing: 'https://www.bing.com/search?q=youtube',
  brave: 'https://search.brave.com/search?q=youtube',
  yahoo: 'https://search.yahoo.com/search?p=youtube',
  yahoo_uk: 'https://uk.search.yahoo.com/search?p=youtube',
  yahoo_yhs: 'https://search.yahoo.com/yhs/search?p=youtube',
  ddg: 'https://html.duckduckgo.com/html/?q=youtube',
};

const MARKERS = ['class="b_algo', 'class="result__a', 'class="result__s', 'class="algo', '/url?q=', 'class="snippet'];
const CHALLENGE = [
  'please solve the challenge', 'unusual traffic', 'verify you are a human',
  'verify you are human', 'are you a robot', 'enable javascript and cookies to continue',
  'cfconfig', '/challenge/verify', 'captcha_header', 'enablejs',
  '/httpservice/retry', 'before you continue to google', 'consent.google.com',
];

function get(url, extraHeaders = {}, cookie = '') {
  return new Promise((resolve) => {
    const headers = {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,ur;q=0.8',
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      ...extraHeaders,
    };
    if (cookie) headers.Cookie = cookie;
    const req = pick(url).get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.message }));
    req.setTimeout(40000, () => { req.destroy(); resolve({ status: 0, headers: {}, body: '', error: 'timeout' }); });
  });
}

async function run() {
  fs.mkdirSync('scripts/_engine_html', { recursive: true });
  for (const [name, url] of Object.entries(TARGETS)) {
    const extra = {};
    let cookie = '';
    if (name === 'google_socs') cookie = 'SOCS=CAESHAgBEhIaAB';
    if (name === 'google_nocookie_socs') cookie = 'SOCS=CAESHAgBEhIaAB; CONSENT=YES+cb.20210328-17-p0.en+FX+667';
    const res = await get(url, extra, cookie);
    const s = res.body.toLowerCase();
    const counts = MARKERS.map((m) => s.split(m).length - 1);
    const total = counts.reduce((a, b) => a + b, 0);
    const hits = CHALLENGE.filter((m) => s.includes(m));
    const hasConsentLink = res.body.includes('consent.google.com');
    const isConsentPage = /before you continue to google/i.test(res.body) || hasConsentLink;
    console.log(
      `${name.padEnd(20)} ${String(res.status).padEnd(4)} ${String(res.body.length).padStart(7)}b  markers=${String(total).padStart(3)} [${counts.join(',')}]  challengeHits=[${hits.join(' | ')}]  consentPage=${isConsentPage}`,
    );
    if (res.body) fs.writeFileSync(`scripts/_engine_html/${name}.html`, res.body);
  }
}
run();
