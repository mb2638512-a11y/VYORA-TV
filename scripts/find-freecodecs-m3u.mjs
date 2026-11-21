import fs from 'node:fs';

const html = fs.readFileSync('data/raw/freecodecs_movies.html', 'utf8');
const regex = /https?:\/\/[^\s"'<>]+\.m3u8?/gi;
const matches = [...new Set(html.match(regex) || [])];
console.log('Matches found:', matches);

// Also look for download buttons or endpoints
const btnMatches = html.match(/href="([^"]*download[^"]*)"/gi);
console.log('Download buttons:', btnMatches);
