import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { log } from './logger.js'

/**
 * In-memory store over the generated dataset.
 * Holds: index (countries/categories), per-country channel lists and a
 * normalised search index (name, alt names, network, owner, country).
 */
class Store {
  constructor() {
    this.index = null
    this.countries = new Map() // code -> [channel]
    this.channelsById = new Map()
    this.searchIndex = []
    this.loadedAt = 0
    this._all = null
    this.health = null
  }

  attachHealth(health) {
    this.health = health
  }

  load() {
    const indexFile = path.join(config.dataDir, 'index.json')
    if (!fs.existsSync(indexFile)) {
      throw new Error(
        `Dataset not found at ${indexFile}. Run "npm run data" to generate it.`,
      )
    }
    this.index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
    this.countries.clear()
    this.channelsById.clear()
    this.searchIndex = []

    const dir = path.join(config.dataDir, 'channels')
    for (const c of this.index.countries) {
      const f = path.join(dir, `${c.code}.json`)
      if (!fs.existsSync(f)) continue
      const list = JSON.parse(fs.readFileSync(f, 'utf8'))
      this.countries.set(c.code, list)
      for (const ch of list) {
        this.channelsById.set(ch.id, ch)
        this.searchIndex.push({
          id: ch.id,
          n: ch.name.toLowerCase(),
          a: (ch.alt || []).map((x) => x.toLowerCase()),
          o: (ch.owner || '').toLowerCase(),
          w: (ch.network || '').toLowerCase(),
          c: ch.country,
        })
      }
    }
    this.loadedAt = Date.now()
    this.buildTop()
    log.info('dataset loaded', {
      countries: this.countries.size,
      channels: this.channelsById.size,
    })
  }

  /** Top channels across every country (online & best quality first). */
  buildTop() {
    const score = (ch) => {
      let statusBonus = 0
      if (this.health) {
        const h = this.health.get(ch.id)
        if (h?.status === 'online') statusBonus = 25000 - Math.min(2000, h.ms || 0)
        else if (h?.status === 'offline') statusBonus = -50000
      }
      const label = ch.streams?.[0]?.label || ''
      const n = parseInt(label, 10)
      let q = Number.isFinite(n) ? n : 0
      if (label.includes('4K')) q = 2160
      else if (label.includes('2K')) q = 1440
      return statusBonus + (q * 100) + (ch.streams?.length || 0)
    }
    const all = this.allChannels().slice().sort((a, b) => score(b) - score(a))
    const seen = new Set()
    const out = []
    for (const ch of all) {
      if (!seen.has(ch.country)) {
        seen.add(ch.country)
        out.push(ch)
      }
      if (out.length >= 60) break
    }
    for (const ch of all) {
      if (out.length >= 84) break
      if (!out.includes(ch)) out.push(ch)
    }
    this.top = out
  }

  getTop(limit = 84) {
    if (!this.index) this.load()
    if (this.health && this.health.status.size > 0) {
      this.buildTop()
    }
    return this.top.slice(0, limit)
  }

  /** Exact channel lookup by id (favourites / recently watched). */
  getByIds(ids) {
    if (!this.index) this.load()
    return ids.map((id) => this.channelsById.get(id)).filter(Boolean)
  }

  getIndex() {
    if (!this.index) this.load()
    return this.index
  }

  getCountries() {
    return this.getIndex().countries
  }

  getCategories() {
    return this.getIndex().categories
  }

  getChannels(country) {
    if (!this.index) this.load()
    if (!country || country === 'all') return this.allChannels()
    return this.countries.get(String(country).toUpperCase()) || []
  }

  allChannels() {
    if (!this.index) this.load()
    if (!this._all) {
      const out = []
      for (const list of this.countries.values()) out.push(...list)
      this._all = out
    }
    return this._all
  }

  getChannel(id) {
    if (!this.index) this.load()
    return this.channelsById.get(id) || null
  }

  /** Filter + search over the whole catalogue (verified online channels prioritized). */
  query({ country, category, search, limit = 500, offset = 0 } = {}) {
    let list = this.getChannels(country)
    if (category && category !== 'all') {
      list = list.filter((c) => c.categories.includes(category))
    }
    if (search) {
      const q = search.trim().toLowerCase()
      if (q) {
        const terms = q.split(/\s+/).filter(Boolean)
        list = list.filter((ch) => {
          const hay = [ch.name, ch.network, ch.owner, ch.country, ...(ch.alt || [])]
            .join(' ')
            .toLowerCase()
          return terms.every((t) => hay.includes(t))
        })
        // exact / prefix matches float to the top + online bonus
        list = [...list].sort((a, b) => {
          let scoreA = score(a)
          let scoreB = score(b)
          if (this.health) {
            const ha = this.health.get(a.id)?.status
            const hb = this.health.get(b.id)?.status
            if (ha === 'online') scoreA += 5000
            else if (ha === 'offline') scoreA -= 2000
            if (hb === 'online') scoreB += 5000
            else if (hb === 'offline') scoreB -= 2000
          }
          return scoreB - scoreA
        })
        function score(ch) {
          const n = ch.name.toLowerCase()
          if (n === q) return 1000
          if (n.startsWith(q)) return 500
          if (n.includes(q)) return 250
          return 0
        }
      }
    } else if (this.health && this.health.status.size > 0) {
      // Prioritize verified online channels to the top
      list = [...list].sort((a, b) => {
        const ha = this.health.get(a.id)?.status
        const hb = this.health.get(b.id)?.status
        const rankA = ha === 'online' ? 2 : ha === 'unknown' ? 1 : 0
        const rankB = hb === 'online' ? 2 : hb === 'unknown' ? 1 : 0
        return rankB - rankA
      })
    }
    return { total: list.length, items: list.slice(offset, offset + limit) }
  }

  stats() {
    if (!this.index) this.load()
    return {
      loadedAt: this.loadedAt,
      generatedAt: this.index.generatedAt,
      totals: this.index.totals,
    }
  }
}

export const store = new Store()
