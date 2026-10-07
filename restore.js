// ═══════════════════════════════════════════════════════════════
//  Restauration d'une sauvegarde  (lancer à la main, jamais en cron)
//
//    node restore.js 2026-10-07            → SIMULATION : compte les lignes, n'écrit rien
//    node restore.js 2026-10-07 --apply    → écrit dans la base (INSERT ... ON CONFLICT DO NOTHING)
//
//  Ne remplace JAMAIS une ligne existante : pour repartir d'une base vide, vider
//  d'abord les tables concernées. Mêmes variables que backup.js.
// ═══════════════════════════════════════════════════════════════
'use strict';
const { Pool } = require('pg');
const zlib     = require('zlib');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const TABLES = ['config', 'sellers', 'orders', 'reviews', 'images'];
const day    = process.argv[2];
const APPLY  = process.argv.includes('--apply');
if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { console.error('Usage: node restore.js AAAA-MM-JJ [--apply]'); process.exit(1); }

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});
const s3 = new S3Client({
  endpoint: process.env.ENDPOINT, region: process.env.REGION || 'auto', forcePathStyle: process.env.S3_PATH_STYLE === '1',
  credentials: { accessKeyId: process.env.ACCESS_KEY_ID, secretAccessKey: process.env.SECRET_ACCESS_KEY },
});

async function readTable(t) {
  const r = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET, Key: `backups/${day}/${t}.json.gz` }));
  const buf = Buffer.from(await r.Body.transformToByteArray());
  return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
}

// Colonnes JSONB : config.value + data de sellers/orders/reviews (tout type de valeur, y compris
// un simple texte ou nombre, doit être renvoyé en JSON valide). images.data est un BYTEA.
const JSONB_COLS = { config: ['value'], sellers: ['data'], orders: ['data'], reviews: ['data'] };

function toParam(table, col, v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v.__b64 !== undefined) return Buffer.from(v.__b64, 'base64');
  if ((JSONB_COLS[table] || []).includes(col)) return JSON.stringify(v);
  return v;
}

(async () => {
  console.log(APPLY ? `RESTAURATION ${day} (écriture)` : `SIMULATION ${day} (aucune écriture)`);
  for (const t of TABLES) {
    const rows = await readTable(t);
    console.log(`- ${t}: ${rows.length} lignes dans la sauvegarde`);
    if (!APPLY || !rows.length) continue;
    let done = 0;
    for (const row of rows) {
      const cols = Object.keys(row);
      const sql  = `INSERT INTO ${t} (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING`;
      const res  = await pool.query(sql, cols.map(c => toParam(t, c, row[c])));
      done += res.rowCount;
    }
    console.log(`  ${done} insérée(s), ${rows.length - done} déjà présente(s)`);
  }
  await pool.end();
})().catch(e => { console.error('ÉCHEC:', e.message); process.exit(1); });
