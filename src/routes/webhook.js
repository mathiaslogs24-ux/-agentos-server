'use strict';
const express        = require('express');
const router         = express.Router();
const sheets         = require('../services/sheets');
const { notifyVendor }         = require('../services/telegram');
const { constructWebhookEvent } = require('../services/stripe');

// Shared helper — notify a vendor after an order is created
async function notifyVendorForOrder(vendorId, order, meta) {
  if (!vendorId) return;
  const vendor = await sheets.getVendorById(vendorId).catch(() => null);
  if (!vendor?.telegram_id) return;

  let productName = meta.itemTitle || meta.stockName || order.product_id;
  if (order.product_id && !productName.includes(' ')) {
    const product = await sheets.getProductById(order.product_id).catch(() => null);
    if (product) productName = product.name;
  }
  await notifyVendor(vendor.telegram_id, {
    orderId: order.id,
    productName,
    amount: order.amount,
    buyerName: order.buyer_name,
    buyerTelegramId: order.buyer_telegram_id,
  });
}

// Handler for Stripe Checkout Sessions (old /shop-checkout flow)
async function handleCheckoutSession(session) {
  const meta            = session.metadata || {};
  const vendorId        = meta.vendor_id        || '';
  const productId       = meta.product_id       || '';
  const buyerTelegramId = meta.userId            || meta.buyer_telegram_id || '';
  const buyerName       = meta.userName          || meta.buyer_name        || '';
  const amount          = ((session.amount_total || 0) / 100).toFixed(2);

  try {
    const order = await sheets.createOrder({
      product_id:        productId,
      vendor_id:         vendorId,
      buyer_telegram_id: buyerTelegramId,
      buyer_name:        buyerName,
      amount,
      stripe_payment_id: session.payment_intent || session.id || '',
    });
    await notifyVendorForOrder(vendorId, order, meta);
  } catch (e) {
    console.error('[webhook/stripe] handleCheckoutSession error:', e.message);
  }
}

// Handler for PaymentIntents created by POST /api/checkout/intent (Mini App flow)
async function handlePaymentIntent(pi) {
  const meta   = pi.metadata || {};
  if (meta.source !== 'mini_app') return; // only process mini-app intents here

  const buyerTelegramId = meta.userId   || '';
  const buyerName       = meta.userName || '';
  const vendorId        = meta.vendor_id || '';
  const amount          = (pi.amount / 100).toFixed(2);

  let items;
  try {
    items = JSON.parse(meta.items || '[]');
  } catch (e) {
    items = [];
  }

  if (!items.length) {
    // Fallback: create a single order from top-level metadata
    items = [{ product_id: meta.product_id || '', vendor_id: vendorId, name: '', price: amount, quantity: '1' }];
  }

  try {
    for (const item of items) {
      const itemAmount = (parseFloat(item.price) * parseInt(item.quantity || '1', 10)).toFixed(2);
      const order = await sheets.createOrder({
        product_id:        item.product_id || '',
        vendor_id:         item.vendor_id  || vendorId,
        buyer_telegram_id: buyerTelegramId,
        buyer_name:        buyerName,
        amount:            itemAmount,
        stripe_payment_id: pi.id,
      });
      await notifyVendorForOrder(item.vendor_id || vendorId, order, { ...meta, itemTitle: item.name });
    }
  } catch (e) {
    console.error('[webhook/stripe] handlePaymentIntent error:', e.message);
  }
}

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
    await handleCheckoutSession(event.data.object);
  }

  if (event.type === 'payment_intent.succeeded') {
    await handlePaymentIntent(event.data.object);
  }

  res.sendStatus(200);
});

module.exports = router;
