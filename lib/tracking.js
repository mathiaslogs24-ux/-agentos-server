'use strict';
// Numéros de suivi — extrait de server.js
const CARRIERS={
  laposte:['La Poste / Colissimo','https://www.laposte.fr/outils/suivre-vos-envois?code='],
  chronopost:['Chronopost','https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT='],
  mondialrelay:['Mondial Relay','https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition='],
  ups:['UPS','https://www.ups.com/track?tracknum='],
  dhl:['DHL','https://www.dhl.com/fr-fr/home/tracking.html?tracking-id='],
  autre:['','']
};
function parseTracking(body){
  const raw=String((body&&body.tracking)||'').trim();
  if(!raw) return {ok:true,tracking:null};
  if(!/^[A-Za-z0-9 \-]{4,40}$/.test(raw)) return {ok:false};
  const num=raw.replace(/\s+/g,'');
  const c=CARRIERS[(body&&body.carrier)||''];
  return {ok:true,tracking:{number:num,carrier:c?c[0]:'',url:c&&c[1]?c[1]+encodeURIComponent(num):''}};
}
function trackingLine(t){
  return t?'\n\n🔎 Suivi : `'+t.number+'`'+(t.carrier?' ('+t.carrier+')':'')+(t.url?'\n🔗 '+t.url:''):'';
}

module.exports = { CARRIERS, parseTracking, trackingLine };
