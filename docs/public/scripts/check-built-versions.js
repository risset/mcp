const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const site = path.join(root, 'build/site')

for (const [version, source] of [['1', 'v1'], ['2', '.']]) {
  const module = path.join(root, source, 'modules/ROOT')
  for (const page of fs.readdirSync(path.join(module, 'pages'), { recursive: true })) {
    if (!page.endsWith('.adoc')) continue
    const stem = page.slice(0, -'.adoc'.length)
    const output = path.basename(stem) === 'index' ? stem + '.html' : path.join(stem, 'index.html')
    assert.ok(fs.existsSync(path.join(site, 'mcp', version, output)),
      `Missing generated version ${version} page: ${page}`)
  }
  for (const image of fs.readdirSync(path.join(module, 'images'), { recursive: true })) {
    if (!fs.statSync(path.join(module, 'images', image)).isFile()) continue
    assert.ok(fs.existsSync(path.join(site, 'mcp', version, '_images', image)),
      `Missing generated version ${version} image: ${image}`)
  }
}

assert.match(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), /mcp\/2\//,
  'The site landing page must select version 2')
console.log('Both documentation versions, their pages and images, and the landing page are present.')
