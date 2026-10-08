'use strict';
// Anti-spam (Redis, repli mémoire) — extrait de server.js sans changement de comportement
const Redis = require('ioredis');
const SPAM = {
  burstMax   : 3,    // messages max...
  burstSec   : 10,   // ...sur cette fenêtre (secondes)
  minuteMax  : 20,   // messages max par minute
  banSec     : 60,   // durée du blocage temporaire après dépassement
};
const STALE_MSG_SEC = 60; // un message plus vieux que ça (file Telegram après redémarrage) n'est pas traité

let redis = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  redis.on('ready', () => console.log('[redis] connecté ✓ — anti-spam partagé actif'));
  redis.on('error', e => console.warn('[redis]', e.message));
} else {
  console.warn('[redis] REDIS_URL absent — anti-spam en mémoire uniquement');
}

const memHits = new Map(); // key -> { n, exp }
const memBans = new Map(); // key -> exp
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memHits) if (v.exp <= now) memHits.delete(k);
  for (const [k, exp] of memBans) if (exp <= now) memBans.delete(k);
}, 60000).unref();

async function hit(key, windowSec) {
  if (redis && redis.status === 'ready') {
    try {
      const [[, n], [, ttl]] = await redis.pipeline().incr(key).ttl(key).exec();
      if (ttl < 0) await redis.expire(key, windowSec); // garantit l'expiration
      return n;
    } catch (e) { /* repli mémoire */ }
  }
  const now = Date.now();
  const cur = memHits.get(key);
  if (!cur || cur.exp <= now) { memHits.set(key, { n: 1, exp: now + windowSec * 1000 }); return 1; }
  return ++cur.n;
}

async function isBanned(key) {
  if (redis && redis.status === 'ready') {
    try { return (await redis.exists(key)) === 1; } catch (e) { /* repli */ }
  }
  const exp = memBans.get(key);
  return !!exp && exp > Date.now();
}

async function setBan(key, sec) {
  if (redis && redis.status === 'ready') {
    try { return (await redis.set(key, '1', 'EX', sec, 'NX')) === 'OK'; } catch (e) { /* repli */ }
  }
  if (isBannedMem(key)) return false;
  memBans.set(key, Date.now() + sec * 1000);
  return true;
}
function isBannedMem(key) { const e = memBans.get(key); return !!e && e > Date.now(); }

// Verrou "un message à la fois" (expire seul après `sec` si jamais il n'est pas libéré)
const memLocks = new Map();
async function acquireLock(key, sec) {
  if (redis && redis.status === 'ready') {
    try { return (await redis.set(key, '1', 'EX', sec, 'NX')) === 'OK'; } catch (e) { /* repli */ }
  }
  const exp = memLocks.get(key);
  if (exp && exp > Date.now()) return false;
  memLocks.set(key, Date.now() + sec * 1000);
  return true;
}
async function releaseLock(key) {
  memLocks.delete(key);
  if (redis && redis.status === 'ready') {
    try { await redis.del(key); } catch (e) { /* expire seul */ }
  }
}

// Retourne { blocked, notify } — notify = true une seule fois, au moment du blocage
async function spamGuard(scope, userId) {
  const banKey = `spam:ban:${scope}:${userId}`;
  if (await isBanned(banKey)) return { blocked: true, notify: false };
  const burst  = await hit(`spam:b:${scope}:${userId}`, SPAM.burstSec);
  const minute = burst <= SPAM.burstMax ? await hit(`spam:m:${scope}:${userId}`, 60) : 0;
  if (burst > SPAM.burstMax || minute > SPAM.minuteMax) {
    const first = await setBan(banKey, SPAM.banSec);
    return { blocked: true, notify: first };
  }
  return { blocked: false, notify: false };
}

module.exports = { SPAM, STALE_MSG_SEC, redis, spamGuard, acquireLock, releaseLock };
