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
  const imgs = (await pool.query('SELECT key, length(data) AS n FROM images')).rows;
  const size = new Map(imgs.map(r => [r.key, Number(r.n)]));

  const catalogue  = await tokens('SELECT value::text AS t FROM config');
  const historique = new Set([
    ...await tokens('SELECT data::text AS t FROM orders'),
    ...await tokens('SELECT data::text AS t FROM reviews'),
    ...await tokens('SELECT data::text AS t FROM sellers'),
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

  if (g.catalogue.length === 0) throw new Error('le catalogue ne référence aucune photo — arrêt par sécurité');

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
