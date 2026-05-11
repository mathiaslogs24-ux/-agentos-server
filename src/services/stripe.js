'use strict';
const Stripe = require('stripe');

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

// paymentMethodTypes: explicit list e.g. ['card'], or null to use automatic_payment_methods
async function createPaymentIntent(amount, currency = 'eur', metadata = {}, paymentMethodTypes = null) {
  const stripe = getStripeClient();
  const params = {
    amount: Math.round(amount * 100),
    currency,
    metadata,
  };
  if (paymentMethodTypes) {
    params.payment_method_types = paymentMethodTypes;
  } else {
    params.automatic_payment_methods = { enabled: true };
  }
  return stripe.paymentIntents.create(params);
}

module.exports = { getStripeClient, constructWebhookEvent, createPaymentIntent };
