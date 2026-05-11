import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useTelegram } from '../hooks/useTelegram.js';
import { useCart, useCartTotal } from '../hooks/useCart.js';
import { createPaymentIntent } from '../lib/api.js';

// Initialise Stripe once at module level (not inside a component)
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PK || '');

export default function Checkout() {
  const items    = useCart(s => s.items);
  const total    = useCartTotal();
  const { user } = useTelegram();
  const navigate  = useNavigate();

  const [clientSecret, setClientSecret] = useState(null);
  const [amount,       setAmount]       = useState(null);
  const [error,        setError]        = useState(null);

  useEffect(() => {
    if (!items.length) { navigate('/cart'); return; }
    createPaymentIntent(items, user?.id, user?.username || user?.first_name)
      .then(data => {
        setClientSecret(data.clientSecret);
        setAmount(data.amount);
      })
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: '#e53935', marginBottom: 12 }}>Erreur : {error}</div>
        <button onClick={() => navigate('/cart')} style={backBtn}>← Retour au panier</button>
      </div>
    );
  }

  if (!clientSecret) {
    return <div style={centered}>Préparation du paiement…</div>;
  }

  const options = {
    clientSecret,
    appearance: {
      theme: 'flat',
      variables: {
        colorPrimary: getComputedStyle(document.documentElement)
          .getPropertyValue('--tg-button-color').trim() || '#2481cc',
      },
    },
  };

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Paiement</h1>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--tg-button-color,#2481cc)', marginBottom: 20 }}>
        Total : {(amount / 100).toFixed(2)} €
      </div>
      <Elements stripe={stripePromise} options={options}>
        <PaymentForm navigate={navigate} amount={amount} />
      </Elements>
    </div>
  );
}

function PaymentForm({ navigate, amount }) {
  const stripe   = useStripe();
  const elements = useElements();
  const { setMainButton, hideMainButton, showBackButton, hideBackButton } = useTelegram();
  const [paying, setPaying]   = useState(false);
  const [error,  setError]    = useState(null);

  const handlePay = useCallback(async () => {
    if (!stripe || !elements || paying) return;
    setPaying(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message);
      setPaying(false);
    } else {
      // Card payments with redirect:'if_required' resolve here on success
      navigate('/confirmation', { replace: true });
    }
  }, [stripe, elements, paying]);

  useEffect(() => {
    showBackButton(() => navigate('/cart'));
    setMainButton(`Payer ${(amount / 100).toFixed(2)} €`, handlePay);
    return () => { hideMainButton(); hideBackButton(); };
  }, [handlePay]);

  return (
    <>
      <PaymentElement />
      {error && (
        <div style={{ marginTop: 12, color: '#e53935', fontSize: 14 }}>{error}</div>
      )}
      {paying && (
        <div style={{ marginTop: 16, textAlign: 'center', color: 'var(--tg-hint-color,#999)' }}>
          Traitement en cours…
        </div>
      )}
    </>
  );
}

const centered = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: 'var(--tg-hint-color,#999)' };
const backBtn  = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tg-link-color,#2481cc)', fontWeight: 600, fontSize: 15 };
