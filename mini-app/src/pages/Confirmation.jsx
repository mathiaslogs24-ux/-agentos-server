import React, { useEffect } from 'react';
import { useTelegram } from '../hooks/useTelegram.js';
import { useCart } from '../hooks/useCart.js';

export default function Confirmation() {
  const { setMainButton, hideBackButton, close } = useTelegram();
  const clear = useCart(s => s.clear);

  useEffect(() => {
    clear();
    hideBackButton();
    setMainButton('Fermer', close);
    // Auto-close after 5 seconds
    const timer = setTimeout(close, 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', textAlign: 'center', padding: 32 }}>
      <div style={{ fontSize: 72, marginBottom: 24 }}>✅</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Paiement confirmé !</h1>
      <p style={{ color: 'var(--tg-hint-color,#999)', lineHeight: 1.6, maxWidth: 280 }}>
        Merci pour votre achat. Vous allez recevoir une confirmation dans Telegram.
      </p>
      <p style={{ marginTop: 24, fontSize: 13, color: 'var(--tg-hint-color,#aaa)' }}>
        Cette fenêtre se fermera automatiquement…
      </p>
    </div>
  );
}
