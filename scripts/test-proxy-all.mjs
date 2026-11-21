import http from 'http';

async function testUrl(name, url) {
  return new Promise((resolve) => {
    const proxyUrl = 'http://127.0.0.1:8787/api/webproxy?u=' + encodeURIComponent(url);
    const start = Date.now();
    http.get(proxyUrl, (res) => {
      let len = 0;
      res.on('data', (c) => len += c.length);
      res.on('end', () => {
        console.log(`[PASS] ${name} -> Status: ${res.statusCode} | Size: ${len} bytes | Time: ${Date.now() - start}ms`);
        resolve();
      });
    }).on('error', (e) => {
      console.log(`[FAIL] ${name} -> Error: ${e.message}`);
      resolve();
    });
  });
}

async function run() {
  console.log('Testing YouTube and all 5 Search Engines via Go Web Proxy on :8787...\n');
  await testUrl('YouTube Video Watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await testUrl('YouTube Search Query', 'https://www.youtube.com/results?search_query=cricket');
  await testUrl('Google Search Query', 'https://www.google.com/search?igu=1&q=cricket+world+cup');
  await testUrl('DuckDuckGo HTML Search', 'https://html.duckduckgo.com/html/?q=cricket+world+cup');
  await testUrl('Bing Search Query', 'https://www.bing.com/search?q=cricket+world+cup');
  await testUrl('Brave Search Query', 'https://search.brave.com/search?q=cricket+world+cup');
  await testUrl('Yahoo Search Query', 'https://search.yahoo.com/search?p=cricket+world+cup');
  console.log('\nAll tests complete.');
}

run();
