import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, '..', '..')

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'server', 'data'),
  webDir: process.env.WEB_DIR || path.join(ROOT, 'web', 'dist'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  logLevel: process.env.LOG_LEVEL || 'info',
  proxy: {
    enabled: process.env.STREAM_PROXY !== 'off',
    timeoutMs: Number(process.env.PROXY_TIMEOUT_MS || 6000),
    maxRedirects: 5,
    userAgent:
      process.env.PROXY_UA ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    // Only these hosts may be proxied (open-proxy protection).
    allowHost: process.env.PROXY_ALLOW_HOST || '',
    blockHost: process.env.PROXY_BLOCK_HOST || 'localhost,127.0.0.1,0.0.0.0,::1',
  },
  cache: {
    ttlMs: Number(process.env.CACHE_TTL_MS || 300000),
    maxEntries: Number(process.env.CACHE_MAX || 500),
  },
}
