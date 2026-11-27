const express = require('express')
const path = require('path')

const app = express()
const siteDir = path.join(__dirname, 'build/site')
app.use('/docs', express.static(siteDir))

app.use('/static/assets', express.static(path.join(siteDir, 'assets')))

app.get('/', (req, res) => res.redirect('/docs/'))

const port = process.env.PORT || 8000
app.listen(port, () => console.log(`📘 http://localhost:${port}/docs/`))