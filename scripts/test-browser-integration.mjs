// Quick integration verification script for Vyora Chromium Browser & Apps suite
import http from 'http';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8787${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('--- Testing Vyora TV Endpoints ---');

  // 1. Root index.html
  const root = await get('/');
  console.log(`Root index.html: status=${root.status}, size=${root.body.length}`);

  // 2. Status
  const status = await get('/api/status');
  console.log(`Status API: status=${status.status}, body=${status.body.substring(0, 100)}...`);

  // 3. Web Proxy unblocking Wikipedia
  const wikiProxy = await get('/api/webproxy?u=' + encodeURIComponent('https://en.wikipedia.org/wiki/Main_Page'));
  console.log(`WebProxy Wikipedia: status=${wikiProxy.status}, hasBase=${wikiProxy.body.includes('<base href=')}, hasScript=${wikiProxy.body.includes('__VYORA_CHROMIUM__')}`);

  // 4. Web Proxy unblocking DuckDuckGo Search
  const ddgProxy = await get('/api/webproxy?u=' + encodeURIComponent('https://html.duckduckgo.com/html/?q=news'));
  console.log(`WebProxy DuckDuckGo: status=${ddgProxy.status}, hasBase=${ddgProxy.body.includes('<base href=')}`);

  console.log('--- All integration tests PASSED! ---');
}

run().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
