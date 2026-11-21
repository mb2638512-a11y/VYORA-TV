// Provider-specific strategy probe: find request shapes that return REAL
// server-rendered results from this datacenter IP.
import https from 'node:https';
import http from 'node:http';

const pick = (u) => (u.startsWith('https:') ? https : http);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const OLD_IE = 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/4.0)';
const OLD_FF = 'Mozilla/5.0 (Windows NT 6.1; rv:10.0) Gecko/20100101 Firefox/10.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function get(url, { ua = CHROME, headers = {}, cookie = '' } = {}) {
  return new Promise((resolve) => {
    const h = {
      'User-Agent': ua,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      ...headers,
    };
    if (cookie) h.Cookie = cookie;
    const req = pick(url).get(url, { headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), loc: res.headers.location, cookie: res.headers['set-cookie'] }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

const MARKERS = {
  google: ['/url?q=', 'class="g"', 'data-ved=', 'MjjYud'],
  ddg: ['class="result__a', 'class="result__s'],
  bing: ['class="b_algo'],
  brave: ['class="snippet', 'result-header'],
  yahoo: ['class="algo', 'class="compTitle'],
  rss: ['<item>'],
  json: ['"title"', '"url"'],
};

function score(body) {
  const s = body.toLowerCase();
  const out = {};
  for (const [k, ms] of Object.entries(MARKERS)) {
    const n = ms.reduce((a, m) => a + (s.split(m).length - 1), 0);
    if (n) out[k] = n;
  }
  return out;
}

async function run() {
  const tests = [
    // GOOGLE strategies
    ['G oldIE', 'https://www.google.com/search?q=youtube&gbv=1', { ua: OLD_IE }],
    ['G oldIE2', 'https://www.google.com/search?q=youtube&num=10&hl=en&gbv=1', { ua: OLD_IE }],
    ['G oldFF', 'https://www.google.com/search?q=youtube&gbv=1', { ua: OLD_FF }],
    ['G android', 'https://www.google.com/search?q=youtube&igu=1', { ua: ANDROID }],
    ['G noWww', 'https://google.com/search?q=youtube&igu=1', {}],
    ['G socsOnly', 'https://www.google.com/search?q=youtube&igu=1', { cookie: 'SOCS=CAESHAgBEhIaAB' }],
    ['G consentYes', 'https://www.google.com/search?q=youtube&igu=1', { cookie: 'SOCS=CAESHAgBEhIaAB; CONSENT=YES+cb.20210328-17-p0.en+FX+667' }],
    ['G nojs', 'https://www.google.com/search?q=youtube&igu=1&nfpr=1&filter=0', { cookie: 'SOCS=CAISHAgBEhIaAB' }],
    ['G newsRss', 'https://news.google.com/rss/search?q=youtube&hl=en-US&gl=US&ceid=US:en', {}],
    ['G suggest', 'https://suggestqueries.google.com/complete/search?client=firefox&q=youtube', {}],

    // BING strategies
    ['B chrome', 'https://www.bing.com/search?q=youtube', {}],
    ['B noCookie', 'https://www.bing.com/search?q=youtube', { headers: { Cookie: '' } }],
    ['B setmkt', 'https://www.bing.com/search?q=youtube&setmkt=en-US&cc=US', {}],
    ['B rss', 'https://www.bing.com/search?q=youtube&format=rss', {}],

    // BRAVE strategies
    ['Br chrome', 'https://search.brave.com/search?q=youtube', {}],
    ['Br accept', 'https://search.brave.com/search?q=youtube', { headers: { Accept: 'text/html,application/xhtml+xml' } }],
    ['Br gosp', 'https://search.brave.com/search?q=youtube&source=web', {}],

    // YAHOO strategies
    ['Y chrome', 'https://search.yahoo.com/search?p=youtube', {}],
    ['Y oldIE', 'https://search.yahoo.com/search?p=youtube', { ua: OLD_IE }],
    ['Y fr', 'https://search.yahoo.com/search?p=youtube&fr=yfp-t&ei=UTF-8', {}],
    ['Y nolang', 'https://search.yahoo.com/search?p=youtube&vl=lang_en', {}],
    ['Y rsearch', 'https://r.search.yahoo.com/_ylt=*_ylc=*_ylc=*_ylc=*_ylc=*;_ylc=/RU=youtube/RV=2/RE=0/RO=10/RU=https%3a%2f%2fwww.youtube.com%2f/RK=2/RS=z', {}],
    ['Y searchyahoojp', 'https://search.yahoo.co.jp/search?p=youtube', {}],

    // ECOSIA strategies
    ['E chrome', 'https://www.ecosia.org/search?q=youtube', {}],
    ['E oldIE', 'https://www.ecosia.org/search?q=youtube', { ua: OLD_IE }],
    ['E bot', 'https://www.ecosia.org/search?q=youtube', { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }],
  ];

  for (const [name, url, opts] of tests) {
    const res = await get(url, opts);
    const sc = score(res.body);
    const total = Object.values(sc).reduce((a, b) => a + b, 0);
    console.log(`${name.padEnd(16)} ${String(res.status).padEnd(4)} ${String(res.body.length).padStart(7)}b  ${JSON.stringify(sc)}${res.loc ? '  loc=' + res.loc.slice(0, 50) : ''}${res.error ? '  err=' + res.error : ''}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
run();
