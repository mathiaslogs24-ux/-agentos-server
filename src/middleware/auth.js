'use strict';
const jwt = require('jsonwebtoken');

function requireVendorAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  const token = header.slice(7);
  try {
    req.vendor = jwt.verify(token, process.env.JWT_SECRET || 'marketplace_jwt_secret');
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// Uses the same X-Secret header as the existing admin routes
function requireAdminAuth(req, res, next) {
  const secret = req.headers['x-secret'];
  if (!secret || secret !== (process.env.SECRET || 'changeme')) {
    return res.status(401).json({ error: 'Accès admin requis' });
  }
  next();
}

module.exports = { requireVendorAuth, requireAdminAuth };
