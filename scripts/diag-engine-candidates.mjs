// Which engines actually serve REAL results from this host? Test more candidates.
import https from 'node:https';
import http from 'node:http';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const pick = (url) => (url.startsWith('https:') ? https : http);

const CANDIDATES = {
  // Google variants
  g_startpage_ecosia: 'https://www.startpage.com/sp/search?query=youtube&cat=web&pl=opensearch',
  // Bing variants
  b_rss: 'https://www.bing.com/search?q=youtube&format=rss',
  b_news: 'https://www.bing.com/search?q=youtube&format=rss',
  // Ecosia variants
  e_api: 'https://api.ecosia.org/v1/search?q=youtube',
  e_nl: 'https://www.ecosia.org/search?q=youtube&tt=',
  // Yahoo variants
  y_news: 'https://news.search.yahoo.com/search?p=youtube',
  y_rss: 'https://search.yahoo.com/rss?p=youtube',
  y_img: 'https://images.search.yahoo.com/search?p=youtube',
  // Other engines
  mojeek: 'https://www.mojeek.com/search?q=youtube',
  marginalia: 'https://search.marginalia.nu/search?query=youtube',
  rightdao: 'https://rightdao.com/search?q=youtube',
  searx_be: 'https://searx.be/search?q=youtube&format=json',
  searxng_priv: 'https://priv.au/search?q=youtube',
  searx_tiek: 'https://search.bus-hit.me/search?q=youtube',
  qwant: 'https://lite.qwant.com/?q=youtube&t=web',
  yandex: 'https://yandex.com/search/?text=youtube',
  ask: 'https://www.ask.com/web?q=youtube',
  aol: 'https://search.aol.com/aol/search?q=youtube',
  dogpile: 'https://www.dogpile.com/serp?q=youtube',
  lycos: 'https://search.lycos.com/web/?q=youtube',
  swisscows: 'https://swisscows.com/en/web?query=youtube',
  wiby: 'https://wiby.me/?q=youtube',
  gigablast: 'https://www.gigablast.com/search?q=youtube',
};

function get(url) {
  return new Promise((resolve) => {
    const req = pick(url).get(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), loc: res.headers.location }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

const OUT = {
  'class="b_algo': 'bing',
  'class="result__a': 'ddg',
  'class="result__s': 'ddg',
  'class="algo': 'yahoo',
  '/url?q=': 'google',
  'class="snippet': 'brave',
  'class="result__title': 'ecosia',
  'class="result-title': 'ecosia2',
  'w-gl__result': 'startpage',
  'results-standard': 'mojeek',
  'class="result': 'generic',
  '<item>': 'rss',
  '"title"': 'json',
  'result-item': 'generic2',
};

async function run() {
  for (const [name, url] of Object.entries(CANDIDATES)) {
    const res = await get(url);
    const s = res.body.toLowerCase();
    const hits = Object.entries(OUT).filter(([m]) => s.includes(m)).map(([, v]) => v);
    const uniq = [...new Set(hits)];
    console.log(
      `${name.padEnd(22)} ${String(res.status).padEnd(4)} ${String(res.body.length).padStart(7)}b  hits=[${uniq.join(',')}]${res.loc ? '  loc=' + res.loc.slice(0, 60) : ''}${res.error ? '  err=' + res.error : ''}`,
    );
  }
}
run();
