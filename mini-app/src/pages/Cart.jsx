import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram.js';
import { useCart, useCartTotal } from '../hooks/useCart.js';

export default function Cart() {
  const navigate = useNavigate();
  const { setMainButton, hideMainButton, showBackButton, hideBackButton } = useTelegram();
  const items  = useCart(s => s.items);
  const update = useCart(s => s.update);
  const remove = useCart(s => s.remove);
  const total  = useCartTotal();

  useEffect(() => {
    showBackButton(() => navigate(-1));
    if (items.length > 0) {
      setMainButton(`Commander — ${total.toFixed(2)} €`, () => navigate('/checkout'));
    } else {
      hideMainButton();
    }
    return () => { hideMainButton(); hideBackButton(); };
  }, [items, total]);

  if (items.length === 0) {
    return (
      <div style={{ ...centered, flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 48 }}>🛒</div>
        <div style={{ color: 'var(--tg-hint-color,#999)' }}>Votre panier est vide</div>
        <button onClick={() => navigate('/')} style={linkBtn}>Voir les produits</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Panier</h1>

      {items.map(item => (
        <div key={item.product_id} style={itemRow}>
          {item.image_url && (
            <img
              src={item.image_url}
              alt={item.name}
              style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.name}
            </div>
            <div style={{ color: 'var(--tg-button-color,#2481cc)', fontWeight: 700, marginTop: 4 }}>
              {(parseFloat(item.price) * item.quantity).toFixed(2)} €
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <QtyBtn onClick={() => update(item.product_id, item.quantity - 1)} label="−" />
              <span style={{ fontWeight: 700 }}>{item.quantity}</span>
              <QtyBtn onClick={() => update(item.product_id, item.quantity + 1)} label="+" />
              <button
                onClick={() => remove(item.product_id)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#e53935', fontSize: 18 }}
              >
                🗑
              </button>
            </div>
          </div>
        </div>
      ))}

      <div style={{ borderTop: '1px solid var(--tg-secondary-bg-color,#eee)', marginTop: 16, paddingTop: 16, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 17 }}>
        <span>Total</span>
        <span>{total.toFixed(2)} €</span>
      </div>
    </div>
  );
}

function QtyBtn({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--tg-secondary-bg-color,#eee)', fontSize: 16, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
}

const centered = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh' };
const linkBtn  = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tg-link-color,#2481cc)', fontWeight: 600, fontSize: 15 };
const itemRow  = { display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--tg-secondary-bg-color,#eee)' };
