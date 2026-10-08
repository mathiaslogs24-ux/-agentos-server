'use strict';
// Frais de livraison — extrait de server.js
const SHIP_COUNTRIES = ['FR','BE','CH','LU'];
function computeShipping(shipping, sellerSubtotal, country){
  const s = shipping;
  if(!s || s.mode==='free') return 0;
  if(s.mode==='fixed') return parseFloat(s.fixed||0)||0;
  if(s.mode==='free_above'){
    const base=parseFloat(s.freeAboveBase||0)||0, minFree=parseFloat(s.freeAboveMin||0)||0;
    return (minFree>0 && sellerSubtotal>=minFree) ? 0 : base;
  }
  if(s.mode==='by_zone'){
    const z=s.zones||{};
    const c=SHIP_COUNTRIES.includes(country)?country:'FR';
    return parseFloat(z[c]||z.FR||0)||0; // même règle que la boutique : prix du pays, sinon prix France
  }
  return 0;
}

module.exports = { SHIP_COUNTRIES, computeShipping };
