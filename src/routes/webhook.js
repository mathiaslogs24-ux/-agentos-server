'use strict';
const express        = require('express');
const router         = express.Router();
const sheets         = require('../services/sheets');
const { notifyVendor }         = require('../services/telegram');
const { constructWebhookEvent } = require('../services/stripe');

// POST /api/webhook/stripe
// req.rawBody is set by the verify callback in express.json() for this path
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

  let event;
  try {
    event = constructWebhookEvent(req.rawBody || req.body, sig);
  } catch (e) {
    console.error('[webhook/stripe] Signature verification failed:', e.message);
    return res.status(400).json({ error: `Webhook Error: ${e.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta    = session.metadata || {};

    const vendorId        = meta.vendor_id        || '';
    const productId       = meta.product_id       || '';
    const buyerTelegramId = meta.userId            || meta.buyer_telegram_id || '';
    const buyerName       = meta.userName          || meta.buyer_name        || '';
    const amount          = ((session.amount_total || 0) / 100).toFixed(2);

    try {
      const order = await sheets.createOrder({
        product_id:       productId,
        vendor_id:        vendorId,
        buyer_telegram_id: buyerTelegramId,
        buyer_name:       buyerName,
        amount,
        stripe_payment_id: session.payment_intent || session.id || '',
      });

      // Notify the vendor if their Telegram ID is on file
      if (vendorId) {
        const vendor = await sheets.getVendorById(vendorId).catch(() => null);
        if (vendor?.telegram_id) {
          let productName = meta.itemTitle || meta.stockName || productId;
          if (productId) {
            const product = await sheets.getProductById(productId).catch(() => null);
            if (product) productName = product.name;
          }
          await notifyVendor(vendor.telegram_id, {
            orderId: order.id,
            productName,
            amount,
            buyerName,
            buyerTelegramId,
          });
        }
      }
    } catch (e) {
      // Log but always return 200 to prevent Stripe from retrying endlessly
      console.error('[webhook/stripe] Processing error:', e.message);
    }
  }

  res.sendStatus(200);
});

module.exports = router;
