'use strict';
const express = require('express');
const router  = express.Router();
const sheets  = require('../services/sheets');
const { requireVendorAuth, requireAdminAuth } = require('../middleware/auth');

function strip(obj) {
  const { _rowIndex, ...safe } = obj;
  return safe;
}

// GET /api/products — public catalogue (approved + in stock)
router.get('/', async (req, res) => {
  try {
    let products = await sheets.getApprovedProducts();
    if (req.query.category) {
      products = products.filter(p => p.category === req.query.category);
    }
    res.json(products.map(strip));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/products/mine — vendor's own products (any status)
router.get('/mine', requireVendorAuth, async (req, res) => {
  try {
    const products = await sheets.getProductsByVendorId(req.vendor.id);
    res.json(products.map(strip));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await sheets.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(strip(product));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/products — create (vendor auth)
router.post('/', requireVendorAuth, async (req, res) => {
  try {
    const { name, description, price, image_url, category, stock } = req.body;
    if (!name || price == null) {
      return res.status(400).json({ error: 'name et price sont requis' });
    }
    const product = await sheets.createProduct({
      vendor_id: req.vendor.id,
      name,
      description: description || '',
      price: String(price),
      image_url: image_url || '',
      category: category || '',
      stock: String(stock ?? 0),
    });
    res.status(201).json(product);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/products/:id — update (vendor auth, own product only)
router.put('/:id', requireVendorAuth, async (req, res) => {
  try {
    const product = await sheets.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });
    if (product.vendor_id !== req.vendor.id) return res.status(403).json({ error: 'Accès refusé' });

    const allowed = ['name', 'description', 'price', 'image_url', 'category', 'stock'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = String(req.body[k]); });

    // Significant changes require re-approval
    if (updates.name || updates.price) updates.status = 'pending';

    const updated = await sheets.updateProduct(req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/products/:id — delete (vendor auth, own product only)
router.delete('/:id', requireVendorAuth, async (req, res) => {
  try {
    const product = await sheets.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });
    if (product.vendor_id !== req.vendor.id) return res.status(403).json({ error: 'Accès refusé' });
    await sheets.deleteProduct(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/products/:id/approve — admin only
router.patch('/:id/approve', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status doit être "approved" ou "rejected"' });
    }
    const updated = await sheets.updateProduct(req.params.id, { status });
    if (!updated) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
