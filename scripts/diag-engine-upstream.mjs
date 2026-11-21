// Raw upstream diagnostic: which search-engine URL variants actually return
// real server-rendered organic results from THIS host (datacenter IP)?
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const VARIANTS = {
  google_igu: 'https://www.google.com/search?igu=1&q=youtube',
  google_plain: 'https://www.google.com/search?q=youtube',
  google_gbv: 'https://www.google.com/search?q=youtube&gbv=1',
  google_ncr: 'https://www.google.com/search?q=youtube&igu=1&num=20&hl=en&gbv=1',
  ddg_html_get: 'https://html.duckduckgo.com/html/?q=youtube',
  ddg_lite_get: 'https://lite.duckduckgo.com/lite/?q=youtube',
  ddg_html_post: 'https://html.duckduckgo.com/html/',
  bing_plain: 'https://www.bing.com/search?q=youtube',
  bing_mkt: 'https://www.bing.com/search?q=youtube&setmkt=en-US&setlang=en&ensearch=1',
  bing_rss: 'https://www.bing.com/search?q=youtube&format=rss',
  brave_plain: 'https://search.brave.com/search?q=youtube',
  brave_source: 'https://search.brave.com/search?q=youtube&source=web',
  yahoo_plain: 'https://search.yahoo.com/search?p=youtube',
  yahoo_noslug: 'https://search.yahoo.com/search?p=youtube&fr=yfp-t',
  ecosia_plain: 'https://www.ecosia.org/search?q=youtube',
  startpage: 'https://www.startpage.com/sp/search?query=youtube',
  mojeek: 'https://www.mojeek.com/search?q=youtube',
};

const MARKERS = {
  google: ['/url?q='],
  ddg: ['result__a', 'result__url'],
  bing: ['class="b_algo'],
  brave: ['snippet', 'result-header'],
  yahoo: ['class="algo'],
  ecosia: ['result__title', 'result-title'],
  startpage: ['w-gl__result-title', 'result-link'],
  mojeek: ['results-standard', 'title'],
};

function detect(host, body) {
  const s = body.toLowerCase();
  const counts = {};
  for (const [k, ms] of Object.entries(MARKERS)) {
    counts[k] = ms.reduce((acc, m) => acc + (s.split(m).length - 1), 0);
  }
  const challenge =
    s.includes('unusual traffic') ||
    s.includes('are you a robot') ||
    s.includes('captcha') ||
    s.includes('enable javascript and cookies') ||
    s.includes('challenge');
  const blocked =
    s.includes('before you continue to google') ||
    s.includes('consent.google.com') ||
    s.includes('enablejs');
  return { counts, challenge, blocked };
}

async function run() {
  for (const [name, url] of Object.entries(VARIANTS)) {
    const t0 = Date.now();
    try {
      let res;
      if (name === 'ddg_html_post') {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://html.duckduckgo.com',
            'Referer': 'https://html.duckduckgo.com/',
          },
          body: 'q=youtube',
          redirect: 'follow',
        });
      } else {
        res = await fetch(url, {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Upgrade-Insecure-Requests': '1',
          },
          redirect: 'follow',
        });
      }
      const body = await res.text();
      const d = detect(name, body);
      const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
      console.log(
        `${name.padEnd(16)} ${String(res.status).padEnd(4)} ${String(body.length).padStart(7)}b ${String(Date.now() - t0).padStart(6)}ms  total=${String(total).padStart(4)}  ${JSON.stringify(d.counts)}  ${d.challenge ? 'CHALLENGE ' : ''}${d.blocked ? 'BLOCKED' : ''}`,
      );
    } catch (e) {
      console.log(`${name.padEnd(16)} ERR ${e.message}`);
    }
  }
}
run();
