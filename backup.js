// ═══════════════════════════════════════════════════════════════
//  Sauvegarde quotidienne PostgreSQL → bucket Railway (S3)
//  Lancé par un service cron Railway (`node backup.js`). Sort en code 1 si échec.
//  Un dossier par jour : backups/AAAA-MM-JJ/<table>.json.gz  (+ manifest.json)
// ═══════════════════════════════════════════════════════════════
'use strict';
const { Pool } = require('pg');
const zlib     = require('zlib');
const { promisify } = require('util');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const gzip = promisify(zlib.gzip);

// "logs" volontairement exclu (non critique, volumineux)
const TABLES    = ['config', 'sellers', 'orders', 'reviews', 'images'];
const KEEP_DAYS = parseInt(process.env.BACKUP_KEEP_DAYS || '14', 10);
const PREFIX    = 'backups/';

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`[backup] variable manquante: ${name}`); process.exit(1); }
  return v;
}

const pool = new Pool({
  connectionString: need('DATABASE_URL'),
  ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
});

const BUCKET = need('BUCKET');
const s3 = new S3Client({
  endpoint: need('ENDPOINT'),
  region: process.env.REGION || 'auto',
  forcePathStyle: process.env.S3_PATH_STYLE === '1', // Railway: virtual-host (défaut) ; chemin pour les tests locaux
  credentials: { accessKeyId: need('ACCESS_KEY_ID'), secretAccessKey: need('SECRET_ACCESS_KEY') },
});

// Les BYTEA (images) deviennent {"__b64": "..."} pour survivre au JSON
const replacer = (_k, v) =>
  (v && v.type === 'Buffer' && Array.isArray(v.data)) ? { __b64: Buffer.from(v.data).toString('base64') } : v;

async function main() {
  const day = new Date().toISOString().slice(0, 10);
  const manifest = { day, startedAt: new Date().toISOString(), tables: {} };

  for (const t of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${t}`); // noms de tables fixes ci-dessus
    const body = await gzip(Buffer.from(JSON.stringify(rows, replacer)));
    const Key = `${PREFIX}${day}/${t}.json.gz`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: body, ContentType: 'application/gzip' }));
    manifest.tables[t] = { rows: rows.length, bytes: body.length };
    console.log(`[backup] ${t}: ${rows.length} lignes → ${(body.length / 1024).toFixed(0)} Ko`);
  }

  manifest.finishedAt = new Date().toISOString();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: `${PREFIX}${day}/manifest.json`,
    Body: JSON.stringify(manifest, null, 2), ContentType: 'application/json',
  }));

  // Vérification : tout ce qu'on vient d'écrire est bien listé
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}${day}/` }));
  const expected = TABLES.length + 1;
  if ((listed.KeyCount || 0) < expected) throw new Error(`vérification: ${listed.KeyCount}/${expected} fichiers présents`);

  // Rétention : on supprime les dossiers plus vieux que KEEP_DAYS
  const limit = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const all = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const old = (all.Contents || []).filter(o => {
    const d = o.Key.slice(PREFIX.length, PREFIX.length + 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < limit;
  });
  if (old.length) {
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: old.map(o => ({ Key: o.Key })) } }));
    console.log(`[backup] ${old.length} ancien(s) fichier(s) supprimé(s) (> ${KEEP_DAYS} j)`);
  }

  console.log(`[backup] OK ${day} — ${expected} fichiers`);
}

main()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch(e => { console.error('[backup] ÉCHEC:', e.message); process.exit(1); });
