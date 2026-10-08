'use strict';
// 💶 Calculs d'argent en CENTIMES (nombres entiers) — plus aucune erreur d'arrondi du type 0,1 + 0,2.

// "12.5" / 12.5 / "12,50" → 1250   (valeur invalide → 0)
function toCents(x){
  const n = parseFloat(String(x === undefined || x === null ? 0 : x).replace(',', '.'));
  if(!isFinite(n)) return 0;
  return Math.round(Number((n * 100).toFixed(6)));
}
// 1250 → "12.50"
function centsStr(c){ return (Math.round(c) / 100).toFixed(2); }
// 1250 → 12.5  (pour les champs historiques stockés en euros)
function eur(c){ return Math.round(c) / 100; }

// Répartit `total` centimes entre des lignes au prorata de `weights`, sans perdre un seul centime
// (méthode du plus grand reste). La somme des parts vaut toujours exactement `total`.
function allocate(total, weights){
  const sum = weights.reduce((a, b) => a + b, 0);
  if(!weights.length) return [];
  if(sum <= 0) return weights.map(() => 0);
  const raw    = weights.map(w => total * w / sum);
  const shares = raw.map(Math.floor);
  let left = total - shares.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for(let k = 0; left > 0 && k < order.length; k++, left--) shares[order[k].i]++;
  return shares;
}

// Commission sur une ligne : jamais supérieure au montant payé.
//  mode 'flat' → flatCents × quantité ; sinon → montant × taux
function commissionCents({ mode, flatCents, rate, qty, amountCents }){
  const wanted = mode === 'flat' ? flatCents * Math.max(1, qty || 1) : Math.round(amountCents * (rate || 0));
  return Math.max(0, Math.min(amountCents, wanted));
}

module.exports = { toCents, centsStr, eur, allocate, commissionCents };
