import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DB_DIR = path.resolve(__dirname, 'server-data')
const DB_PATH = path.join(DB_DIR, 'db.json')
const SEED_DIR = path.resolve(__dirname, 'src/data')

function readJson(name: string) {
  return JSON.parse(fs.readFileSync(path.join(SEED_DIR, name), 'utf-8'))
}

function seedDb() {
  return {
    users: readJson('users.json'),
    wallets: readJson('wallets.json'),
    transactions: readJson('transactions.json'),
    contacts: readJson('contacts.json'),
    merchants: readJson('merchants.json'),
    shieldModes: readJson('shieldModes.json'),
    guardianLinks: readJson('guardianLinks.json'),
    pendingReviews: readJson('reviews.json'),
    notifications: readJson('notifications.json'),
    scamPatterns: readJson('scamPatterns.json'),
    blacklist: readJson('blacklist.json'),
    flags: {},
    _version: 1,
  }
}

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(seedDb(), null, 2))
}

function reseedDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })
  fs.writeFileSync(DB_PATH, JSON.stringify(seedDb(), null, 2))
}

function readDb() {
  ensureDb()
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
}

function writeDb(db: any) {
  ensureDb()
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

function sharedDbPlugin(): Plugin {
  return {
    name: 'tng-shared-db',
    configureServer(server) {
      // Re-seed db.json from src/data/*.json on every dev server start so the
      // seed files are the source of truth. Any in-app mutations made during
      // a previous session are discarded.
      reseedDb()
      // eslint-disable-next-line no-console
      console.log('[tng-shared-db] re-seeded server-data/db.json from src/data')

      server.middlewares.use('/api/db', (req, res, next) => {
        const url = req.url || '/'

        if (req.method === 'GET' && (url === '/' || url === '')) {
          const db = readDb()
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(db))
          return
        }

        if (req.method === 'PUT' && (url === '/' || url === '')) {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => chunks.push(c))
          req.on('end', () => {
            try {
              const incoming = JSON.parse(Buffer.concat(chunks).toString())
              const current = readDb()
              const nextVersion = (current._version || 0) + 1
              incoming._version = nextVersion
              writeDb(incoming)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, version: nextVersion }))
            } catch (e) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: String(e) }))
            }
          })
          return
        }

        if (req.method === 'POST' && url === '/reset') {
          if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
          ensureDb()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
          return
        }

        next()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), sharedDbPlugin()],
})
