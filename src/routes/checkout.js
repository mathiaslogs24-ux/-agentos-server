'use strict';
const express = require('express');
const router  = express.Router();
const { createPaymentIntent } = require('../services/stripe');

// POST /api/checkout/intent
// Accepts a cart from the Telegram Mini App, creates a Stripe PaymentIntent.
// Returns clientSecret so the frontend can render the Payment Element.
router.post('/intent', async (req, res) => {
  const { cart, userId, userName } = req.body;

  if (!Array.isArray(cart) || !cart.length) {
    return res.status(400).json({ error: 'cart est requis et doit être non vide' });
  }

  for (const item of cart) {
    if (!item.product_id || !item.vendor_id || !item.name || item.price == null || !item.quantity) {
      return res.status(400).json({ error: 'Chaque article doit avoir product_id, vendor_id, name, price, quantity' });
    }
  }

  try {
    const amount = cart.reduce((sum, item) => sum + parseFloat(item.price) * parseInt(item.quantity, 10), 0);

    if (amount <= 0) return res.status(400).json({ error: 'Montant invalide' });

    // Use first item's vendor_id (single-vendor cart); multi-vendor requires split PaymentIntents
    const vendorId  = cart[0].vendor_id;
    const productId = cart.map(i => i.product_id).join(',');

    const metadata = {
      vendor_id:  vendorId,
      product_id: productId,
      userId:     String(userId  || ''),
      userName:   String(userName || ''),
      items:      JSON.stringify(cart.map(i => ({
        product_id: i.product_id,
        vendor_id:  i.vendor_id,
        name:       i.name,
        price:      String(i.price),
        quantity:   String(i.quantity),
      }))),
      source: 'mini_app',
    };

    // Restrict to card-only so the Payment Element never triggers a redirect
    // inside the Telegram WebApp (redirect-based methods like iDEAL would break the flow)
    const pi = await createPaymentIntent(amount, 'eur', metadata, ['card']);

    res.json({ clientSecret: pi.client_secret, amount: pi.amount });
  } catch (e) {
    console.error('[checkout/intent]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
