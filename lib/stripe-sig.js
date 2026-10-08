'use strict';
// Vérification de la signature des webhooks Stripe — extrait de server.js
const crypto = require('crypto');

function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret || !Buffer.isBuffer(rawBody)) return false;
  let t = null; const sigs = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = v; else if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(t, 10)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(t + '.'), rawBody])).digest('hex');
  const eb = Buffer.from(expected);
  return sigs.some(sg => { const sb = Buffer.from(sg); return sb.length === eb.length && crypto.timingSafeEqual(sb, eb); });
}

module.exports = { verifyStripeSignature };
