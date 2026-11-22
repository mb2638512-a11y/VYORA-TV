import catalog from '../data/search-engines.json'
import type { BrowserEngineId } from '../types'

type CatalogEngine = {
  id: string
  name: string
  category: string
  template: string
  requiresAuth?: boolean
}

export type EngineConfig = {
  id: BrowserEngineId
  name: string
  short: string
  tagline: string
  category: string
  searchUrl: (query: string) => string
  homeUrl: string
  color: string
  favicon: string
  requiresAuth: boolean
  suggestEngine?: 'google' | 'bing' | 'duckduckgo'
}

const engines = (catalog as { engines: CatalogEngine[] }).engines
const CATEGORY_COLORS: Record<string, string> = {
  web: '#4285F4', metasearch: '#14B8A6', reference: '#8B5CF6',
  archive: '#64748B', academic: '#0EA5E9', books: '#A16207',
  video: '#EF4444', social: '#EC4899', developer: '#64748B',
  maps: '#16A34A', images: '#D946EF', news: '#F97316',
  shopping: '#EAB308', jobs: '#0D9488', travel: '#0284C7',
  knowledge: '#7C3AED', technology: '#6366F1', business: '#475569',
  research: '#0891B2', education: '#059669', utility: '#0F766E',
  finance: '#16A34A',
}

function originOf(template: string): string {
  try { return new URL(template).origin } catch { return 'https://www.google.com' }
}

export const BROWSER_ENGINES_LIST: EngineConfig[] = engines.map((engine) => {
  const origin = originOf(engine.template)
  const suggestEngine = engine.id === 'google0' ? 'google'
    : engine.id === 'bing1' ? 'bing'
    : engine.id === 'duckduckgo2' ? 'duckduckgo'
    : undefined
  return {
    id: engine.id,
    name: engine.name,
    short: engine.name,
    tagline: engine.category.replace(/[-_]/g, ' '),
    category: engine.category,
    searchUrl: (query: string) => engine.id === 'google0'
      ? `https://www.google.com/search?igu=1&q=${encodeURIComponent(query)}`
      : `${engine.template}${encodeURIComponent(query)}`,
    homeUrl: origin,
    color: CATEGORY_COLORS[engine.category] || '#64748B',
    favicon: `${origin}/favicon.ico`,
    requiresAuth: Boolean(engine.requiresAuth),
    suggestEngine,
  }
}).concat([{
  id: 'brave', name: 'Brave Search', short: 'Brave', tagline: 'web', category: 'web',
  searchUrl: (query: string) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
  homeUrl: 'https://search.brave.com/', color: '#FB542B',
  favicon: 'https://search.brave.com/favicon.ico', requiresAuth: false,
}])

const byId = Object.fromEntries(BROWSER_ENGINES_LIST.map((engine) => [engine.id, engine])) as Record<string, EngineConfig>

// Keep old saved tabs, settings and deep links working after adopting Orbit's
// canonical catalog IDs.
const LEGACY_ENGINE_IDS: Record<string, string> = {
  google: 'google0',
  bing: 'bing1',
  duckduckgo: 'duckduckgo2',
  yahoo: 'yahoo4',
  brave: 'brave',
}

export function normalizeBrowserEngineId(
  id: string | undefined,
  fallback = 'google0',
): BrowserEngineId {
  if (!id) return fallback
  const canonical = LEGACY_ENGINE_IDS[id] || id
  return byId[canonical] ? canonical : fallback
}

export const BROWSER_ENGINES: Record<string, EngineConfig> = {
  ...byId,
  // Compatibility aliases for older app entry points and stored sessions.
  google: byId.google0,
  bing: byId.bing1,
  duckduckgo: byId.duckduckgo2,
  yahoo: byId.yahoo4,
  brave: byId.brave,
}

export const BROWSER_ENGINE_CATEGORIES = [
  ...new Set(BROWSER_ENGINES_LIST.map((engine) => engine.category)),
].sort()
