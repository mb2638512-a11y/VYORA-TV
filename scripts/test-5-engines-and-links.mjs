import http from 'http';
import { URL } from 'url';

const ENGINES = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  brave: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  yahoo: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`,
};

const QUERIES = ['youtube', 'wikipedia', 'github', 'weather', 'news'];

async function fetchProxy(url) {
  const proxyUrl = 'http://127.0.0.1:8787/api/webproxy?u=' + encodeURIComponent(url);
  return new Promise((resolve) => {
    http.get(proxyUrl, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body, finalUrl: res.headers.location || url });
      });
    }).on('error', (err) => resolve({ status: 500, error: err.message, body: '' }));
  });
}

function extractLinks(html, baseUrl) {
  const links = [];
  const regex = /href=["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      links.push(href);
    }
  }
  return links;
}

async function run() {
  console.log('=== TESTING 5 SEARCH ENGINES & RESULTS ===\n');

  for (const [engine, getUrl] of Object.entries(ENGINES)) {
    console.log(`--- Engine: ${engine.toUpperCase()} ---`);
    for (const q of QUERIES) {
      const searchUrl = getUrl(q);
      const res = await fetchProxy(searchUrl);
      const isOk = res.status === 200 || res.status === 302 || res.status === 307;
      console.log(`Query "${q}": Status ${res.status}, Length ${res.body.length} bytes`);

      if (res.body.length > 0) {
        const links = extractLinks(res.body, searchUrl);
        // Find links that look like organic search results
        const resultLinks = links.filter(l => 
          l.includes('youtube') || l.includes('wikipedia') || l.includes('github') || 
          l.includes('/url?') || l.includes('/l/?') || l.includes('/ck/a?') || l.includes('/RU=') ||
          (l.startsWith('http') && !l.includes(engine))
        );
        console.log(`  Found ${links.length} total links, ~${resultLinks.length} result candidate links.`);
        if (resultLinks.length > 0) {
          console.log(`  Sample result links:`, resultLinks.slice(0, 3));
        }
      }
    }
    console.log('\n');
  }
}

run();
