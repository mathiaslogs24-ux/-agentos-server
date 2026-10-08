'use strict';
// Limite de requêtes par adresse IP (en mémoire) — extrait de server.js
const rlStore = new Map();
function rlHit(key, max, windowMs){
  const now=Date.now(); let e=rlStore.get(key);
  if(!e||now>e.reset){ e={n:0,reset:now+windowMs}; rlStore.set(key,e); }
  e.n++;
  return { blocked:e.n>max, retry:Math.ceil((e.reset-now)/1000) };
}
function rateLimit(name, max, windowMs){
  return (req,res,next)=>{
    const r=rlHit(name+'|'+req.ip, max, windowMs);
    if(r.blocked){ res.set('Retry-After', String(r.retry)); return res.status(429).json({error:'Trop de requêtes, réessayez dans un instant'}); }
    next();
  };
}
setInterval(()=>{ const n=Date.now(); for(const [k,e] of rlStore) if(n>e.reset) rlStore.delete(k); }, 60000).unref();

module.exports = { rlStore, rlHit, rateLimit };
