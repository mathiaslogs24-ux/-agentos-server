'use strict';
// 📒 Journal des opérations d'argent. Chaque mouvement du solde d'un vendeur est noté UNE fois
// (la colonne `ref` est unique : rejouer une opération ne l'enregistre pas deux fois).
//  amount_cents > 0 : le solde du vendeur augmente ; < 0 : il diminue.
//  kind : opening | sale | commission | refund | refund_commission | withdrawal | adjustment
module.exports = function makeLedger(db, addLog){
  async function init(){
    await db(`CREATE TABLE IF NOT EXISTS ledger (
      id BIGSERIAL PRIMARY KEY,
      ref TEXT UNIQUE NOT NULL,
      seller_id TEXT NOT NULL,
      order_id BIGINT,
      kind TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db('CREATE INDEX IF NOT EXISTS ledger_seller_idx ON ledger(seller_id, created_at)');
    // Solde d'ouverture : on part du solde actuel de chaque vendeur (une seule fois par vendeur)
    await db(`INSERT INTO ledger(ref, seller_id, kind, amount_cents, meta)
              SELECT 'opening:' || id, id::text, 'opening',
                     ROUND(COALESCE((data->>'balance')::numeric, 0) * 100)::bigint,
                     '{"note":"solde au démarrage du journal"}'::jsonb
              FROM sellers
              ON CONFLICT (ref) DO NOTHING`);
  }
  // entries : [{ref, sellerId, orderId?, kind, cents, meta?}] — les doublons (même ref) sont ignorés
  async function add(entries){
    let n = 0;
    for(const e of entries){
      if(!e || !e.cents) continue; // rien à noter pour 0 centime
      try{
        const r = await db(
          `INSERT INTO ledger(ref, seller_id, order_id, kind, amount_cents, meta)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (ref) DO NOTHING`,
          [e.ref, String(e.sellerId), e.orderId || null, e.kind, Math.round(e.cents), JSON.stringify(e.meta || {})]);
        n += r.rowCount || 0;
      }catch(err){ addLog('warn', 'Journal : ' + err.message + ' · ' + e.ref); }
    }
    return n;
  }
  // Compare, pour chaque vendeur, la somme du journal et le solde affiché
  async function check(){
    const r = await db(`
      SELECT s.id::text AS seller_id, s.data->>'name' AS name,
             ROUND(COALESCE((s.data->>'balance')::numeric, 0) * 100)::bigint AS balance_cents,
             COALESCE((SELECT SUM(amount_cents) FROM ledger l WHERE l.seller_id = s.id::text), 0)::bigint AS ledger_cents
      FROM sellers s ORDER BY s.created_at`);
    return r.rows.map(x => {
      const balance = Number(x.balance_cents), ledger = Number(x.ledger_cents);
      return { sellerId: x.seller_id, name: x.name, balance: balance / 100, ledger: ledger / 100, diff: (balance - ledger) / 100, ok: balance === ledger };
    });
  }
  async function list(sellerId, limit){
    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const r = sellerId
      ? await db('SELECT * FROM ledger WHERE seller_id=$1 ORDER BY id DESC LIMIT $2', [String(sellerId), lim])
      : await db('SELECT * FROM ledger ORDER BY id DESC LIMIT $1', [lim]);
    return r.rows.map(x => ({ id: Number(x.id), ref: x.ref, sellerId: x.seller_id, orderId: x.order_id ? Number(x.order_id) : null,
      kind: x.kind, amount: Number(x.amount_cents) / 100, meta: x.meta, date: x.created_at }));
  }
  return { init, add, check, list };
};
