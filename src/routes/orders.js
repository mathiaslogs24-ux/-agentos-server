'use strict';
const express = require('express');
const router  = express.Router();
const sheets  = require('../services/sheets');
const { requireAdminAuth } = require('../middleware/auth');

// GET /api/orders — admin: toutes les commandes
router.get('/', requireAdminAuth, async (req, res) => {
  try {
    const orders = await sheets.getOrders();
    res.json(orders.map(({ _rowIndex, ...o }) => o));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
