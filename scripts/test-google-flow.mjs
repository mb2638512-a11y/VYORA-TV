import http from 'http';

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('Testing Google to YouTube Navigation Flow...\n');
  
  // 1. Google search query for "youtube"
  const gSearch = await get('http://127.0.0.1:8787/api/webproxy?u=' + encodeURIComponent('https://www.google.com/search?igu=1&q=youtube'));
  console.log('1. Google search results for "youtube": Status', gSearch.status, 'Size:', gSearch.body.length);
  const hasYouTubeLink = gSearch.body.includes('youtube.com');
  console.log('   Contains YouTube links:', hasYouTubeLink);

  // 2. Clicking YouTube link on Google: /url?q=https://www.youtube.com/
  const gRedirect = await get('http://127.0.0.1:8787/api/webproxy?u=' + encodeURIComponent('https://www.google.com/url?q=https://www.youtube.com/'));
  console.log('2. Click Google result for YouTube: Status', gRedirect.status, 'Size:', gRedirect.body.length);
  const isEmbed = gRedirect.body.includes('embed') || gRedirect.body.includes('youtube.com/embed');
  console.log('   Renders clean embed player (zero white screen):', isEmbed);

  // 3. User searching "youtube cricket" shortcut
  const ytSearch = await get('http://127.0.0.1:8787/api/webproxy?u=' + encodeURIComponent('https://www.youtube.com/embed?listType=search&list=cricket'));
  console.log('3. YouTube search embed: Status', ytSearch.status, 'Size:', ytSearch.body.length);

  console.log('\nAll Google -> YouTube flow tests complete!');
}

run();
