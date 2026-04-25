// Cross-window shared store backed by the dev server's /api/db endpoint
// (see vite.config.ts → sharedDbPlugin). The server persists to
// server-data/db.json so a regular browser window and an incognito window
// can run the simulation against the same state.
//
// We keep the historical synchronous getDb()/setDb() API used by every
// service in this folder. Hydration is async — call initDb() once at boot
// (see main.tsx) and await it before rendering the app.

const POLL_INTERVAL_MS = 1500;
// While a window has just made a local mutation, briefly skip applying
// poll responses so the in-flight PUT isn't immediately overwritten by a
// stale GET. Last-write-wins on collisions, which is fine for the demo.
const LOCAL_MUTATION_GUARD_MS = 800;

let cache = null;
let cacheVersion = 0;
let initPromise = null;
let initialised = false;
let lastLocalMutationAt = 0;
let pollHandle = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  });
}

async function fetchDbFromServer() {
  const res = await fetch('/api/db', { headers: { 'Cache-Control': 'no-store' } });
  if (!res.ok) throw new Error(`GET /api/db failed: ${res.status}`);
  return res.json();
}

async function pushDbToServer(db) {
  try {
    const res = await fetch('/api/db', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(db),
    });
    if (!res.ok) return;
    const body = await res.json();
    if (body && typeof body.version === 'number') {
      cacheVersion = body.version;
      if (cache) cache._version = body.version;
    }
  } catch {
    // Network error — cache remains optimistic; next successful PUT will sync.
  }
}

function startSync() {
  if (pollHandle) return;
  pollHandle = setInterval(async () => {
    if (Date.now() - lastLocalMutationAt < LOCAL_MUTATION_GUARD_MS) return;
    try {
      const fresh = await fetchDbFromServer();
      const v = fresh._version || 0;
      if (v !== cacheVersion) {
        cache = fresh;
        cacheVersion = v;
        notify();
      }
    } catch {
      // ignore transient network errors
    }
  }, POLL_INTERVAL_MS);
}

export function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    cache = await fetchDbFromServer();
    cacheVersion = cache._version || 0;
    initialised = true;
    startSync();
  })();
  return initPromise;
}

export function getDb() {
  if (!cache) {
    // Defensive fallback — should not happen if main.tsx awaits initDb().
    // Returning empty collections keeps services from throwing on first paint.
    console.warn('getDb() called before initDb() resolved');
    return {
      users: [],
      wallets: {},
      transactions: {},
      contacts: {},
      merchants: [],
      shieldModes: [],
      guardianLinks: [],
      pendingReviews: [],
      notifications: {},
      scamPatterns: [],
      blacklist: [],
      flags: {},
    };
  }
  return cache;
}

export function setDb(db) {
  cache = db;
  lastLocalMutationAt = Date.now();
  // Don't write the empty fallback DB back to the server — that would wipe
  // real data if a service fires before initDb() resolves (e.g. during HMR).
  if (!initialised) return;
  pushDbToServer(cache);
  notify();
}

export function resetDb() {
  return fetch('/api/db/reset', { method: 'POST' })
    .then(() => fetchDbFromServer())
    .then((fresh) => {
      cache = fresh;
      cacheVersion = fresh._version || 0;
      initialised = true;
      notify();
      return cache;
    });
}

export function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function onDbChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
