import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/index.json'), 'utf8'))
const pk = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/channels/PK.json'), 'utf8'))
const inl = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/channels/IN.json'), 'utf8'))
const us = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/channels/US.json'), 'utf8'))
console.log('index PK count', idx.countries.find((c) => c.code === 'PK')?.count)
console.log('index IN count', idx.countries.find((c) => c.code === 'IN')?.count)
console.log('PK.json len', pk.length, 'IN.json len', inl.length, 'US.json len', us.length)
console.log('PK sample ids:', pk.slice(0, 5).map((c) => c.id).join(', '))
console.log('PK sample names:', pk.slice(0, 5).map((c) => c.name).join(' | '))
console.log('IN sample names:', inl.slice(0, 5).map((c) => c.name).join(' | '))

const apkIdx = path.join(ROOT, 'android/app/assets/data/index.json')
if (fs.existsSync(apkIdx)) {
  const a = JSON.parse(fs.readFileSync(apkIdx, 'utf8'))
  console.log('APK asset index totals', JSON.stringify(a.totals), a.generatedAt)
}

// what does the server currently serve / load?
const srvIdx = path.join(ROOT, 'server/data/channels')
const files = fs.readdirSync(srvIdx)
console.log('country files:', files.length)
