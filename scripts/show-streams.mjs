import fs from 'node:fs'

const pk = JSON.parse(fs.readFileSync('E:/Vyora TV/server/data/channels/PK.json', 'utf8'))
for (const id of ['A-PlusTV.pk', '24NewsHD.pk', '92NewsHD.pk']) {
  const ch = pk.find((c) => c.id === id)
  if (!ch) {
    console.log(id, 'NOT FOUND')
    continue
  }
  console.log('---', ch.name, '(' + id + ')')
  for (const s of ch.streams) {
    console.log('   ', s.label, s.url, '| referer:', s.referer || '-', '| ua:', s.ua ? 'yes' : '-')
  }
}
