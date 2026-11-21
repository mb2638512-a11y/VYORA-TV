// Full pipeline test: for each engine -> search -> detect proxy fallback ->
// extract first organic result -> follow that link through the proxy ->
// verify the destination actually renders (not a branded error page).
import http from 'http';

const PROXY = 'http://127.0.0.1:8787/api/webproxy?u=';

const ENGINES = {
  google: (q) => `https://www.google.com/search?igu=1&q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  brave: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  yahoo: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`,
  ecosia: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}`,
};

// Mirrors server-go/webproxy.go hasSearchResults()
const MARKERS = [
  'class="b_algo',
  'class="result__a',
  'class="result__s',
  'class="algo',
  '/url?q=',
  'class="snippet',
];
function hasSearchResults(body) {
  const s = body.toLowerCase();
  let total = 0;
  for (const m of MARKERS) total += s.split(m).length - 1;
  return { total, ok: total >= 3 };
}

// Mirrors server-go/webproxy.go isChallengePage()
const CHALLENGE = [
  'please solve the challenge', 'unusual traffic', 'verify you are a human',
  'verify you are human', 'are you a robot', 'enable javascript and cookies to continue',
  'cfconfig', '/challenge/verify', 'captcha_header', 'enablejs',
  '/httpservice/retry', 'before you continue to google', 'consent.google.com',
];
function challengeHits(body) {
  const s = body.toLowerCase();
  return CHALLENGE.filter((m) => s.includes(m));
}

function rawGet(url, { method = 'GET', followRedirect = false, headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = http.get(
      url,
      { headers: { 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.message }));
    req.setTimeout(45000, () => {
      req.destroy();
      resolve({ status: 0, headers: {}, body: '', error: 'timeout' });
    });
  });
}

// Pull organic result URLs out of the engine HTML.
function extractResults(engine, html) {
  const out = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let h = m[1].replace(/&amp;/g, '&');
    if (!h || h.startsWith('#') || h.startsWith('javascript:')) continue;
    if (h.startsWith('/')) {
      const base = { google: 'https://www.google.com', duckduckgo: 'https://html.duckduckgo.com', bing: 'https://www.bing.com', brave: 'https://search.brave.com', yahoo: 'https://search.yahoo.com', ecosia: 'https://www.ecosia.org' }[engine];
      h = base + h;
    }
    const host = (() => { try { return new URL(h).hostname; } catch { return ''; } })();
    const engineHosts = ['google.com', 'duckduckgo.com', 'bing.com', 'brave.com', 'yahoo.com', 'ecosia.org', 'gstatic.com', 'microsoft.com', 'microsofttranslator.com', 'w3.org'];
    if (!host) continue;
    if (engineHosts.some((eh) => host.endsWith(eh))) continue;
    if (!/^https?:/.test(h)) continue;
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

async function run() {
  const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['youtube'];
  for (const q of queries) {
    console.log(`\n############ QUERY: "${q}" ############`);
    for (const [engine, mk] of Object.entries(ENGINES)) {
      const url = mk(q);
      const t0 = Date.now();
      const res = await rawGet(PROXY + encodeURIComponent(url));
      const ms = Date.now() - t0;

      let note = '';
      let servedEngine = engine;
      if (res.status === 307 && res.headers.location) {
        const loc = res.headers.location;
        note = `REDIRECT -> ${loc.slice(0, 120)}`;
        const m = loc.match(/vyora_engine=([^&]+)/);
        if (m) servedEngine = `ddg(fallback from ${decodeURIComponent(m[1])})`;
        const r2 = await rawGet('http://127.0.0.1:8787' + loc);
        res.body = r2.body;
        res.status = r2.status;
      }

      const sr = hasSearchResults(res.body);
      const ch = challengeHits(res.body);
      const results = extractResults(engine, res.body);
      const branded = res.body.includes('VYORA TV BROWSER') && res.body.includes('could not be reached');

      console.log(
        `\n[${engine.toUpperCase()}] ${res.status} ${res.body.length}b ${ms}ms | markers=${sr.total}${sr.ok ? ' OK' : ' FAIL'} | challenge=${ch.length ? ch.join(',') : 'no'} | results=${results.length} | brandedErr=${branded}`,
      );
      if (note) console.log(`   ${note}`);
      if (results.length === 0) {
        console.log('   !! NO ORGANIC RESULTS');
        continue;
      }
      // Click the first result and follow it through the proxy.
      const target = results[0];
      const clickT0 = Date.now();
      const cres = await rawGet(PROXY + encodeURIComponent(target));
      const cMs = Date.now() - clickT0;
      const cbranded = cres.body.includes('VYORA TV BROWSER') && cres.body.includes('could not be reached');
      const ctitle = (cres.body.match(/<title[^>]*>([^<]{0,90})/i) || [])[1] || '';
      console.log(`   CLICK 1 -> ${target.slice(0, 100)}`);
      console.log(`   RESULT ${cres.status} ${cres.body.length}b ${cMs}ms | title="${ctitle.trim()}" | brandedErr=${cbranded}`);
      if (cres.status !== 200 || cbranded) console.log('   !! CLICK FAILED');
    }
  }
}
run();
