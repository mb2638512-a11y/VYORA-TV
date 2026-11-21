// Does Google serve results when the request goes through the LOCAL 8080
// proxy instead of direct? The Go webproxy uses Proxy:nil (direct), Chromium
// on Windows picks up the system proxy (127.0.0.1:8080). If the tunnel is the
// difference, the fix is to route the browser's fetches through it too.
import https from 'node:https';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getViaProxy(url) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        agent: new https.Agent({ proxy: 'http://127.0.0.1:8080' }),
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        },
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), loc: res.headers.location }),
        );
      },
    );
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: '', error: 'timeout' });
    });
  });
}

const TARGETS = [
  ['google', 'https://www.google.com/search?igu=1&q=youtube'],
  ['google-nogu', 'https://www.google.com/search?q=youtube'],
  ['yahoo', 'https://search.yahoo.com/search?p=youtube'],
  ['brave', 'https://search.brave.com/search?q=youtube'],
  ['bing', 'https://www.bing.com/search?q=youtube'],
  ['ddg', 'https://html.duckduckgo.com/html/?q=youtube'],
];

async function main() {
  for (const [name, url] of TARGETS) {
    const r = await getViaProxy(url);
    const s = r.body;
    const markers = {
      g: (s.match(/\/url\?q=/g) || []).length,
      h3: (s.match(/<h3/g) || []).length,
      b_algo: (s.match(/class="b_algo/g) || []).length,
      result__a: (s.match(/class="result__a/g) || []).length,
      snippet: (s.match(/class="snippet/g) || []).length,
      algo: (s.match(/class="[^"]*\balgo\b/g) || []).length,
      enablejs: s.includes('/httpservice/retry/enablejs'),
      sorry: s.includes('/sorry/index'),
    };
    console.log(`${name.padEnd(12)} ${String(r.status).padEnd(4)} ${String(s.length).padStart(7)}b  ${JSON.stringify(markers)}`);
    if (r.loc) console.log(`    loc: ${r.loc.slice(0, 110)}`);
    if (r.error) console.log(`    err: ${r.error}`);
  }
}
main();
