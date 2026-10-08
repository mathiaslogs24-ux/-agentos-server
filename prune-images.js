// ═══════════════════════════════════════════════════════════════
//  Nettoyage des photos non associées à un article
//
//  Une photo est "utilisée" si sa clé apparaît dans les données du catalogue (table config).
//  On sépare 3 groupes :
//    - catalogue : utilisée par un article  → GARDÉE
//    - historique: utilisée seulement par des commandes / avis / vendeurs → GARDÉE (sinon l'historique perd ses images)
//    - inutilisée: référencée nulle part → SUPPRIMABLE
//
//  Par défaut : SIMULATION (n'écrit rien). Pour supprimer il faut les DEUX variables :
//    PRUNE_APPLY=1  et  PRUNE_EXPECT=<nombre exact annoncé par la simulation>
//  Garde-fous : refuse si le catalogue ne référence aucune photo (lecture ratée = tout supprimer).
// ═══════════════════════════════════════════════════════════════
'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

const HEX = /\b[a-f0-9]{16,64}\b/g;
const mo  = n => (n / 1048576).toFixed(1) + ' Mo';

async function tokens(sql) {
  const set = new Set();
  const { rows } = await pool.query(sql);
  for (const r of rows) for (const m of String(r.t).matchAll(HEX)) set.add(m[0]);
  return set;
}

(async () => {
  const imgs = (await pool.query('SELECT key, length(data) AS n, created_at FROM images')).rows;
  const size = new Map(imgs.map(r => [r.key, Number(r.n)]));
  const when = new Map(imgs.map(r => [r.key, r.created_at]));

  // Catalogue = config (catalogue admin) + vendeurs (depuis le multi-vendeurs, le stock/shopItems
  // des vendeurs vit dans sellers.data). Sans ça le garde-fou voyait 0 photo et le cron plantait.
  const catalogue = new Set([
    ...await tokens('SELECT value::text AS t FROM config'),
    ...await tokens('SELECT data::text AS t FROM sellers'),
  ]);
  const historique = new Set([
    ...await tokens('SELECT data::text AS t FROM orders'),
    ...await tokens('SELECT data::text AS t FROM reviews'),
  ]);

  const g = { catalogue: [], historique: [], inutilisee: [] };
  for (const k of size.keys()) {
    if (catalogue.has(k))       g.catalogue.push(k);
    else if (historique.has(k)) g.historique.push(k);
    else                        g.inutilisee.push(k);
  }
  const sum = ks => ks.reduce((s, k) => s + size.get(k), 0);

  console.log(`[prune] ${imgs.length} photos en base (${mo(sum([...size.keys()]))})`);
  console.log(`[prune] utilisées par le catalogue : ${g.catalogue.length} (${mo(sum(g.catalogue))}) → gardées`);
  console.log(`[prune] seulement dans l'historique (commandes/avis/vendeurs) : ${g.historique.length} (${mo(sum(g.historique))}) → gardées`);
  console.log(`[prune] INUTILISÉES : ${g.inutilisee.length} (${mo(sum(g.inutilisee))}) → supprimables`);

  // Dates d'ajout (aide à comprendre d'où viennent les inutilisées : anciennes versions ?)
  const range = ks => {
    if (!ks.length) return '—';
    const t = ks.map(k => +new Date(when.get(k))).sort((a, b) => a - b);
    return `${new Date(t[0]).toISOString().slice(0, 16)} → ${new Date(t[t.length - 1]).toISOString().slice(0, 16)}`;
  };
  console.log(`[prune] dates d'ajout, catalogue    : ${range(g.catalogue)}`);
  console.log(`[prune] dates d'ajout, inutilisées  : ${range(g.inutilisee)}`);
  const day = k => new Date(when.get(k)).toISOString().slice(0, 10);
  const byDay = {};
  for (const k of g.inutilisee) byDay[day(k)] = (byDay[day(k)] || 0) + 1;
  console.log('[prune] inutilisées par jour d\'ajout : ' + JSON.stringify(byDay));

  if (g.catalogue.length === 0) throw new Error('le catalogue ne référence aucune photo — arrêt par sécurité');

  // ── Mode automatique (cron de nuit) : node prune-images.js --auto ──────────────
  // - ne touche qu'aux photos inutilisées depuis plus de PRUNE_GRACE_HOURS (24 h par défaut) :
  //   le dashboard envoie les photos AVANT d'enregistrer le catalogue, une photo toute neuve
  //   n'est pas encore "utilisée" ;
  // - refuse si ça ferait plus que max(PRUNE_MAX_ABS=50, PRUNE_MAX_RATIO=20 % des photos) :
  //   un tel écart ressemble à un catalogue abîmé, pas à un simple ménage.
  if (process.argv.includes('--auto')) {
    const graceH   = parseFloat(process.env.PRUNE_GRACE_HOURS || '24');
    const cutoff   = Date.now() - graceH * 3600 * 1000;
    const eligible = g.inutilisee.filter(k => +new Date(when.get(k)) < cutoff);
    const recent   = g.inutilisee.length - eligible.length;
    const maxDel   = Math.max(parseInt(process.env.PRUNE_MAX_ABS || '50', 10),
                              Math.floor(parseFloat(process.env.PRUNE_MAX_RATIO || '0.2') * imgs.length));
    console.log(`[prune] AUTO : ${eligible.length} à supprimer (+${recent} trop récentes, gardées ${graceH} h) — plafond ${maxDel}`);
    if (eligible.length > maxDel) throw new Error(`${eligible.length} suppressions dépassent le plafond de ${maxDel} — rien supprimé, vérification manuelle nécessaire`);
    let n = 0;
    for (let i = 0; i < eligible.length; i += 200) {
      n += (await pool.query('DELETE FROM images WHERE key = ANY($1)', [eligible.slice(i, i + 200)])).rowCount;
    }
    console.log(`[prune] AUTO : ${n} photos supprimées, ${imgs.length - n} restantes.`);
    return;
  }

  if (process.env.PRUNE_APPLY !== '1') { console.log('[prune] SIMULATION : rien supprimé.'); return; }
  if (String(g.inutilisee.length) !== String(process.env.PRUNE_EXPECT)) {
    throw new Error(`PRUNE_EXPECT=${process.env.PRUNE_EXPECT} ne correspond pas aux ${g.inutilisee.length} photos trouvées — arrêt`);
  }

  let deleted = 0;
  for (let i = 0; i < g.inutilisee.length; i += 200) {
    const r = await pool.query('DELETE FROM images WHERE key = ANY($1)', [g.inutilisee.slice(i, i + 200)]);
    deleted += r.rowCount;
  }
  const left = (await pool.query('SELECT count(*)::int AS c FROM images')).rows[0].c;
  console.log(`[prune] ${deleted} photos supprimées, ${left} restantes.`);
})()
  .then(() => pool.end())
  .catch(e => { console.error('[prune] ÉCHEC:', e.message); process.exit(1); });
