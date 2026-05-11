'use strict';
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const sheets  = require('../services/sheets');
const { requireVendorAuth } = require('../middleware/auth');

const JWT_SECRET  = () => process.env.JWT_SECRET || 'marketplace_jwt_secret';
const JWT_EXPIRES = '7d';

function safeVendor(vendor) {
  const { password_hash, _rowIndex, ...safe } = vendor;
  return safe;
}

// POST /api/vendors/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, telegram_id } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email et password sont requis' });
    }

    const existing = await sheets.getVendorByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });

    const password_hash = await bcrypt.hash(password, 10);
    const vendor = await sheets.createVendor({
      name, email, password_hash,
      telegram_id: String(telegram_id || ''),
    });

    res.status(201).json({ ok: true, vendor: safeVendor(vendor) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/vendors/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email et password requis' });
    }

    const vendor = await sheets.getVendorByEmail(email);
    if (!vendor) return res.status(401).json({ error: 'Identifiants invalides' });

    const valid = await bcrypt.compare(password, vendor.password_hash || '');
    if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

    const token = jwt.sign(
      { id: vendor.id, email: vendor.email, name: vendor.name, telegram_id: vendor.telegram_id },
      JWT_SECRET(),
      { expiresIn: JWT_EXPIRES }
    );

    res.json({ ok: true, token, vendor: safeVendor(vendor) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vendors/me — profile du vendeur connecté
router.get('/me', requireVendorAuth, async (req, res) => {
  try {
    const vendor = await sheets.getVendorById(req.vendor.id);
    if (!vendor) return res.status(404).json({ error: 'Vendeur introuvable' });
    res.json(safeVendor(vendor));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vendors/me/orders — commandes du vendeur
router.get('/me/orders', requireVendorAuth, async (req, res) => {
  try {
    const orders = await sheets.getOrdersByVendorId(req.vendor.id);
    res.json(orders.map(({ _rowIndex, ...o }) => o));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vendors/me/revenue — revenus calculés
router.get('/me/revenue', requireVendorAuth, async (req, res) => {
  try {
    const orders = await sheets.getOrdersByVendorId(req.vendor.id);
    const now = new Date();

    const total = orders.reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);

    const thisMonth = orders.filter(o => {
      const d = new Date(o.created_at);
      return !isNaN(d) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const monthTotal = thisMonth.reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);

    res.json({
      total: total.toFixed(2),
      month: monthTotal.toFixed(2),
      orderCount: orders.length,
      monthOrderCount: thisMonth.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
